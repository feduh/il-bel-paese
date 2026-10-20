import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BookOpen, Check, X, RotateCcw, FileText, StickyNote, Save, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

type Edition = {
  id: string;
  year: number;
  title: string;
  theme_description: string | null;
  cover_image_url: string | null;
  submissions_open_at: string | null;
  submissions_close_at: string | null;
  status: "draft" | "open_submissions" | "closed_submissions" | "published" | "archived";
};

type Submission = {
  id: string;
  edition_id: string;
  author_user_id: string;
  author_deleted?: boolean;
  title: string;
  abstract: string;
  outline: string | null;
  references_text: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn" | "converted";
  curator_notes: string | null;
  converted_post_id: string | null;
  created_at: string;
  special_issue_id: string | null;
};

type SpecialIssueRef = {
  id: string;
  title: string;
  edition_id: string;
  theme_description: string | null;
  cover_image_url: string | null;
  status: Edition["status"];
  submissions_open_at: string | null;
  submissions_close_at: string | null;
  guest_editor_user_id: string | null;
};

const EDITION_STATUS: Array<{ v: Edition["status"]; label: string }> = [
  { v: "draft", label: "Bozza" },
  { v: "open_submissions", label: "Call aperta" },
  { v: "closed_submissions", label: "Call chiusa" },
  { v: "published", label: "Pubblicata" },
  { v: "archived", label: "Archiviata" },
];

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const STATUS_LABEL: Record<Submission["status"], string> = {
  pending: "In attesa",
  accepted: "Accettata",
  rejected: "Non accettata",
  withdrawn: "Ritirata",
  converted: "Convertita",
};

const FILTERS: Array<{ v: "all" | Submission["status"]; label: string }> = [
  { v: "all", label: "Tutte" },
  { v: "pending", label: "In attesa" },
  { v: "accepted", label: "Accettate" },
  { v: "rejected", label: "Rifiutate" },
  { v: "converted", label: "Convertite" },
  { v: "withdrawn", label: "Ritirate" },
];

type ScopeValues = {
  title: string;
  theme_description: string;
  cover_image_url: string;
  submissions_open_at: string;
  submissions_close_at: string;
  status: Edition["status"];
};

