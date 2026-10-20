import { useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Clock, Trash2 } from "lucide-react";
import { resolveAuthorName } from "@/lib/authorNames";
import type { AreaModerationPost } from "./types";

type Props = {
  queue: AreaModerationPost[];
  nameMap: Record<string, string>;
  onChanged: () => void;
};

const fmtRome = (iso: string) =>
  new Date(iso).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" });

const remaining = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "in pubblicazione";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `mancano ${h}h ${m}m`;
};

const PanelModerazione = ({ queue, nameMap, onChanged }: Props) => {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const run = async (id: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setProcessingId(id);
    const { error } = await fn();
    setProcessingId(null);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(ok);
    onChanged();
    return true;
  };

  const publish = (id: string) =>
    run(
      id,
      () => supabase.from("blog_posts").update({ status: "published", published_at: new Date().toISOString() }).eq("id", id),
      "Articolo pubblicato",
    );

  const reject = async (id: string) => {
    if (!note.trim()) {
      toast.error("Inserisci una nota per l'autore.");
      return;
    }
    const done = await run(
      id,
      () => supabase.from("blog_posts").update({ status: "rejected", rejection_note: note.trim() }).eq("id", id),
      "Articolo respinto: l'autore riceverà la nota",
    );
    if (done) {
      setRejectingId(null);
      setNote("");
    }
  };

  const remove = (id: string) => {
    if (!confirm("Eliminare l'articolo?")) return;
    void run(id, () => supabase.from("blog_posts").delete().eq("id", id), "Articolo eliminato");
  };

  return (
    <section className="p-8 rounded-lg bg-card border border-amber-500/30">
      <h2 className="font-display text-xl font-semibold mb-2 flex items-center gap-2">
        <Clock size={20} className="text-amber-600" /> Articoli in revisione
        <span className="text-base font-body text-muted-foreground">({queue.length})</span>
      </h2>
      <p className="text-sm text-muted-foreground font-body mb-6">
        Gli articoli degli autori si pubblicano da soli alla data indicata. Puoi fermarli prima con "Respingi".
      </p>
      {queue.length === 0 ? (
        <p className="text-sm text-muted-foreground font-body italic">Nessun articolo in revisione.</p>
      ) : (
        <div className="space-y-3">
          {queue.map((p) => (
            <div key={p.id} className="p-4 rounded-md border border-border bg-background">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-display font-semibold mb-1">{p.title}</p>
                  <p className="text-xs text-muted-foreground font-body mb-1">
                    di {resolveAuthorName(nameMap, p.user_id, p.author_name)} · {p.category}
                  </p>
                  {p.scheduled_for && (
                    <p className="text-xs font-body text-sky-600 mb-1">
                      Pubblicazione il {fmtRome(p.scheduled_for)} ({remaining(p.scheduled_for)})
                    </p>
                  )}
                  <p className="text-sm font-body text-muted-foreground line-clamp-2">{p.excerpt}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/area-personale/articolo/${p.id}/modifica`}
                    className="text-xs font-body px-3 py-1.5 rounded-md border border-border hover:border-primary/40"
                  >
                    Apri
                  </Link>
                  <button
                    onClick={() => publish(p.id)}
                    disabled={!!processingId}
                    className="text-xs font-body px-3 py-1.5 rounded-md border border-border hover:border-primary/40 disabled:opacity-50"
                  >
                    Pubblica subito
                  </button>
                  <button
                    onClick={() => { setRejectingId(rejectingId === p.id ? null : p.id); setNote(""); }}
                    disabled={!!processingId}
                    className="text-xs font-body px-3 py-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    Respingi
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    disabled={!!processingId}
                    className="text-xs font-body px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    title="Elimina"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {rejectingId === p.id && (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Nota per l'autore (obbligatoria): cosa va cambiato?"
                    className="w-full px-3 py-2 rounded-md border border-input bg-background font-body text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setRejectingId(null)} className="text-xs px-3 py-1.5 rounded-md border border-input">
                      Annulla
                    </button>
                    <button
                      onClick={() => reject(p.id)}
                      disabled={!!processingId || !note.trim()}
                      className="text-xs px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground disabled:opacity-50"
                    >
                      Conferma rifiuto
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default PanelModerazione;
