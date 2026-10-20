import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  FileText,
  Plus,
  Edit3,
  Trash2,
  ExternalLink,
  Clock,
  CheckCircle2,
  Search,
  X,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
} from "lucide-react";
import SmartImage from "@/components/SmartImage";
import type { AreaPost, AreaPostStatus } from "./types";

const STATUS_LABEL: Record<AreaPostStatus, { label: string; tone: string; icon: typeof Clock }> = {
  draft: { label: "Bozza", tone: "bg-zinc-700 text-white", icon: FileText },
  pending: { label: "In moderazione", tone: "bg-amber-500 text-white", icon: Clock },
  scheduled: { label: "In revisione / programmato", tone: "bg-sky-600 text-white", icon: Clock },
  rejected: { label: "Respinto", tone: "bg-destructive text-destructive-foreground", icon: X },
  published: { label: "Pubblicato", tone: "bg-emerald-600 text-white", icon: CheckCircle2 },
};

type SortKey = "recent" | "oldest" | "az" | "za";

type Props = {
  posts: AreaPost[];
  isStaff: boolean;
  onChanged: () => void;
  presetCategory?: string;
  title?: string;
  icon?: typeof FileText;
  newLabel?: string;
  newHref?: string;
  editHrefBuilder?: (postId: string) => string;
};

const PanelArticoli = ({ posts, isStaff, onChanged, presetCategory, title, icon: TitleIcon = FileText, newLabel, newHref: newHrefProp, editHrefBuilder }: Props) => {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AreaPostStatus>("all");
  const [sort, setSort] = useState<SortKey>("recent");

  const deletePost = async (id: string) => {
    if (!confirm("Eliminare definitivamente questo articolo?")) return;
    const { error } = await supabase.from("blog_posts").delete().eq("id", id);
    if (error) alert(`Errore: ${error.message}`);
    else onChanged();
  };

  const scopedPosts = useMemo(() => {
    const inCategory = (p: AreaPost, cat: string) =>
      (p.category ?? "")
        .toLowerCase()
        .split(",")
        .map((c) => c.trim())
        .includes(cat.toLowerCase());
    if (presetCategory) return posts.filter((p) => inCategory(p, presetCategory));
    // Default "Articoli" view: esclude podcast ed editoriali (hanno tab dedicate)
    return posts.filter(
      (p) => !inCategory(p, "Podcast") && !inCategory(p, "Editoriali"),
    );
  }, [posts, presetCategory]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = scopedPosts.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.excerpt.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "az": return a.title.localeCompare(b.title, "it");
        case "za": return b.title.localeCompare(a.title, "it");
        case "oldest": return new Date(a.published_at).getTime() - new Date(b.published_at).getTime();
        case "recent":
        default: return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
      }
    });
    return list;
  }, [scopedPosts, query, statusFilter, sort]);

  const defaultNewHref = presetCategory
    ? `/area-personale/articolo/nuovo?category=${encodeURIComponent(presetCategory)}`
    : "/area-personale/articolo/nuovo";
  const newHref = newHrefProp ?? defaultNewHref;
  const buildEditHref = editHrefBuilder ?? ((pid: string) => `/area-personale/articolo/${pid}/modifica`);
  const displayTitle = title ?? "I miei articoli";
  const displayNewLabel = newLabel ?? "Nuovo articolo";

  return (
    <section className="p-8 rounded-lg bg-card border border-border">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <h2 className="font-display text-xl font-semibold flex items-center gap-2">
          <TitleIcon size={20} /> {displayTitle}
          <span className="text-base font-body text-muted-foreground">({scopedPosts.length})</span>
        </h2>
        <Link
          to={newHref}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-body font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> {displayNewLabel}
        </Link>
      </div>


      {/* Filtri */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca per titolo, estratto, categoria…"
            className="w-full pl-9 pr-9 py-2.5 rounded-md border border-input bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Pulisci"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-3 py-2.5 rounded-md border border-input bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">Tutti gli stati</option>
          <option value="draft">Bozze</option>
          <option value="pending">In moderazione</option>
          <option value="scheduled">In revisione / programmati</option>
          <option value="rejected">Respinti</option>
          <option value="published">Pubblicati</option>
        </select>
        <div className="inline-flex items-center rounded-md border border-input bg-background overflow-hidden">
          {(
            [
              { v: "recent", label: "Recenti", icon: CalendarArrowDown },
              { v: "oldest", label: "Vecchi", icon: CalendarArrowUp },
              { v: "az", label: "A→Z", icon: ArrowDownAZ },
              { v: "za", label: "Z→A", icon: ArrowUpAZ },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setSort(opt.v)}
              className={`px-2.5 py-2.5 text-xs font-body inline-flex items-center gap-1 transition-colors ${
                sort === opt.v ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
              title={opt.label}
              aria-label={opt.label}
            >
              <opt.icon size={14} />
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground font-body italic">
          {scopedPosts.length === 0 ? (presetCategory ? `Non hai ancora contenuti in "${presetCategory}".` : "Non hai ancora scritto articoli.") : "Nessun articolo corrisponde ai filtri."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const s = STATUS_LABEL[p.status];
            const Icon = s.icon;
            const canEdit = p.status !== "published" || isStaff;
            return (
              <article
                key={p.id}
                className="group flex flex-col rounded-lg border border-border bg-background overflow-hidden hover:border-primary/40 transition-colors"
              >
                <div className="aspect-video bg-muted relative overflow-hidden">
                  {p.cover_image_url ? (
                    <SmartImage
                      src={p.cover_image_url}
                      alt=""
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <FileText size={32} />
                    </div>
                  )}
                  <span
                    className={`absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-sm shadow-md ${s.tone}`}
                  >
                    <Icon size={10} /> {s.label}
                  </span>
                </div>
                <div className="flex-1 flex flex-col p-4">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-xs font-body text-muted-foreground">{p.category}</span>
                  </div>
                  <h3 className="font-display font-semibold mb-2 line-clamp-2">{p.title}</h3>
                  {p.status === "scheduled" && p.scheduled_for && (
                    <p className="text-xs font-body text-sky-600 mb-2">
                      {p.submitted_at ? "In revisione, pubblicazione il " : "Programmato: "}
                      {new Date(p.scheduled_for).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" })}
                    </p>
                  )}
                  {p.status === "rejected" && p.rejection_note && (
                    <p className="text-xs font-body text-destructive mb-2 line-clamp-3">
                      Nota: {p.rejection_note}
                    </p>
                  )}
                  <p className="text-sm font-body text-muted-foreground line-clamp-3 flex-1">{p.excerpt}</p>
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                    {p.status === "published" && (
                      <Link
                        to={`/bollettino/${p.slug}`}
                        className="p-2 rounded-md border border-border hover:border-primary/40 transition-colors"
                        title="Vedi pubblicato"
                      >
                        <ExternalLink size={14} />
                      </Link>
                    )}
                    {canEdit && (
                      <Link
                        to={buildEditHref(p.id)}
                        className="p-2 rounded-md border border-border hover:border-primary/40 transition-colors"
                        title="Modifica"
                      >
                        <Edit3 size={14} />
                      </Link>
                    )}
                    {(p.status !== "published" || isStaff) && (
                      <button
                        onClick={() => deletePost(p.id)}
                        className="p-2 rounded-md text-destructive hover:bg-destructive/10 transition-colors ml-auto"
                        title="Elimina"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default PanelArticoli;
