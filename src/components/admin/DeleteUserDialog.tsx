import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { invokeFunction } from "@/lib/invokeFunction";

type Preview = { posts: number; published: number; submissions: number; realities: number };

type Props = {
  user: { id: string; name: string } | null;
  onClose: () => void;
  onDone: (msg: string, ok: boolean) => void;
};

const DeleteUserDialog = ({ user, onClose, onDone }: Props) => {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [mode, setMode] = useState<"keep" | "all" | "">("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    setLoadErr("");
    setMode("");
    setConfirmText("");
    if (!user) return;
    invokeFunction<{ preview: Preview }>("manage-user", {
      op: "delete_user_preview",
      user_id: user.id,
    }).then(({ data, error }) => {
      if (error) setLoadErr(error);
      else setPreview(data?.preview ?? null);
    });
  }, [user]);

  const canConfirm =
    !!preview && !!mode && (mode === "keep" || confirmText.trim() === "ELIMINA") && !busy;

  const run = async () => {
    if (!user || !mode) return;
    setBusy(true);
    const { data, error } = await invokeFunction<{ warnings?: string[] }>("manage-user", {
      op: "delete_user",
      user_id: user.id,
      mode,
    });
    setBusy(false);
    if (error) {
      onDone(error, false);
      return;
    }
    const warn = data?.warnings?.length ? ` Avviso: ${data.warnings.join("; ")}` : "";
    onDone(
      (mode === "keep" ? "Utente eliminato, articoli mantenuti." : "Utente e contenuti eliminati.") + warn,
      true,
    );
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Eliminare {user?.name}?</DialogTitle>
        </DialogHeader>
        {loadErr ? (
          <p className="text-sm text-destructive font-body">{loadErr}</p>
        ) : !preview ? (
          <p className="text-sm text-muted-foreground font-body">
            <Loader2 size={14} className="inline animate-spin mr-1" /> Calcolo contenuti…
          </p>
        ) : (
          <div className="space-y-4 font-body text-sm">
            <p>
              Questo utente ha <strong>{preview.posts}</strong> articoli ({preview.published} pubblicati) e{" "}
              <strong>{preview.submissions}</strong> candidature editoriali. Le{" "}
              {preview.realities} realtà proposte restano sempre sulla mappa.
            </p>
            <label className="flex gap-3 p-3 rounded-md border border-border cursor-pointer has-[:checked]:border-primary">
              <input type="radio" name="del-mode" checked={mode === "keep"} onChange={() => setMode("keep")} />
              <span>
                <strong>Elimina l'utente e mantieni i post</strong>
                <span className="block text-xs text-muted-foreground">
                  Gli articoli restano pubblicati con la firma originale, senza link al profilo. Le candidature restano anonime.
                </span>
              </span>
            </label>
            <label className="flex gap-3 p-3 rounded-md border border-border cursor-pointer has-[:checked]:border-destructive">
              <input type="radio" name="del-mode" checked={mode === "all"} onChange={() => setMode("all")} />
              <span>
                <strong>Elimina tutto</strong>
                <span className="block text-xs text-muted-foreground">
                  Rimuove anche i {preview.posts} articoli, le candidature e le copertine caricate.
                </span>
              </span>
            </label>
            {mode === "all" && (
              <div>
                <label className="block text-xs mb-1">Scrivi ELIMINA per confermare</label>
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              In entrambi i casi spariscono profilo, avatar, notifiche e segnalibri. Operazione irreversibile.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 rounded-md border border-input text-sm">
                Annulla
              </button>
              <button
                type="button"
                onClick={run}
                disabled={!canConfirm}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Elimina
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DeleteUserDialog;
