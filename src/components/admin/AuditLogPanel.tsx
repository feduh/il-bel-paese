import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollText, RefreshCcw, Download } from "lucide-react";

type AuditEntry = {
  id: string;
  actor_email: string | null;
  action: "INSERT" | "UPDATE" | "DELETE" | "DELETE_USER" | "DELETE_USER_NOTE";
  table_name: string;
  row_id: string | null;
  created_at: string;
  new_data: Record<string, unknown> | null;
  old_data: Record<string, unknown> | null;
};

const tableLabel: Record<string, string> = {
  realities: "Realtà",
  blog_posts: "Articolo",
  user_roles: "Ruolo utente",
  "auth.users": "Utente",
};

const actionStyle: Record<AuditEntry["action"], string> = {
  INSERT: "bg-secondary/15 text-secondary",
  UPDATE: "bg-primary/10 text-primary",
  DELETE: "bg-destructive/10 text-destructive",
  DELETE_USER: "bg-destructive/15 text-destructive",
  DELETE_USER_NOTE: "bg-muted text-muted-foreground",
};

const actionLabel: Record<AuditEntry["action"], string> = {
  INSERT: "Creato",
  UPDATE: "Modificato",
  DELETE: "Eliminato",
  DELETE_USER: "Utente eliminato",
  DELETE_USER_NOTE: "Nota eliminazione",
};

const describeRow = (entry: AuditEntry): string => {
  const data = entry.new_data ?? entry.old_data ?? {};
  const d = data as Record<string, unknown>;
  if (entry.action === "DELETE_USER") {
    return `ID ${entry.row_id?.slice(0, 8)} · ${d.mode === "all" ? "elimina tutto" : "mantieni i post"} · ${d.posts_count ?? 0} articoli`;
  }
  if (entry.action === "DELETE_USER_NOTE") return String(d.note ?? "");
  return (
    (d.name as string) ||
    (d.title as string) ||
    (d.role as string) ||
    entry.row_id?.slice(0, 8) ||
    "—"
  );
};

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
};

const exportCsv = (rows: AuditEntry[]) => {
  const header = ["created_at", "actor_email", "action", "table_name", "row_id", "summary"];
  const body = rows.map((e) => [
    e.created_at,
    e.actor_email ?? "",
    e.action,
    e.table_name,
    e.row_id ?? "",
    describeRow(e),
  ]);
  const csv = [header, ...body].map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `audit-log-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const AuditLogPanel = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("admin_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setEntries((data as AuditEntry[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = filter === "all" ? entries : entries.filter((e) => e.table_name === filter);

  return (
    <div className="p-8 rounded-lg bg-card border border-border mb-12">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-xl font-semibold mb-1 flex items-center gap-2">
            <ScrollText size={20} /> Registro azioni
          </h2>
          <p className="text-sm text-muted-foreground font-body">
            Ultime 100 azioni di admin, coordinatori e autori sul database.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 rounded-md border border-input bg-background font-body text-xs"
            aria-label="Filtra per tabella"
          >
            <option value="all">Tutte le tabelle</option>
            <option value="realities">Realtà</option>
            <option value="blog_posts">Articoli</option>
            <option value="user_roles">Ruoli</option>
          </select>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-input font-body text-xs hover:border-primary/40 transition-colors"
            aria-label="Ricarica registro"
          >
            <RefreshCcw size={12} /> Aggiorna
          </button>
          <button
            type="button"
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-input font-body text-xs hover:border-primary/40 transition-colors disabled:opacity-50"
            aria-label="Esporta CSV"
            title="Scarica CSV"
          >
            <Download size={12} /> Esporta CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground font-body text-sm">Caricamento…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground font-body text-sm">
          Nessuna azione registrata.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                <th className="py-2 pr-4">Quando</th>
                <th className="py-2 pr-4">Chi</th>
                <th className="py-2 pr-4">Azione</th>
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2">Oggetto</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString("it-IT", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-2 pr-4 text-xs truncate max-w-[180px]">
                    {e.actor_email || "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionStyle[e.action]}`}>
                      {actionLabel[e.action]}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {tableLabel[e.table_name] || e.table_name}
                  </td>
                  <td className="py-2 text-xs truncate max-w-[260px]" title={describeRow(e)}>
                    {describeRow(e)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AuditLogPanel;
