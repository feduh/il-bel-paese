import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BookOpen, LayoutDashboard, Menu, Mic, Plus, UserPlus } from "lucide-react";
import SEO from "@/components/SEO";
import { useTranslation } from "react-i18next";
import type { ScheduledItem } from "@/components/ScheduledTimeline";
import { fetchAuthorNames, resolveAuthorName } from "@/lib/authorNames";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AreaSidebar, { type AreaTabValue } from "@/components/area/AreaSidebar";
import PanelProfilo from "@/components/area/PanelProfilo";
import PanelArticoli from "@/components/area/PanelArticoli";
import PanelCalendario from "@/components/area/PanelCalendario";
import PanelModerazione from "@/components/area/PanelModerazione";
import PanelRealta from "@/components/area/PanelRealta";
import PanelPreferiti from "@/components/area/PanelPreferiti";
import InviteMemberForm from "@/components/InviteMemberForm";
import AuthorsAffiliationPanel from "@/components/AuthorsAffiliationPanel";
import PanelEditoriale from "@/components/area/PanelEditoriale";
import PanelEditorialeCuratela from "@/components/area/PanelEditorialeCuratela";
import PanelPanoramica from "@/components/area/PanelPanoramica";
import PanelAdmin from "@/components/area/PanelAdmin";
import type {
  AreaProfile,
  AreaPost,
  AreaModerationPost,
  AreaPendingReality,
  AreaRealityRef,
} from "@/components/area/types";

