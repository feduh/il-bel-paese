import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowLeft,
  Save,
  Send,
  Loader2,
  CalendarClock,
  Mic,
  PlayCircle,
  Headphones,
  Link as LinkIcon,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import SEO from "@/components/SEO";
import FieldError from "@/components/FieldError";
import MarkdownEditor from "@/components/editor/MarkdownEditor";
import CoverImageUpload from "@/components/editor/CoverImageUpload";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

type PodcastKind = "audio" | "video";

const PodcastEditor = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [currentStatus, setCurrentStatus] =
    useState<"draft" | "pending" | "scheduled" | "published">("draft");
  const [editingId, setEditingId] = useState<string | null>(id ?? null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const initialLoad = useRef(false);

  const [form, setForm] = useState({
    title: "",
    excerpt: "",
    content: "",
    coverImageUrl: "",
    podcastUrl: "",
    podcastKind: "audio" as PodcastKind,
    podcastDuration: "",
    guest: "",
  });

  const canManage = useMemo(
    () => myRoles.includes("admin") || myRoles.includes("coordinatore"),
    [myRoles],
  );

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data }) => {
        setMyRoles((data ?? []).map((r: { role: string }) => r.role));
        setRolesLoaded(true);
      });
  }, [user]);

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
        setGlobalError("Podcast non trovato o non accessibile.");
        setLoading(false);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setForm({
        title: d.title ?? "",
        excerpt: d.excerpt ?? "",
        content: d.content ?? "",
        coverImageUrl: d.cover_image_url ?? "",
        podcastUrl: d.podcast_url ?? "",
        podcastKind: (d.podcast_kind as PodcastKind) ?? "audio",
        podcastDuration: d.podcast_duration ?? "",
        guest: d.author_name ?? "",
      });
      setCurrentStatus(d.status);
      if (d.status === "scheduled" && d.scheduled_for) {
        const dt = new Date(d.scheduled_for);
        const pad = (n: number) => String(n).padStart(2, "0");
        setScheduleDate(
          `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
        );
        setScheduleTime(`${pad(dt.getHours())}:${pad(dt.getMinutes())}`);
      }
      initialLoad.current = true;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  // Prefill guest with display name on new podcasts
  useEffect(() => {
    if (isEdit || !user || form.guest) return;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.display_name) setForm((f) => ({ ...f, guest: data.display_name }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isEdit]);

  const halfHourSlots = useMemo(() => {
    const arr: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30])
        arr.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
    return arr;
  }, []);
  const todayIso = new Date().toISOString().slice(0, 10);

  const validate = (mode: "draft" | "publish" | "schedule"): boolean => {
    const e: Record<string, string> = {};
    if (mode !== "draft") {
      if (!form.title.trim() || form.title.trim().length < 3)
        e.title = "Titolo obbligatorio (min 3 caratteri).";
      if (!form.excerpt.trim() || form.excerpt.trim().length < 10)
        e.excerpt = "Descrizione breve obbligatoria (min 10 caratteri).";
      if (form.excerpt.length > 400)
        e.excerpt = "Descrizione troppo lunga (max 400 caratteri).";
      if (!form.podcastUrl.trim()) e.podcastUrl = "URL dell'episodio obbligatorio.";
      else {
        try {
          new URL(form.podcastUrl.trim());
        } catch {
          e.podcastUrl = "URL non valido.";
        }
      }
    }
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (mode: "draft" | "publish" | "schedule") => {
    setGlobalError("");
    if (!user) return;
    if (!validate(mode)) {
      setGlobalError("Correggi i campi evidenziati.");
      return;
    }

    let scheduledIso: string | null = null;
    if (mode === "schedule") {
      if (!scheduleDate || !scheduleTime) {
        setGlobalError("Seleziona data e orario di pubblicazione.");
        return;
      }
      const dt = new Date(`${scheduleDate}T${scheduleTime}:00`);
      if (isNaN(dt.getTime()) || dt.getTime() <= Date.now()) {
        setGlobalError("L'orario di pubblicazione deve essere nel futuro.");
        return;
      }
      scheduledIso = dt.toISOString();
    }

    const targetStatus =
      mode === "draft" ? "draft" : mode === "schedule" ? "scheduled" : "published";

    setSubmitting(true);
    const authorName = form.guest.trim() || user.email || "Il Bel Paese";

    const basePayload = {
      title: form.title.trim() || "Bozza podcast",
      category: "Podcast",
      excerpt: form.excerpt.trim() || form.title.trim(),
      content: form.content,
      cover_image_url: form.coverImageUrl || null,
      author_name: authorName,
      podcast_url: form.podcastUrl.trim() || null,
      podcast_kind: form.podcastKind,
      podcast_duration: form.podcastDuration.trim() || null,
      status: targetStatus,
      scheduled_for: scheduledIso,
    };

    if (editingId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: any = { ...basePayload };
      if (currentStatus !== "published" && targetStatus === "published") {
        updates.published_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("blog_posts")
        .update(updates)
        .eq("id", editingId);
      setSubmitting(false);
      if (error) {
        setGlobalError(error.message);
        return;
      }
    } else {
      const slug = `${slugify(form.title || "podcast")}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const { error } = await supabase.from("blog_posts").insert({
        ...basePayload,
        user_id: user.id,
        slug,
        published_at: scheduledIso ?? new Date().toISOString(),
      });
      setSubmitting(false);
      if (error) {
        setGlobalError(error.message);
        return;
      }
    }

    navigate("/area-personale?tab=podcast");
  };

  if (!user) {
    navigate("/login");
    return null;
  }

  if (loading || !rolesLoaded) {
    return (
      <div className="py-20 text-center text-muted-foreground font-body">
        <Loader2 className="inline animate-spin mr-2" size={16} /> Caricamento…
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="py-20 editorial-container max-w-2xl text-center">
        <h1 className="editorial-heading mb-4">Accesso riservato</h1>
        <p className="font-body text-muted-foreground mb-6">
          La sezione podcast è riservata a coordinatori e admin.
        </p>
        <Link to="/area-personale" className="text-primary hover:underline font-body text-sm">
          ← Torna all'area personale
        </Link>
      </div>
    );
  }

  const KindIcon = form.podcastKind === "video" ? PlayCircle : Headphones;

  return (
    <div className="py-16">
      <SEO
        title={isEdit ? "Modifica podcast" : "Nuovo podcast"}
        description="Editor dei podcast di Il Bel Paese: collega episodi ospitati dai partner e programma la pubblicazione."
        canonicalPath="/area-personale"
      />

      <div className="editorial-container max-w-3xl">
        <Link
          to="/area-personale?tab=podcast"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary font-body mb-6"
        >
          <ArrowLeft size={14} /> Torna all'area personale
        </Link>

        <h1 className="editorial-heading mb-2 flex items-center gap-3">
          <Mic size={28} className="text-primary" />
          {isEdit ? "Modifica" : "Nuovo"}{" "}
          <span className="italic text-primary">podcast</span>
        </h1>
        <p className="editorial-body text-muted-foreground mb-8">
          Collega un episodio ospitato da un partner (Spotify, YouTube, Spreaker, SoundCloud…). La copertina si estrae automaticamente dall'URL.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit("publish");
          }}
          className="space-y-6"
          noValidate
        >
          {/* Host URL */}
          <div>
            <label className="block text-sm font-body font-medium mb-1">
              URL dell'episodio host <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <LinkIcon
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="url"
                  value={form.podcastUrl}
                  onChange={(e) => setForm({ ...form, podcastUrl: e.target.value })}
                  placeholder="https://open.spotify.com/episode/…  ·  https://youtube.com/watch?v=…"
                  className={`w-full pl-9 pr-3 py-2.5 rounded-md border ${
                    errs.podcastUrl ? "border-destructive" : "border-input"
                  } bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring`}
                />
              </div>
            </div>
            <FieldError message={errs.podcastUrl} />
            <p className="mt-1 text-xs font-body text-muted-foreground">
              Carica la copertina qui sotto: il sito non contatta le piattaforme dei podcast.
            </p>
          </div>

          {/* Type + Duration */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-body font-medium mb-1">Tipo episodio</label>
              <div className="inline-flex rounded-md border border-input overflow-hidden">
                {(
                  [
                    { v: "audio", label: "Audio", Icon: Headphones },
                    { v: "video", label: "Video", Icon: PlayCircle },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setForm({ ...form, podcastKind: opt.v })}
                    className={`px-3 py-2 text-sm font-body inline-flex items-center gap-2 transition-colors ${
                      form.podcastKind === opt.v
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    <opt.Icon size={14} /> {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-body font-medium mb-1">
                Durata <span className="text-muted-foreground">(opzionale)</span>
              </label>
              <input
                value={form.podcastDuration}
                onChange={(e) => setForm({ ...form, podcastDuration: e.target.value })}
                placeholder='34&#39;12"'
                className="w-full px-3 py-2.5 rounded-md border border-input bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-body font-medium mb-1">
              Titolo <span className="text-destructive">*</span>
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Titolo dell'episodio"
              className={`w-full px-3 py-2.5 rounded-md border ${
                errs.title ? "border-destructive" : "border-input"
              } bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring`}
            />
            <FieldError message={errs.title} />
          </div>

          {/* Guest / author label */}
          <div>
            <label className="block text-sm font-body font-medium mb-1">
              Ospite o autore mostrato
            </label>
            <input
              value={form.guest}
              onChange={(e) => setForm({ ...form, guest: e.target.value })}
              placeholder="es. Ospite: nome radio partner"
              className="w-full px-3 py-2.5 rounded-md border border-input bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Excerpt */}
          <div>
            <label className="block text-sm font-body font-medium mb-1">
              Descrizione breve <span className="text-destructive">*</span>
            </label>
            <textarea
              value={form.excerpt}
              onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
              rows={3}
              maxLength={400}
              placeholder="Un paragrafo che presenta l'episodio (compare nelle card e nella pagina)."
              className={`w-full px-3 py-2.5 rounded-md border ${
                errs.excerpt ? "border-destructive" : "border-input"
              } bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y`}
            />
            <div className="flex justify-between items-start">
              <FieldError message={errs.excerpt} />
              <span className="text-xs text-muted-foreground font-body">
                {form.excerpt.length} / 400
              </span>
            </div>
          </div>

          {/* Cover */}
          <div>
            <CoverImageUpload
              value={form.coverImageUrl}
              onChange={(url) => setForm({ ...form, coverImageUrl: url })}
            />
            <p className="mt-1 text-xs text-muted-foreground font-body">
              Suggerimento: estrai la copertina dall'URL host oppure carica un'immagine manualmente.
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-body font-medium mb-1">
              Note di episodio <span className="text-muted-foreground">(opzionale, supporta Markdown)</span>
            </label>
            <MarkdownEditor
              value={form.content}
              onChange={(v) => setForm({ ...form, content: v })}
              maxLength={20000}
            />
          </div>

          {globalError && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-sm text-destructive font-body">
              {globalError}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => submit("draft")}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-input bg-background text-sm font-body font-medium hover:bg-muted disabled:opacity-50"
            >
              <Save size={14} /> Salva bozza
            </button>

            <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-primary/40 bg-primary/5 text-primary text-sm font-body font-medium hover:bg-primary/10 disabled:opacity-50"
                >
                  <CalendarClock size={14} /> Programma
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-3">
                <p className="text-sm font-body font-medium">Programma pubblicazione</p>
                <div className="space-y-2">
                  <input
                    type="date"
                    min={todayIso}
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm font-body"
                  />
                  <select
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm font-body"
                  >
                    <option value="">Orario (slot di 30 min)</option>
                    {halfHourSlots.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScheduleOpen(false);
                    submit("schedule");
                  }}
                  disabled={submitting || !scheduleDate || !scheduleTime}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-body font-medium hover:opacity-90 disabled:opacity-50"
                >
                  <CalendarClock size={14} /> Conferma programmazione
                </button>
              </PopoverContent>
            </Popover>

            <button
              type="submit"
              disabled={submitting}
              className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-body font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {currentStatus === "published" ? "Aggiorna pubblicazione" : "Pubblica ora"}
            </button>
          </div>

          {form.coverImageUrl && form.title && (
            <div className="mt-8 p-4 rounded-lg border border-border bg-card">
              <p className="text-xs uppercase tracking-widest font-bold text-muted-foreground mb-3">
                Anteprima card
              </p>
              <div className="flex gap-4">
                <div className="relative w-40 aspect-video rounded overflow-hidden border border-border shrink-0">
                  <img
                    src={form.coverImageUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-foreground/20">
                    <KindIcon size={32} className="text-background drop-shadow-lg" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-body text-muted-foreground mb-1">
                    {form.podcastKind === "video" ? "Video" : "Podcast"}
                    {form.podcastDuration ? ` · ${form.podcastDuration}` : ""}
                  </p>
                  <p className="font-display font-semibold line-clamp-2">{form.title}</p>
                  <p className="text-sm font-body text-muted-foreground line-clamp-2 mt-1">
                    {form.excerpt}
                  </p>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default PodcastEditor;
