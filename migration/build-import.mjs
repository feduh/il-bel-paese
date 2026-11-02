// Trasforma i file di esportazione in un unico import.sql da lanciare sul nuovo database.
//
// Uso:
//   OLD_SUPABASE_URL=https://wxvexxwviaqxxnrrbshs.supabase.co NEW_SUPABASE_URL=https://api.tuodominio.it \
//   node migration/build-import.mjs migration/data migration/data/id-map.json > migration/data/import.sql
//
// Il file prodotto:
// - lavora in un'unica transazione (o entra tutto o niente);
// - disattiva temporaneamente trigger e controlli delle chiavi esterne (session_replication_role = replica),
//   così l'import non genera notifiche, righe di audit o validazioni pensate per gli utenti;
// - sostituisce ID utente e indirizzo del vecchio database;
// - alla fine stampa il numero di righe per tabella, da confrontare con l'esportazione.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readExport, readIdMap, remapText } from "./lib.mjs";

const [, , dataDir = "migration/data", mapPath = join(dataDir, "id-map.json")] = process.argv;
const oldBase = process.env.OLD_SUPABASE_URL ?? "https://wxvexxwviaqxxnrrbshs.supabase.co";
const newBase = process.env.NEW_SUPABASE_URL;
if (!newBase) {
  console.error("Variabile d'ambiente mancante: NEW_SUPABASE_URL");
  process.exit(1);
}

// Ordine compatibile con le chiavi esterne (utile anche se i controlli sono sospesi durante l'import).
const ORDER = [
  "realities", "reality_tags", "reality_images",
  "profiles", "user_roles",
  "editorial_editions", "editorial_special_issues",
  "blog_posts", "editorial_submissions",
  "reality_bookmarks", "notifications",
  "contact_messages", "reality_reports",
  "admin_audit_log",
];

const tables = {};
for (const f of readdirSync(dataDir).filter((f) => /^0[1-3]_.*\.json$/.test(f)).sort()) {
  Object.assign(tables, readExport(join(dataDir, f)));
}
const missing = ORDER.filter((t) => !(t in tables));
if (missing.length) {
  console.error(`Mancano tabelle nell'esportazione: ${missing.join(", ")}`);
  process.exit(1);
}

const idMap = readIdMap(mapPath);
const TAG = "$ibp_import$";
const out = [];
out.push("-- Generato da migration/build-import.mjs. Non modificare a mano.");
out.push("BEGIN;");
out.push("SET LOCAL session_replication_role = replica;");
out.push("SET LOCAL app.skip_audit = 'on';");

for (const t of ORDER) {
  const rows = tables[t];
  if (!rows.length) continue;
  const json = remapText(JSON.stringify(rows), idMap, oldBase, newBase.replace(/\/$/, ""));
  if (json.includes(TAG)) throw new Error(`Il contenuto di ${t} contiene il delimitatore ${TAG}`);
  out.push(`-- ${t}: ${rows.length} righe`);
  out.push(`INSERT INTO public.${t} SELECT * FROM jsonb_populate_recordset(NULL::public.${t}, ${TAG}${json}${TAG}::jsonb);`);
}

// Riallinea eventuali contatori (colonne con default nextval) al valore massimo importato.
out.push(`DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name, column_name, pg_get_serial_sequence('public.' || table_name, column_name) AS seq
           FROM information_schema.columns
           WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'
  LOOP
    IF r.seq IS NOT NULL THEN
      EXECUTE format('SELECT setval(%L, COALESCE((SELECT max(%I) FROM public.%I), 0) + 1, false)', r.seq, r.column_name, r.table_name);
    END IF;
  END LOOP;
END $$;`);

out.push("COMMIT;");
out.push("");
out.push("-- Verifica: righe importate per tabella (devono coincidere con l'esportazione)");
out.push(
  "SELECT " +
    ORDER.map((t) => `(SELECT count(*) FROM public.${t}) AS ${t}`).join(",\n       ") +
    ";",
);
out.push(`-- Attese: ${ORDER.map((t) => `${t}=${tables[t].length}`).join(", ")}`);

process.stdout.write(out.join("\n") + "\n");
