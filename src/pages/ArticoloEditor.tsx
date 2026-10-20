import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/invokeFunction";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Save, Send, Loader2, Check, ChevronDown, CalendarClock, ShieldCheck, ShieldAlert, Eye } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SEO from "@/components/SEO";
import FieldError from "@/components/FieldError";
import MarkdownEditor from "@/components/editor/MarkdownEditor";
import CoverImageUpload from "@/components/editor/CoverImageUpload";
import { articleSchema, fieldErrors, type FieldErrors } from "@/lib/validation";
import { ARTICLE_CATEGORIES, parseCategories, serializeCategories } from "@/lib/articleCategories";
import { firstReviewSlot, isValidReviewDate, romeParts, romeToDate } from "@/lib/reviewWindow";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const ArticoloEditor = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const categoryParam = params.get("category");
  const editionIdParam = params.get("edition");
  const specialIssueIdParam = params.get("special");
  const submissionIdParam = params.get("submission");
  const titleParam = params.get("title");



  const isEdit = !!id;

  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [errs, setErrs] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState("");
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [postEditionId, setPostEditionId] = useState<string | null>(editionIdParam);
  const [postSpecialIssueId, setPostSpecialIssueId] = useState<string | null>(specialIssueIdParam);
  const [hasEditorialControl, setHasEditorialControl] = useState(false);
  type PostStatus = "draft" | "pending" | "scheduled" | "rejected" | "published";
  const [currentStatus, setCurrentStatus] = useState<PostStatus>("draft");
  const [rejectionNote, setRejectionNote] = useState<string | null>(null);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(id ?? null);
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string>(""); // YYYY-MM-DD
  const [scheduleTime, setScheduleTime] = useState<string>(""); // HH:MM (only :00 / :30)
  const lastSavedRef = useRef<string>("");

  // Copyright declaration state
  type CopyrightDeclaration = {
    imagesOrigin: "own" | "cc" | "purchased" | "public_domain" | "mixed" | "";
    imagesCredits: string;
    textOrigin: "original" | "with_citations" | "translation" | "";
    quotesAttributed: boolean;
    aiGenerated: boolean;
    rightsConfirmed: boolean;
  };
  const [copyright, setCopyright] = useState<CopyrightDeclaration>({
    imagesOrigin: "",
    imagesCredits: "",
    textOrigin: "",
    quotesAttributed: false,
    aiGenerated: false,
    rightsConfirmed: false,
  });
  const [copyrightOpen, setCopyrightOpen] = useState(false);
  const [copyrightChecking, setCopyrightChecking] = useState(false);
  const [copyrightResult, setCopyrightResult] = useState<{ status: "ok" | "blocked"; notes: string } | null>(null);

  const [form, setForm] = useState({
    title: !isEdit && titleParam ? titleParam : "",
    category: !isEdit && (editionIdParam ? "Editoriali" : categoryParam ?? ""),
    excerpt: "",
    content: "",
    coverImageUrl: "",
  });



  const isStaff = useMemo(
    () => myRoles.includes("admin") || myRoles.includes("moderator") || myRoles.includes("coordinatore"),
    [myRoles]
  );

  // Gli editor editoriali possono pubblicare/programmare gli articoli
  // della propria annata o del proprio Special Issue.
  useEffect(() => {
    if (!user) return;
    const isChief = myRoles.includes("editor_chief");
    const isGuest = myRoles.includes("guest_editor");
    if (!isChief && !isGuest) {
      setHasEditorialControl(false);
      return;
    }
    let cancelled = false;
    (async () => {
      let allowed = false;
      if (isGuest && postSpecialIssueId) {
        const { data } = await supabase
          .from("editorial_special_issues")
          .select("id")
          .eq("id", postSpecialIssueId)
          .eq("guest_editor_user_id", user.id)
          .maybeSingle();
        allowed = !!data;
      }
      if (!allowed && isChief) {
        let editionId = postEditionId;
        if (!editionId && postSpecialIssueId) {
          const { data: si } = await supabase
            .from("editorial_special_issues")
            .select("edition_id")
            .eq("id", postSpecialIssueId)
            .maybeSingle();
          editionId = si?.edition_id ?? null;
        }
        if (editionId) {
          const { data } = await supabase
            .from("editorial_editions")
            .select("id")
            .eq("id", editionId)
            .eq("curator_user_id", user.id)
            .maybeSingle();
          allowed = !!data;
        }
      }
      if (!cancelled) setHasEditorialControl(allowed);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, myRoles, postEditionId, postSpecialIssueId]);

  const canPublish = isStaff || hasEditorialControl;
  // Authors cannot touch a submitted article: they must withdraw it first (enforced by the database too)
  const isLocked =
    rolesLoaded && !canPublish && ["scheduled", "pending", "rejected"].includes(currentStatus);

  // Load roles
  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data }) => {
        setMyRoles((data ?? []).map((r: { role: string }) => r.role));
      });
  }, [user]);

  // Load existing post (edit mode)
  useEffect(() => {
    if (!isEdit || !id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setGlobalError("Articolo non trovato o non accessibile.");
        setLoading(false);
        return;
      }
      setForm({
        title: data.title,
        category: data.category,
        excerpt: data.excerpt,
        content: data.content,
        coverImageUrl: data.cover_image_url ?? "",
      });
      setCurrentStatus(data.status as PostStatus);
      setRejectionNote(data.rejection_note ?? null);
      setPostEditionId((data as { editorial_edition_id: string | null }).editorial_edition_id ?? null);
      setPostSpecialIssueId((data as { special_issue_id: string | null }).special_issue_id ?? null);
      if (data.status === "scheduled" && data.scheduled_for) {
        const p = romeParts(new Date(data.scheduled_for));
        setScheduleDate(p.date);
        setScheduleTime(p.time);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const decl = (data as any).copyright_declaration;
      if (decl && typeof decl === "object") {
        setCopyright({
          imagesOrigin: decl.imagesOrigin ?? "",
          imagesCredits: decl.imagesCredits ?? "",
          textOrigin: decl.textOrigin ?? "",
          quotesAttributed: !!decl.quotesAttributed,
          aiGenerated: !!decl.aiGenerated,
          rightsConfirmed: !!decl.rightsConfirmed,
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const checkStatus = (data as any).copyright_check_status;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const checkNotes = (data as any).copyright_check_notes;
      if (checkStatus && checkStatus !== "pending") {
        setCopyrightResult({ status: checkStatus, notes: checkNotes ?? "" });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  // Autosave drafts (debounced 30s) — only for posts not yet published
  useEffect(() => {
    if (!user || loading || submitting) return;
    if (currentStatus === "published" || isLocked) return;
    if (!form.title.trim() || !form.content.trim()) return;

    const snapshot = JSON.stringify(form);
    if (snapshot === lastSavedRef.current) return;

    const timer = setTimeout(async () => {
      setAutoSaveState("saving");
      const authorName = user.email || "Anonimo";

      if (editingId) {
        const { error } = await supabase
          .from("blog_posts")
          .update({
            title: form.title || "Bozza senza titolo",
            category: form.category || "Bozza",
            excerpt: form.excerpt || form.content.slice(0, 200),
            content: form.content,
            cover_image_url: form.coverImageUrl || null,
          })
          .eq("id", editingId);
        if (!error) {
          lastSavedRef.current = snapshot;
          setLastSavedAt(new Date());
          setAutoSaveState("saved");
          setTimeout(() => setAutoSaveState("idle"), 2000);
        } else {
          setAutoSaveState("idle");
        }
      } else {
        // First autosave creates a draft row so subsequent saves update it
        const slug = `${slugify(form.title || "bozza")}-${Math.random().toString(36).slice(2, 8)}`;
        const { data, error } = await supabase
          .from("blog_posts")
          .insert({
            title: form.title || "Bozza senza titolo",
            category: form.category || "Bozza",
            excerpt: form.excerpt || form.content.slice(0, 200),
            content: form.content,
            cover_image_url: form.coverImageUrl || null,
            author_name: authorName,
            user_id: user.id,
            slug,
            status: "draft",
          })
          .select("id")
          .maybeSingle();
        if (!error && data) {
          setEditingId(data.id);
          lastSavedRef.current = snapshot;
          setLastSavedAt(new Date());
          setAutoSaveState("saved");
          setTimeout(() => setAutoSaveState("idle"), 2000);
        } else {
          setAutoSaveState("idle");
        }
      }
    }, 10000);

    return () => clearTimeout(timer);
  }, [form, user, loading, submitting, currentStatus, editingId, isLocked]);

  if (!user) {
    navigate("/login");
    return null;
  }

  const submit = async (mode: "draft" | "submit" | "schedule") => {
    setErrs({});
    setGlobalError("");

    // Authors always submit with a publication date (24h review window)
    if (mode === "submit" && !canPublish) {
      openSchedule();
      return;
    }

    const parsed = articleSchema(t).safeParse(form);
    if (!parsed.success) {
      setErrs(fieldErrors(parsed.error));
      setGlobalError(t("validation.fixErrors"));
      return;
    }

    let scheduledIso: string | null = null;
    if (mode === "schedule") {
      if (!scheduleDate || !scheduleTime) {
        setGlobalError("Seleziona data e orario di pubblicazione.");
        return;
      }
      const dt = romeToDate(scheduleDate, scheduleTime);
      if (isNaN(dt.getTime())) {
        setGlobalError("Data o orario non valido.");
        return;
      }
      if (!canPublish && !isValidReviewDate(dt)) {
        const p = romeParts(firstReviewSlot());
        setGlobalError(
          `La data di pubblicazione deve essere almeno 24 ore dopo l'invio: la prima data utile è il ${p.date.split("-").reverse().join("/")} alle ${p.time}.`,
        );
        return;
      }
      if (dt.getTime() <= Date.now()) {
        setGlobalError("L'orario di pubblicazione deve essere nel futuro.");
        return;
      }
      scheduledIso = dt.toISOString();
    }

    // Copyright gate: required for submit/schedule (not for plain draft)
    let copyrightPayloadForDb: Record<string, unknown> = {};
    if (mode !== "draft") {
      if (!copyright.imagesOrigin || !copyright.textOrigin || !copyright.rightsConfirmed) {
        setGlobalError("Compila la dichiarazione di copyright e conferma di avere i diritti prima di inviare o programmare.");
        setCopyrightOpen(true);
        return;
      }
      setCopyrightChecking(true);
      try {
        const { data: checkData, error: checkErr } = await invokeFunction<{
          status: "ok" | "blocked";
          notes?: string;
          error?: string;
        }>("copyright-check", {
          title: parsed.data.title,
          excerpt: parsed.data.excerpt,
          content: parsed.data.content,
          coverImageUrl: parsed.data.coverImageUrl || null,
          declaration: copyright,
        });
        setCopyrightChecking(false);
        if (checkErr) {
          setGlobalError(`Verifica copyright non disponibile: ${checkErr}`);
          return;
        }
        const result = checkData;
        if (!result || result.status !== "ok") {
          setCopyrightResult({ status: "blocked", notes: result?.notes || result?.error || "Verifica non superata." });
          setGlobalError("Verifica copyright NON superata. Modifica il contenuto o la dichiarazione e riprova.");
          setCopyrightOpen(true);
          return;
        }
        setCopyrightResult({ status: "ok", notes: result.notes || "" });
        copyrightPayloadForDb = {
          copyright_declaration: copyright,
          copyright_check_status: "ok",
          copyright_check_notes: result.notes || null,
          copyright_checked_at: new Date().toISOString(),
        };
      } catch (e) {
        setCopyrightChecking(false);
        setGlobalError(`Errore verifica copyright: ${e instanceof Error ? e.message : "ignoto"}`);
        return;
      }
    }

    setSubmitting(true);

    const targetStatus =
      mode === "draft" ? "draft"
      : mode === "schedule" ? "scheduled"
      : "published";

    // Author name from profile
    const { data: prof } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();
    const authorName = prof?.display_name || user.email || "Anonimo";

    if (editingId) {
      const updates: any = {
        title: parsed.data.title,
        category: parsed.data.category,
        excerpt: parsed.data.excerpt,
        content: parsed.data.content,
        cover_image_url: parsed.data.coverImageUrl || null,
        status: targetStatus,
        scheduled_for: scheduledIso,
        ...copyrightPayloadForDb,
      };
      if (currentStatus !== "published" && targetStatus === "published") {
        updates.published_at = new Date().toISOString();
      }
      const { error } = await supabase.from("blog_posts").update(updates).eq("id", editingId);
      setSubmitting(false);
      if (error) {
        setGlobalError(error.message);
        return;
      }
    } else {
      const slug = `${slugify(parsed.data.title)}-${Math.random().toString(36).slice(2, 8)}`;
      const payload: Record<string, unknown> = {
        title: parsed.data.title,
        category: parsed.data.category,
        excerpt: parsed.data.excerpt,
        content: parsed.data.content,
        cover_image_url: parsed.data.coverImageUrl || null,
        author_name: authorName,
        user_id: user.id,
        slug,
        status: targetStatus,
        scheduled_for: scheduledIso,
        published_at: scheduledIso ?? new Date().toISOString(),
        ...copyrightPayloadForDb,
      };
      if (editionIdParam) payload.editorial_edition_id = editionIdParam;
      if (specialIssueIdParam) payload.special_issue_id = specialIssueIdParam;
      const { data: inserted, error } = await supabase
        .from("blog_posts")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(payload as any)

        .select("id")
        .maybeSingle();
      setSubmitting(false);
      if (error) {
        setGlobalError(error.message);
        return;
      }
      if (submissionIdParam && inserted?.id) {
        await supabase
          .from("editorial_submissions")
          .update({ status: "converted", converted_post_id: inserted.id })
          .eq("id", submissionIdParam);
      }
    }


    navigate("/area-personale");
  };

  const withdraw = async () => {
    if (!editingId) return;
    setSubmitting(true);
    setGlobalError("");
    const { error } = await supabase.from("blog_posts").update({ status: "draft" }).eq("id", editingId);
    setSubmitting(false);
    if (error) {
      setGlobalError(error.message);
      return;
    }
    setCurrentStatus("draft");
    setScheduleDate("");
    setScheduleTime("");
  };

  const openSchedule = () => {
    // Authors: preselect the first allowed slot (submission + 24h)
    if (!canPublish) {
      const first = firstReviewSlot();
      const chosen = scheduleDate && scheduleTime ? romeToDate(scheduleDate, scheduleTime) : null;
      if (!chosen || chosen.getTime() < first.getTime()) {
        const p = romeParts(first);
        setScheduleDate(p.date);
        setScheduleTime(p.time);
      }
    }
    setScheduleOpen(true);
  };

  const halfHourSlots = useMemo(() => {
    const arr: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) arr.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
    return arr;
  }, []);
  const minDate = canPublish ? romeParts(new Date()).date : romeParts(firstReviewSlot()).date;

  if (loading) {
    return (
      <div className="py-20 text-center text-muted-foreground font-body">
        <Loader2 className="inline animate-spin mr-2" size={16} /> Caricamento…
      </div>
    );
  }

  return (
    <div className="py-16">
      <SEO
        title={isEdit ? "Modifica articolo" : "Nuovo articolo"}
        description="Editor del Bollettino di Il Bel Paese: scrivi, modifica e pubblica articoli sulla scena artistica indipendente italiana, con copertina, categoria e tag."
        canonicalPath="/area-personale"
      />

      <div className="editorial-container max-w-3xl">
        <Link
          to="/area-personale"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary font-body mb-6"
        >
          <ArrowLeft size={14} /> Torna all'area personale
        </Link>

        <h1 className="editorial-heading mb-8">
          {isEdit ? "Modifica" : "Nuovo"}{" "}
          <span className="italic text-primary">articolo</span>
        </h1>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit("submit");
          }}
          className="space-y-5"
          noValidate
        >
          {globalError && (
            <div role="alert" className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-body">
              {globalError}
            </div>
          )}
          <fieldset disabled={isLocked} className="space-y-5 disabled:opacity-70">


          <div>
            <label className="block text-sm font-body font-medium mb-2">Titolo *</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
              aria-invalid={!!errs.title}
              className={`w-full px-4 py-3 rounded-md border bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errs.title ? "border-destructive" : "border-input"}`}
            />
            <FieldError id="err-title" message={errs.title} />
          </div>

          <div>
            <label className="block text-sm font-body font-medium mb-2">Categorie *</label>
            <Popover open={catOpen} onOpenChange={setCatOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-invalid={!!errs.category}
                  className={`w-full min-h-[3rem] px-4 py-2.5 rounded-md border bg-background font-body text-sm text-left focus:outline-none focus:ring-2 focus:ring-ring flex items-center justify-between gap-2 ${errs.category ? "border-destructive" : "border-input"} hover:border-primary/40 transition-colors`}
                >
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {parseCategories(form.category).length === 0 ? (
                      <span className="text-muted-foreground">Seleziona una o più categorie…</span>
                    ) : (
                      parseCategories(form.category).map((c) => (
                        <span key={c} className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                          {c}
                        </span>
                      ))
                    )}
                  </div>
                  <ChevronDown size={16} className="text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-3" align="start">
                <div className="flex flex-wrap gap-2">
                  {ARTICLE_CATEGORIES.map((cat) => {
                    const selected = parseCategories(form.category).includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          const current = parseCategories(form.category);
                          const next = selected
                            ? current.filter((c) => c !== cat)
                            : [...current, cat];
                          setForm({ ...form, category: serializeCategories(next) });
                        }}
                        className={`text-xs font-body px-3 py-1.5 rounded-full border transition-colors ${
                          selected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-input hover:border-primary/40"
                        }`}
                        aria-pressed={selected}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end mt-3 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setCatOpen(false)}
                    className="text-xs font-body px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    Chiudi
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            <FieldError id="err-category" message={errs.category} />
          </div>

          <CoverImageUpload
            value={form.coverImageUrl}
            onChange={(url) => setForm({ ...form, coverImageUrl: url })}
          />
          <FieldError id="err-coverImageUrl" message={errs.coverImageUrl} />

          <div>
            <label className="block text-sm font-body font-medium mb-2">Estratto *</label>
            <textarea
              value={form.excerpt}
              onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
              rows={2}
              maxLength={500}
              placeholder="Una breve descrizione che apparirà nelle anteprime."
              aria-invalid={!!errs.excerpt}
              className={`w-full px-4 py-3 rounded-md border bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none ${errs.excerpt ? "border-destructive" : "border-input"}`}
            />
            <div className="flex items-center justify-between mt-1">
              <FieldError id="err-excerpt" message={errs.excerpt} />
              <span className={`text-xs font-body ${form.excerpt.length > 450 ? "text-destructive" : "text-muted-foreground"}`}>
                {form.excerpt.length}/500
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-body font-medium mb-2">Contenuto *</label>
            <MarkdownEditor
              value={form.content}
              onChange={(v) => setForm({ ...form, content: v })}
              maxLength={50000}
              invalid={!!errs.content}
            />
          </div>

          {/* Copyright declaration */}
          <div className="pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => setCopyrightOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-md border border-input bg-background hover:border-primary/40 transition-colors"
              aria-expanded={copyrightOpen}
            >
              <span className="inline-flex items-center gap-2 text-sm font-body font-medium">
                {copyrightResult?.status === "ok" ? (
                  <ShieldCheck size={16} className="text-secondary" />
                ) : copyrightResult?.status === "blocked" ? (
                  <ShieldAlert size={16} className="text-destructive" />
                ) : (
                  <ShieldCheck size={16} className="text-muted-foreground" />
                )}
                Dichiarazione copyright
                {copyrightResult?.status === "ok" && (
                  <span className="text-xs text-secondary font-normal">— verificata</span>
                )}
                {copyrightResult?.status === "blocked" && (
                  <span className="text-xs text-destructive font-normal">— bloccata</span>
                )}
              </span>
              <ChevronDown size={16} className={`text-muted-foreground transition-transform ${copyrightOpen ? "rotate-180" : ""}`} />
            </button>
            {copyrightOpen && (
              <div className="mt-3 p-4 rounded-md border border-input bg-muted/30 space-y-4">
                <p className="text-xs font-body text-muted-foreground">
                  Obbligatoria per inviare o programmare la pubblicazione. La verifica AI può bloccare l'articolo se rileva problemi di copyright (watermark, plagio evidente).
                </p>

                <div>
                  <label className="block text-xs font-body font-medium mb-1">Origine immagini *</label>
                  <select
                    value={copyright.imagesOrigin}
                    onChange={(e) => setCopyright({ ...copyright, imagesOrigin: e.target.value as CopyrightDeclaration["imagesOrigin"] })}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background font-body text-sm"
                  >
                    <option value="">Seleziona…</option>
                    <option value="own">Realizzate da me / con mio permesso</option>
                    <option value="cc">Creative Commons (con attribuzione)</option>
                    <option value="public_domain">Pubblico dominio</option>
                    <option value="purchased">Acquistate / con licenza</option>
                    <option value="mixed">Mista (specificare nei crediti)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-body font-medium mb-1">Crediti immagini (autori, licenze, URL fonte)</label>
                  <textarea
                    value={copyright.imagesCredits}
                    onChange={(e) => setCopyright({ ...copyright, imagesCredits: e.target.value })}
                    rows={2}
                    maxLength={1000}
                    placeholder="Es. Foto: Mario Rossi — CC BY-SA 4.0 · Cover: Wikimedia Commons"
                    className="w-full px-3 py-2 rounded-md border border-input bg-background font-body text-sm resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-body font-medium mb-1">Origine testo *</label>
                  <select
                    value={copyright.textOrigin}
                    onChange={(e) => setCopyright({ ...copyright, textOrigin: e.target.value as CopyrightDeclaration["textOrigin"] })}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background font-body text-sm"
                  >
                    <option value="">Seleziona…</option>
                    <option value="original">Testo originale</option>
                    <option value="with_citations">Originale con citazioni attribuite</option>
                    <option value="translation">Traduzione autorizzata</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-body cursor-pointer">
                    <input
                      type="checkbox"
                      checked={copyright.quotesAttributed}
                      onChange={(e) => setCopyright({ ...copyright, quotesAttributed: e.target.checked })}
                      className="rounded"
                    />
                    Tutte le citazioni sono correttamente attribuite alla fonte
                  </label>
                  <label className="flex items-center gap-2 text-sm font-body cursor-pointer">
                    <input
                      type="checkbox"
                      checked={copyright.aiGenerated}
                      onChange={(e) => setCopyright({ ...copyright, aiGenerated: e.target.checked })}
                      className="rounded"
                    />
                    Il contenuto è stato generato (anche in parte) con AI generativa
                  </label>
                  <label className="flex items-start gap-2 text-sm font-body cursor-pointer">
                    <input
                      type="checkbox"
                      checked={copyright.rightsConfirmed}
                      onChange={(e) => setCopyright({ ...copyright, rightsConfirmed: e.target.checked })}
                      className="rounded mt-0.5"
                    />
                    <span>
                      <strong>Confermo</strong> di possedere o di avere licenza per pubblicare tutti i contenuti (testo e immagini) di questo articolo, e di assumermi la responsabilità di eventuali violazioni. *
                    </span>
                  </label>
                </div>

                {copyrightResult && (
                  <div className={`p-3 rounded-md text-xs font-body ${copyrightResult.status === "ok" ? "bg-secondary/10 text-secondary border border-secondary/30" : "bg-destructive/10 text-destructive border border-destructive/30"}`}>
                    <strong>{copyrightResult.status === "ok" ? "Verifica superata." : "Verifica NON superata."}</strong>
                    {copyrightResult.notes && <> {copyrightResult.notes}</>}
                  </div>
                )}
              </div>
            )}
          </div>
          </fieldset>

          {isLocked ? (
            <div className="pt-4 border-t border-border space-y-3">
              {currentStatus === "rejected" ? (
                <div role="alert" className="p-4 rounded-md border border-destructive/40 bg-destructive/10 text-sm font-body">
                  <strong className="text-destructive">Articolo respinto.</strong>
                  {rejectionNote && <p className="mt-1 whitespace-pre-line">Nota della redazione: {rejectionNote}</p>}
                  <p className="mt-2 text-muted-foreground">Riportalo in bozza per modificarlo e reinviarlo.</p>
                </div>
              ) : (
                <div className="p-4 rounded-md border border-border bg-muted/40 text-sm font-body">
                  <strong>Articolo in revisione.</strong>{" "}
                  {scheduleDate && scheduleTime && <>Verrà pubblicato il {scheduleDate.split("-").reverse().join("/")} alle {scheduleTime} (ora italiana) se nessuno lo ferma. </>}
                  Per modificarlo ritiralo in bozza: alla nuova consegna le 24 ore ripartono.
                </div>
              )}
              <button
                type="button"
                onClick={withdraw}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-border font-body font-medium text-sm hover:border-primary/40 disabled:opacity-50"
              >
                <ArrowLeft size={14} /> Ritira in bozza
              </button>
            </div>
          ) : (
          <div className="flex items-center gap-3 flex-wrap pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => submit("draft")}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-border font-body font-medium text-sm hover:border-primary/40 transition-colors disabled:opacity-50"
            >
              <Save size={14} /> Salva bozza
            </button>
            {canPublish && (
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground font-body font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Send size={14} /> Pubblica
              </button>
            )}
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-input font-body font-medium text-sm hover:border-primary/40 transition-colors"
            >
              <Eye size={14} /> Anteprima
            </button>
            <Popover open={scheduleOpen} onOpenChange={(o) => (o ? openSchedule() : setScheduleOpen(false))}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={submitting}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-md font-body font-medium text-sm transition-colors disabled:opacity-50 ${
                    canPublish ? "border border-input hover:border-primary/40" : "bg-primary text-primary-foreground hover:opacity-90"
                  }`}
                >
                  {canPublish ? <CalendarClock size={14} /> : <Send size={14} />}
                  {canPublish ? (currentStatus === "scheduled" ? "Riprogramma" : "Programma") : "Invia per pubblicazione"}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-4 space-y-3 z-50 bg-popover">
                <div>
                  <label className="block text-xs font-body font-medium mb-1">Data (ora italiana)</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    min={minDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background font-body text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-body font-medium mb-1">Orario (slot di 30 min)</label>
                  <select
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background font-body text-sm"
                  >
                    <option value="">Seleziona…</option>
                    {halfHourSlots.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <p className="text-xs font-body text-muted-foreground">
                  {canPublish
                    ? "L'articolo verrà pubblicato automaticamente all'orario indicato."
                    : "La redazione ha 24 ore per rivederlo: se nessuno lo ferma, verrà pubblicato automaticamente all'orario indicato. Dopo l'invio non potrai modificarlo senza ritirarlo."}
                </p>
                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setScheduleOpen(false)}
                    className="px-3 py-1.5 rounded-md text-xs font-body border border-input"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={() => { setScheduleOpen(false); submit("schedule"); }}
                    disabled={submitting || !scheduleDate || !scheduleTime}
                    className="px-3 py-1.5 rounded-md text-xs font-body bg-primary text-primary-foreground disabled:opacity-50"
                  >
                    {canPublish ? "Conferma" : "Invia"}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            {currentStatus === "scheduled" && scheduleDate && scheduleTime && (
              <span className="text-xs font-body text-sky-600 inline-flex items-center gap-1">
                <CalendarClock size={12} /> Programmato per {scheduleDate} {scheduleTime}
              </span>
            )}
            {copyrightChecking && (
              <span className="inline-flex items-center gap-1.5 text-xs font-body text-muted-foreground" aria-live="polite">
                <Loader2 size={12} className="animate-spin" /> Verifica copyright in corso…
              </span>
            )}
            {autoSaveState !== "idle" ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-body text-muted-foreground" aria-live="polite">
                {autoSaveState === "saving" ? (
                  <><Loader2 size={12} className="animate-spin" /> Salvataggio bozza…</>
                ) : (
                  <><Check size={12} className="text-secondary" /> Bozza salvata</>
                )}
              </span>
            ) : lastSavedAt ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-body text-muted-foreground" aria-live="polite">
                <Check size={12} className="text-muted-foreground/60" />
                Ultima bozza salvata alle {lastSavedAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}
            {!canPublish && (
              <p className="text-xs text-muted-foreground font-body w-full">
                La prima data utile è 24 ore dopo l'invio: in questo tempo la redazione può rivedere l'articolo.
              </p>
            )}
            {!isStaff && hasEditorialControl && (
              <p className="text-xs text-muted-foreground font-body w-full">
                Come editor di questa call puoi pubblicare o programmare direttamente questo articolo.
              </p>
            )}
          </div>
          )}
        </form>

        {/* Anteprima articolo */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-body text-xs uppercase tracking-wider text-muted-foreground">
                Anteprima — come apparirà sul Bollettino
              </DialogTitle>
            </DialogHeader>
            <article className="space-y-6">
              {form.coverImageUrl && (
                <img
                  src={form.coverImageUrl}
                  alt={form.title || "Copertina"}
                  className="w-full h-64 object-cover rounded-lg"
                />
              )}
              {form.category && (
                <p className="font-body text-xs uppercase tracking-wider text-primary">
                  {form.category}
                </p>
              )}
              <h1 className="font-display text-3xl md:text-4xl font-bold leading-tight">
                {form.title || "Titolo dell'articolo"}
              </h1>
              {form.excerpt && (
                <p className="font-body text-lg text-muted-foreground italic border-l-2 border-primary pl-4">
                  {form.excerpt}
                </p>
              )}
              <div className="prose prose-lg max-w-none dark:prose-invert font-body prose-headings:font-display prose-a:text-primary">
                {form.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.content}</ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">Nessun contenuto.</p>
                )}
              </div>
            </article>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default ArticoloEditor;