const AreaPersonale = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [profile, setProfile] = useState<AreaProfile | null>(null);
  const [reality, setReality] = useState<AreaRealityRef | null>(null);
  const [posts, setPosts] = useState<AreaPost[]>([]);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [moderationQueue, setModerationQueue] = useState<AreaModerationPost[]>([]);
  const [myPendingRealities, setMyPendingRealities] = useState<AreaPendingReality[]>([]);
  const [modNameMap, setModNameMap] = useState<Record<string, string>>({});
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [isCurator, setIsCurator] = useState(false);
  const [editorialCounts, setEditorialCounts] = useState({ pending: 0, accepted: 0 });
  const [curatelaPending, setCuratelaPending] = useState(0);
  const [adminCounts, setAdminCounts] = useState({ messages: 0, reports: 0 });

  const isStaff =
    myRoles.includes("admin") || myRoles.includes("moderator") || myRoles.includes("coordinatore");
  const isAdmin = myRoles.includes("admin");
  const canProposeRealities = isAdmin || myRoles.includes("coordinatore");
  const canInviteMembers = isAdmin || myRoles.includes("coordinatore");

  const loadAll = async () => {
    if (!user) return;
    setLoading(true);

    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    setProfile(prof as AreaProfile | null);

    if (prof?.reality_id) {
      const { data: r } = await supabase
        .from("realities")
        .select("id, name")
        .eq("id", prof.reality_id)
        .maybeSingle();
      setReality((r as AreaRealityRef | null) ?? null);
    }

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const rs = (roles ?? []).map((r: { role: string }) => r.role);
    setMyRoles(rs);

    const [{ data: curatorEditions }, { data: guestIssues }] = await Promise.all([
      supabase.from("editorial_editions").select("id").eq("curator_user_id", user.id),
      supabase.from("editorial_special_issues").select("id").eq("guest_editor_user_id", user.id),
    ]);
    const editionIds = (curatorEditions ?? []).map((e: { id: string }) => e.id);
    const issueIds = (guestIssues ?? []).map((s: { id: string }) => s.id);
    setIsCurator(editionIds.length > 0 || issueIds.length > 0);
    if (editionIds.length > 0 || issueIds.length > 0) {
      const counts = await Promise.all([
        editionIds.length
          ? supabase
              .from("editorial_submissions")
              .select("id", { count: "exact", head: true })
              .in("edition_id", editionIds)
              .eq("status", "pending")
          : Promise.resolve({ count: 0 }),
        issueIds.length
          ? supabase
              .from("editorial_submissions")
              .select("id", { count: "exact", head: true })
              .in("special_issue_id", issueIds)
              .eq("status", "pending")
          : Promise.resolve({ count: 0 }),
      ]);
      setCuratelaPending((counts[0].count ?? 0) + (counts[1].count ?? 0));
    }


    const { data: mySubs } = await supabase
      .from("editorial_submissions")
      .select("status")
      .eq("author_user_id", user.id);
    setEditorialCounts({
      pending: (mySubs ?? []).filter((s: { status: string }) => s.status === "pending").length,
      accepted: (mySubs ?? []).filter((s: { status: string }) => s.status === "accepted").length,
    });

    const { data: mine } = await supabase
      .from("blog_posts")
      .select(
        "id, slug, title, excerpt, status, category, cover_image_url, published_at, scheduled_for, submitted_at, rejection_note",
      )
      .eq("user_id", user.id)
      .order("published_at", { ascending: false });
    setPosts((mine as AreaPost[]) ?? []);

    if (
      rs.includes("admin") || rs.includes("moderator") || rs.includes("coordinatore") ||
      editionIds.length > 0 || issueIds.length > 0
    ) {
      const { data: queue } = await supabase.rpc("review_queue");
      const list = ((queue ?? []) as unknown as AreaModerationPost[]).filter((p) => p.user_id !== user.id);
      setModerationQueue(list);
      const names = await fetchAuthorNames(list.map((p) => p.user_id));
      setModNameMap(names);
    }

    if (rs.includes("admin") || rs.includes("coordinatore")) {
      const { data: pending } = await supabase
        .from("realities")
        .select("id, name, city, region, auto_confirm_at, created_at")
        .eq("created_by", user.id)
        .eq("confirmed_status", "pendente")
        .order("created_at", { ascending: false });
      setMyPendingRealities((pending as AreaPendingReality[]) ?? []);
    }

    if (rs.includes("admin")) {
      const [{ count: msgCount }, { count: repCount }] = await Promise.all([
        supabase
          .from("contact_messages")
          .select("id", { count: "exact", head: true })
          .eq("status", "nuovo"),
        supabase
          .from("reality_reports")
          .select("id", { count: "exact", head: true })
          .eq("status", "nuova"),
      ]);
      setAdminCounts({ messages: msgCount ?? 0, reports: repCount ?? 0 });
    }

    const kindOf = (cat?: string | null): "editoriale" | "podcast" | "magazine" => {
      const c = (cat || "").toLowerCase();
      if (c.includes("editorial")) return "editoriale";
      if (c.includes("podcast")) return "podcast";
      return "magazine";
    };

    const scheduled: ScheduledItem[] = [];
    const ownScheduled = ((mine as AreaPost[]) ?? []).filter(
      (p) => p.status === "scheduled" && p.scheduled_for,
    );
    for (const p of ownScheduled) {
      scheduled.push({
        id: p.id,
        title: p.title,
        scheduled_for: p.scheduled_for as string,
        isMine: true,
        category: p.category ?? null,
        kind: kindOf(p.category),
      });
    }
    if (rs.includes("admin")) {
      const { data: coordRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "coordinatore");
      const coordIds = (coordRoles ?? [])
        .map((r: { user_id: string }) => r.user_id)
        .filter((uid: string) => uid !== user.id);
      if (coordIds.length > 0) {
        const { data: coordScheduled } = await supabase
          .from("blog_posts")
          .select("id, title, category, scheduled_for, author_name, user_id")
          .eq("status", "scheduled")
          .in("user_id", coordIds);
        const names = await fetchAuthorNames(
          (coordScheduled ?? []).map((p: { user_id: string }) => p.user_id),
        );
        for (const p of (coordScheduled ?? []) as Array<{
          id: string;
          title: string;
          category: string | null;
          scheduled_for: string;
          author_name: string;
          user_id: string;
        }>) {
          if (!p.scheduled_for) continue;
          scheduled.push({
            id: p.id,
            title: p.title,
            scheduled_for: p.scheduled_for,
            author_name: resolveAuthorName(names, p.user_id, p.author_name),
            isMine: false,
            category: p.category ?? null,
            kind: kindOf(p.category),
          });
        }
      }
    }
    setScheduledItems(scheduled);

    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const { articleCount, podcastCount } = useMemo(() => {
    let art = 0,
      pod = 0;
    for (const p of posts) {
      const cats = (p.category ?? "").toLowerCase().split(",").map((c) => c.trim());
      if (cats.includes("podcast")) pod += 1;
      else art += 1;
    }
    return { articleCount: art, podcastCount: pod };
  }, [posts]);

  const validTabs: AreaTabValue[] = [
    "panoramica",
    "profilo",
    "calendario",
    "articoli",
    "podcast",
    "preferiti",
    "editoriale",
    "editoriale-articoli",
    "editoriale-curatela",
    "realta",
    "membri",
    "moderazione",
    "admin",
  ];
  const tabFromUrl = searchParams.get("tab") as AreaTabValue | null;
  const activeTab: AreaTabValue =
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "panoramica";

  const setActiveTab = (v: AreaTabValue) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", v);
    if (v !== "admin") next.delete("section");
    setSearchParams(next, { replace: true });
  };

  const badges: Partial<Record<AreaTabValue, number>> = {
    calendario: scheduledItems.length || undefined,
    articoli: articleCount || undefined,
    podcast: podcastCount || undefined,
    editoriale: editorialCounts.pending || undefined,
    "editoriale-curatela": curatelaPending || undefined,
    realta: myPendingRealities.length || undefined,
    moderazione: moderationQueue.length || undefined,
    admin: (adminCounts.messages + adminCounts.reports) || undefined,
  };

  if (!user) {
    navigate("/login");
    return null;
  }

  const displayName =
    profile?.display_name?.split(" ")[0] || user.email?.split("@")[0] || "collega";

  const renderContent = () => {
    if (loading) {
      return (
        <div className="text-center py-20 text-muted-foreground font-body">
          {t("area.loading")}
        </div>
      );
    }
    if (!profile) {
      return (
        <div className="text-center py-20 font-body">
          <p className="text-muted-foreground mb-6">
            Profilo non trovato. Non è stato possibile caricare le tue informazioni.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <button
              onClick={() => window.location.reload()}
              className="btn-brutalist-outline py-2 px-6"
            >
              Ricarica
            </button>
            <Link to="/" className="btn-brutalist py-2 px-6">
              Torna alla Home
            </Link>
          </div>
        </div>
      );
    }

    switch (activeTab) {
      case "panoramica":
        return (
          <PanelPanoramica
            displayName={displayName}
            posts={posts}
            scheduledCount={scheduledItems.length}
            moderationCount={moderationQueue.length}
            pendingRealities={myPendingRealities}
            isStaff={isStaff}
            isAdmin={isAdmin}
            isCurator={isCurator}
            canProposeRealities={canProposeRealities}
            editorialCounts={editorialCounts}
            curatelaPending={curatelaPending}
            adminCounts={adminCounts}
            goTo={setActiveTab}
          />
        );
      case "profilo":
        return (
          <PanelProfilo
            profile={profile}
            setProfile={setProfile}
            reality={reality}
            myRoles={myRoles}
            userId={user.id}
            saving={savingProfile}
            setSaving={setSavingProfile}
            msg={profileMsg}
            setMsg={setProfileMsg}
          />
        );
      case "calendario":
        return <PanelCalendario items={scheduledItems} showAuthor={isAdmin} />;
      case "articoli":
        return <PanelArticoli posts={posts} isStaff={isStaff} onChanged={loadAll} />;
      case "podcast":
        return isStaff ? (
          <PanelArticoli
            posts={posts}
            isStaff={isStaff}
            onChanged={loadAll}
            presetCategory="Podcast"
            title="I miei podcast"
            icon={Mic}
            newLabel="Nuovo podcast"
            newHref="/area-personale/podcast/nuovo"
            editHrefBuilder={(pid) => `/area-personale/podcast/${pid}/modifica`}
          />
        ) : null;
      case "preferiti":
        return <PanelPreferiti userId={user.id} />;
      case "editoriale":
        return <PanelEditoriale userId={user.id} />;
      case "editoriale-articoli":
        return (
          <PanelArticoli
            posts={posts}
            isStaff={isStaff}
            onChanged={loadAll}
            presetCategory="Editoriali"
            title="I miei articoli editoriali"
            icon={BookOpen}
            newLabel="Nuovo articolo editoriale"
            newHref="/area-personale/articolo/nuovo?category=Editoriali"
          />
        );
      case "editoriale-curatela":
        return isCurator ? <PanelEditorialeCuratela userId={user.id} /> : null;
      case "realta":
        return canProposeRealities ? (
          <PanelRealta isAdmin={isAdmin} pending={myPendingRealities} onCreated={loadAll} />
        ) : null;
      case "membri":
        return canInviteMembers ? (
          <div className="space-y-8">
            <section className="p-8 rounded-lg bg-card border border-border">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="font-display text-xl font-semibold flex items-center gap-2">
                    <UserPlus size={20} />{" "}
                    {isAdmin ? t("area.inviteMember") : t("area.inviteAuthor")}
                  </h2>
                  <p className="font-body text-sm text-muted-foreground mt-1">
                    {isAdmin ? t("area.inviteDescAdmin") : t("area.inviteDescCoord")}
                  </p>
                </div>
                <button
                  onClick={() => setShowInvite((s) => !s)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-body font-medium hover:opacity-90 transition-opacity"
                >
                  <Plus size={14} /> {showInvite ? "Chiudi form" : "Nuovo membro"}
                </button>
              </div>
              {showInvite && (
                <div className="mt-6">
                  <InviteMemberForm
                    allowedRoles={isAdmin ? ["author", "coordinatore"] : ["author"]}
                  />
                </div>
              )}
            </section>
            <AuthorsAffiliationPanel />
          </div>
        ) : null;
      case "moderazione":
        return isStaff || isCurator ? (
          <PanelModerazione
            queue={moderationQueue}
            nameMap={modNameMap}
            onChanged={loadAll}
          />
        ) : null;
      case "admin":
        return isAdmin ? (
          <PanelAdmin
            messageCount={adminCounts.messages}
            reportCount={adminCounts.reports}
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <>
      <SEO
        title="Area personale"
        description="Dashboard: profilo, calendario, articoli e moderazione."
        canonicalPath="/area-personale"
      />
      <SidebarProvider defaultOpen>
        <div className="flex min-h-[calc(100vh-4rem)] w-full">
          <AreaSidebar
            active={activeTab}
            onChange={setActiveTab}
            isStaff={isStaff}
            isAdmin={isAdmin}
            isCurator={isCurator}
            canProposeRealities={canProposeRealities}
            canInviteMembers={canInviteMembers}
            badges={badges}
          />
          <main className="flex-1 min-w-0">
            <div className="sticky top-16 z-10 bg-background/85 backdrop-blur border-b border-border">
              <div className="flex items-center gap-3 px-4 md:px-8 py-3">
                <SidebarTrigger
                  className="lg:hidden h-9 w-auto px-3 gap-2 rounded-full bg-primary text-primary-foreground border border-primary shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
                  aria-label="Apri menu area personale"
                >
                  <LayoutDashboard size={16} />
                  <span className="text-xs font-body font-semibold">Menu area</span>
                </SidebarTrigger>
                <div className="min-w-0">
                  <p className="text-[11px] font-body text-muted-foreground uppercase tracking-widest">
                    {t("area.title")} {t("area.titleAccent")}
                  </p>
                  <h1 className="font-display text-lg md:text-xl font-semibold truncate">
                    {profile?.display_name || t("area.titleAccent")}
                  </h1>
                </div>
              </div>
            </div>
            <div className="px-4 md:px-8 py-8 max-w-7xl">{renderContent()}</div>
          </main>
        </div>
      </SidebarProvider>
    </>
  );
};

export default AreaPersonale;