const ScopeSettings = ({
  kind,
  title,
  initial,
  onSave,
}: {
  kind: "edition" | "issue";
  title: string;
  initial: ScopeValues;
  onSave: (v: ScopeValues) => Promise<void>;
}) => {
  const [values, setValues] = useState<ScopeValues>(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ScopeValues>(k: K, v: ScopeValues[K]) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="p-6 rounded-lg bg-card border border-border space-y-4">
      <div>
        <h3 className="font-display font-semibold">Impostazioni della call</h3>
        <p className="text-xs font-body text-muted-foreground mt-1">{title}</p>
      </div>

      {kind === "issue" && (
        <label className="block space-y-1">
          <span className="text-xs font-body uppercase tracking-wider text-muted-foreground">Titolo</span>
          <input
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
          />
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-xs font-body uppercase tracking-wider text-muted-foreground">Tema</span>
        <textarea
          value={values.theme_description}
          onChange={(e) => set("theme_description", e.target.value)}
          rows={4}
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
        />
      </label>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className="text-xs font-body uppercase tracking-wider text-muted-foreground">Apertura call</span>
          <input
            type="datetime-local"
            value={values.submissions_open_at}
            onChange={(e) => set("submissions_open_at", e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-body uppercase tracking-wider text-muted-foreground">Deadline</span>
          <input
            type="datetime-local"
            value={values.submissions_close_at}
            onChange={(e) => set("submissions_close_at", e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
          />
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className="text-xs font-body uppercase tracking-wider text-muted-foreground">Stato</span>
          <select
            value={values.status}
            onChange={(e) => set("status", e.target.value as Edition["status"])}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
          >
            {EDITION_STATUS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-body uppercase tracking-wider text-muted-foreground">Copertina (URL)</span>
          <input
            value={values.cover_image_url}
            onChange={(e) => set("cover_image_url", e.target.value)}
            placeholder="https://…"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
          />
        </label>
      </div>

      <button
        onClick={async () => {
          setSaving(true);
          await onSave(values);
          setSaving(false);
        }}
        disabled={saving}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50"
      >
        <Save size={14} /> Salva impostazioni
      </button>
    </div>
  );
};

const PanelEditorialeCuratela = ({ userId }: { userId: string }) => {
  const [editions, setEditions] = useState<Edition[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [authorMap, setAuthorMap] = useState<Record<string, string>>({});
  const [specialIssues, setSpecialIssues] = useState<SpecialIssueRef[]>([]);
  const [activeScope, setActiveScope] = useState<string>("");
  const [filter, setFilter] = useState<"all" | Submission["status"]>("pending");
  const [loading, setLoading] = useState(true);
  const [isChief, setIsChief] = useState(false);
  const [guestNameMap, setGuestNameMap] = useState<Record<string, string>>({});
  const [creatingIssue, setCreatingIssue] = useState(false);
  const [newIssue, setNewIssue] = useState({ title: "", theme: "" });

  const load = async () => {
    setLoading(true);
    const { data: eds } = await supabase
      .from("editorial_editions")
      .select("*")
      .eq("curator_user_id", userId)
      .order("year", { ascending: false });
    const list = (eds as Edition[]) ?? [];
    setEditions(list);

    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    setIsChief(roles.includes("editor_chief") && list.length > 0);

    // Special Issue di cui sono guest editor + quelli delle annate che curo
    const siCols =
      "id, title, edition_id, theme_description, cover_image_url, status, submissions_open_at, submissions_close_at, guest_editor_user_id";
    const orParts = [`guest_editor_user_id.eq.${userId}`];
    if (list.length > 0) orParts.push(`edition_id.in.(${list.map((e) => e.id).join(",")})`);
    const { data: sis } = await supabase
      .from("editorial_special_issues")
      .select(siCols)
      .or(orParts.join(","))
      .order("position", { ascending: true });
    const myIssues = (sis as SpecialIssueRef[]) ?? [];
    setSpecialIssues(myIssues);

    const guestIds = [
      ...new Set(myIssues.map((i) => i.guest_editor_user_id).filter(Boolean) as string[]),
    ];
    if (guestIds.length > 0) {
      const { data: gp } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", guestIds);
      const gmap: Record<string, string> = {};
      (gp ?? []).forEach((p: { user_id: string; display_name: string }) => {
        gmap[p.user_id] = p.display_name;
      });
      setGuestNameMap(gmap);
    }

    if (list.length > 0 || myIssues.length > 0) {
      const filters: string[] = [];
      if (list.length > 0) filters.push(`edition_id.in.(${list.map((e) => e.id).join(",")})`);
      if (myIssues.length > 0) filters.push(`special_issue_id.in.(${myIssues.map((i) => i.id).join(",")})`);
      const { data: subs } = await supabase
        .from("editorial_submissions")
        .select("*")
        .or(filters.join(","))
        .order("created_at", { ascending: false });
      const sList = (subs as Submission[]) ?? [];
      setSubmissions(sList);
      const authorIds = [...new Set(sList.map((s) => s.author_user_id))];
      if (authorIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", authorIds);
        const map: Record<string, string> = {};
        (profs ?? []).forEach((p: { user_id: string; display_name: string }) => {
          map[p.user_id] = p.display_name;
        });
        setAuthorMap(map);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const scopeOptions = useMemo(() => {
    const opts = editions.map((e) => ({ value: `ed:${e.id}`, label: `Editoriale ${e.year} — ${e.title}` }));
    specialIssues.forEach((si) =>
      opts.push({ value: `si:${si.id}`, label: `Special Issue — ${si.title}` }),
    );
    return opts;
  }, [editions, specialIssues]);

  useEffect(() => {
    if (!activeScope && scopeOptions.length > 0) setActiveScope(scopeOptions[0].value);
  }, [scopeOptions, activeScope]);

  const filtered = useMemo(() => {
    return submissions.filter((s) => {
      if (activeScope.startsWith("ed:")) {
        if (s.edition_id !== activeScope.slice(3)) return false;
        if (s.special_issue_id) return false;
      } else if (activeScope.startsWith("si:")) {
        if (s.special_issue_id !== activeScope.slice(3)) return false;
      }
      if (filter !== "all" && s.status !== filter) return false;
      return true;
    });
  }, [submissions, activeScope, filter]);

  const updateStatus = async (s: Submission, status: Submission["status"]) => {
    const { error } = await supabase
      .from("editorial_submissions")
      .update({ status })
      .eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Stato aggiornato");
    load();
  };

  const saveNotes = async (s: Submission, notes: string) => {
    const { error } = await supabase
      .from("editorial_submissions")
      .update({ curator_notes: notes })
      .eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Note salvate");
    load();
  };

  const activeEdition = useMemo(
    () => (activeScope.startsWith("ed:") ? editions.find((e) => e.id === activeScope.slice(3)) : undefined),
    [activeScope, editions],
  );
  const activeIssue = useMemo(
    () => (activeScope.startsWith("si:") ? specialIssues.find((i) => i.id === activeScope.slice(3)) : undefined),
    [activeScope, specialIssues],
  );

  const saveEdition = async (
    values: {
      theme_description: string;
      cover_image_url: string;
      submissions_open_at: string;
      submissions_close_at: string;
      status: Edition["status"];
    },
  ) => {
    if (!activeEdition) return;
    const { error } = await supabase
      .from("editorial_editions")
      .update({
        theme_description: values.theme_description || null,
        cover_image_url: values.cover_image_url || null,
        submissions_open_at: fromLocalInput(values.submissions_open_at),
        submissions_close_at: fromLocalInput(values.submissions_close_at),
        status: values.status,
      })
      .eq("id", activeEdition.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Annata aggiornata");
    load();
  };

  const saveIssue = async (
    values: {
      title: string;
      theme_description: string;
      cover_image_url: string;
      submissions_open_at: string;
      submissions_close_at: string;
      status: Edition["status"];
    },
  ) => {
    if (!activeIssue) return;
    const { error } = await supabase
      .from("editorial_special_issues")
      .update({
        title: values.title,
        theme_description: values.theme_description || null,
        cover_image_url: values.cover_image_url || null,
        submissions_open_at: fromLocalInput(values.submissions_open_at),
        submissions_close_at: fromLocalInput(values.submissions_close_at),
        status: values.status,
      })
      .eq("id", activeIssue.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Special Issue aggiornato");
    load();
  };

  const createSpecialIssue = async (editionId: string) => {
    if (!newIssue.title.trim()) { toast.error("Indica un titolo per lo Special Issue."); return; }
    const base = slugify(newIssue.title) || "special-issue";
    const { error } = await supabase.from("editorial_special_issues").insert({
      edition_id: editionId,
      title: newIssue.title.trim(),
      slug: `${base}-${Math.random().toString(36).slice(2, 6)}`,
      theme_description: newIssue.theme.trim() || null,
      status: "draft",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Special Issue creato. L'admin assegnerà il guest editor.");
    setNewIssue({ title: "", theme: "" });
    setCreatingIssue(false);
    load();
  };


  if (editions.length === 0 && specialIssues.length === 0 && !loading) {
    return (
      <section className="p-8 rounded-lg bg-card border border-border">
        <h2 className="font-display text-xl font-semibold flex items-center gap-2">
          <BookOpen size={20} /> Curatela editoriale
        </h2>
        <p className="font-body text-sm text-muted-foreground mt-2">
          Non ti è stata ancora assegnata alcuna annata o Special Issue da curare.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="p-8 rounded-lg bg-card border border-border">
        <h2 className="font-display text-xl font-semibold flex items-center gap-2">
          <BookOpen size={20} /> Curatela editoriale
        </h2>
        <p className="font-body text-sm text-muted-foreground mt-1">
          Valuta le candidature ricevute per l'annata che curi come editor chief o per lo Special Issue di cui sei
          guest editor. Accetta i pitch in linea con il tema e lascia una nota per gli autori.
        </p>
      </div>

      {(activeEdition || activeIssue) && (
        <ScopeSettings
          key={activeScope}
          kind={activeEdition ? "edition" : "issue"}
          title={activeEdition ? `Editoriale ${activeEdition.year} — ${activeEdition.title}` : activeIssue!.title}
          initial={{
            title: activeIssue?.title ?? "",
            theme_description: (activeEdition ?? activeIssue)?.theme_description ?? "",
            cover_image_url: (activeEdition ?? activeIssue)?.cover_image_url ?? "",
            submissions_open_at: toLocalInput((activeEdition ?? activeIssue)?.submissions_open_at ?? null),
            submissions_close_at: toLocalInput((activeEdition ?? activeIssue)?.submissions_close_at ?? null),
            status: (activeEdition ?? activeIssue)!.status,
          }}
          onSave={activeEdition ? saveEdition : saveIssue}
        />
      )}

      {isChief && activeEdition && (
        <div className="p-6 rounded-lg bg-card border border-border space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-display font-semibold flex items-center gap-2">
              <Users size={16} /> Special Issue dell'annata
            </h3>
            <button
              onClick={() => setCreatingIssue((v) => !v)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted"
            >
              <Plus size={12} /> {creatingIssue ? "Annulla" : "Nuovo Special Issue"}
            </button>
          </div>

          {creatingIssue && (
            <div className="space-y-2 p-3 rounded-md border border-border bg-background/40">
              <input
                value={newIssue.title}
                onChange={(e) => setNewIssue((v) => ({ ...v, title: e.target.value }))}
                placeholder="Titolo del numero speciale"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
              />
              <textarea
                value={newIssue.theme}
                onChange={(e) => setNewIssue((v) => ({ ...v, theme: e.target.value }))}
                rows={3}
                placeholder="Tema e taglio del numero…"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Il guest editor viene nominato dall'admin: crea il numero e segnala il nome da assegnare.
              </p>
              <button
                onClick={() => createSpecialIssue(activeEdition.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs hover:opacity-90"
              >
                <Plus size={12} /> Crea Special Issue
              </button>
            </div>
          )}

          <ul className="space-y-2">
            {specialIssues.filter((si) => si.edition_id === activeEdition.id).length === 0 ? (
              <li className="text-sm text-muted-foreground">Nessuno Special Issue per questa annata.</li>
            ) : (
              specialIssues
                .filter((si) => si.edition_id === activeEdition.id)
                .map((si) => (
                  <li
                    key={si.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-md border border-border bg-background/40 text-sm"
                  >
                    <span className="font-display font-semibold">{si.title}</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      guest editor:{" "}
                      {si.guest_editor_user_id
                        ? guestNameMap[si.guest_editor_user_id] ?? "assegnato"
                        : "da nominare (admin)"}
                    </span>
                  </li>
                ))
            )}
          </ul>
        </div>
      )}



      <div className="p-6 rounded-lg bg-card border border-border space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-body flex items-center gap-2">
            <span className="text-muted-foreground">Open call:</span>
            <select
              value={activeScope}
              onChange={(e) => setActiveScope(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-border bg-background text-sm"
            >
              {scopeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className={`px-3 py-1.5 rounded-full border text-xs font-mono ${
                filter === f.v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuna candidatura per questo filtro.</p>
        ) : (
          <ul className="space-y-3">
            {filtered.map((s) => (
              <SubmissionCard
                key={s.id}
                s={s}
                authorName={s.author_deleted ? "Autore rimosso" : authorMap[s.author_user_id] ?? "Autore"}
                onStatus={(st) => updateStatus(s, st)}
                onSaveNotes={(notes) => saveNotes(s, notes)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

const SubmissionCard = ({
  s,
  authorName,
  onStatus,
  onSaveNotes,
}: {
  s: Submission;
  authorName: string;
  onStatus: (st: Submission["status"]) => void;
  onSaveNotes: (notes: string) => void;
}) => {
  const [notes, setNotes] = useState(s.curator_notes ?? "");
  const [showNotes, setShowNotes] = useState(false);
  useEffect(() => setNotes(s.curator_notes ?? ""), [s.curator_notes]);

  return (
    <li className="p-4 rounded-md border border-border bg-background/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display font-semibold">{s.title}</div>
          <div className="text-xs font-mono text-muted-foreground mt-1">
            {authorName} · {new Date(s.created_at).toLocaleDateString("it-IT")}
          </div>
        </div>
        <span className="text-xs font-mono px-2 py-1 rounded border border-border bg-muted">
          {STATUS_LABEL[s.status]}
        </span>
      </div>
      <p className="text-sm mt-3 whitespace-pre-line">{s.abstract}</p>

      {(s.outline || s.references_text) && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground text-xs font-mono uppercase tracking-wider">
            Dettagli aggiuntivi
          </summary>
          {s.outline && (
            <div className="mt-2">
              <div className="micro-label mb-1">Scaletta</div>
              <p className="whitespace-pre-line text-sm">{s.outline}</p>
            </div>
          )}
          {s.references_text && (
            <div className="mt-2">
              <div className="micro-label mb-1">Riferimenti</div>
              <p className="whitespace-pre-line text-sm">{s.references_text}</p>
            </div>
          )}
        </details>
      )}

      {showNotes ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Note per l'autore…"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                onSaveNotes(notes);
                setShowNotes(false);
              }}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs hover:opacity-90"
            >
              Salva note
            </button>
            <button
              onClick={() => setShowNotes(false)}
              className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted"
            >
              Annulla
            </button>
          </div>
        </div>
      ) : (
        s.curator_notes && (
          <div className="mt-3 p-3 rounded-md bg-muted/40 border border-border text-sm">
            <div className="micro-label mb-1">Le tue note</div>
            {s.curator_notes}
          </div>
        )
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {s.status !== "accepted" && s.status !== "converted" && (
          <button
            onClick={() => onStatus("accepted")}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs hover:opacity-90"
          >
            <Check size={12} /> Accetta
          </button>
        )}
        {s.status !== "rejected" && s.status !== "converted" && (
          <button
            onClick={() => onStatus("rejected")}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-xs hover:opacity-90"
          >
            <X size={12} /> Rifiuta
          </button>
        )}
        {s.status !== "pending" && s.status !== "converted" && (
          <button
            onClick={() => onStatus("pending")}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted"
          >
            <RotateCcw size={12} /> Rimetti in attesa
          </button>
        )}
        <button
          onClick={() => setShowNotes((v) => !v)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted"
        >
          <StickyNote size={12} /> {showNotes ? "Chiudi note" : "Aggiungi/modifica note"}
        </button>
        {s.converted_post_id && (
          <Link
            to={`/area-personale/articolo/${s.converted_post_id}/modifica`}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted"
          >
            <FileText size={12} /> Apri bozza
          </Link>
        )}
      </div>
    </li>
  );
};

export default PanelEditorialeCuratela;
