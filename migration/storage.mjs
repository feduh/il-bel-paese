// File caricati (avatar, copertine, immagini delle realtà).
//
// 1) Elenco dei link da scaricare dal vecchio storage (i bucket sono pubblici, basta il browser):
//      node migration/storage.mjs links migration/data/04_utenti_e_file.json > migration/data/link-file.md
//    Salva ogni file in migration/data/files/<bucket>/<percorso>, mantenendo il percorso indicato.
//
// 2) Caricamento sul nuovo server, con gli ID utente aggiornati nei percorsi:
//      NEW_SUPABASE_URL=… NEW_SERVICE_ROLE_KEY=… \
//      node migration/storage.mjs upload migration/data/04_utenti_e_file.json migration/data/files migration/data/id-map.json
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readExport, readIdMap, remapText, requireEnv } from "./lib.mjs";

const [, , cmd, exportPath, filesDir = "migration/data/files", mapPath = "migration/data/id-map.json"] = process.argv;
if (!cmd || !exportPath) {
  console.error("Uso: node migration/storage.mjs links|upload <04_utenti_e_file.json> [cartella-file] [id-map.json]");
  process.exit(1);
}

const { storage_objects: objects, storage_buckets: buckets } = readExport(exportPath);

if (cmd === "links") {
  const oldBase = process.env.OLD_SUPABASE_URL ?? "https://wxvexxwviaqxxnrrbshs.supabase.co";
  console.log(`# File da scaricare (${objects.length})\n`);
  for (const o of objects) {
    const isPublic = buckets.find((b) => b.id === o.bucket_id)?.public;
    const link = `${oldBase}/storage/v1/object/public/${o.bucket_id}/${o.name.split("/").map(encodeURIComponent).join("/")}`;
    console.log(`- [ ] \`files/${o.bucket_id}/${o.name}\` (${o.size} byte)${isPublic ? "" : " — BUCKET PRIVATO, serve un altro metodo"}\n  ${link}`);
  }
  process.exit(0);
}

if (cmd !== "upload") {
  console.error(`Comando sconosciuto: ${cmd}`);
  process.exit(1);
}

const url = requireEnv("NEW_SUPABASE_URL");
const key = requireEnv("NEW_SERVICE_ROLE_KEY");
const idMap = readIdMap(mapPath);
let ok = 0;
const problems = [];

for (const o of objects) {
  const local = join(filesDir, o.bucket_id, o.name);
  if (!existsSync(local)) {
    problems.push(`manca il file locale ${local}`);
    continue;
  }
  const newPath = remapText(o.name, idMap);
  const r = await fetch(`${url}/storage/v1/object/${o.bucket_id}/${newPath.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": o.mimetype || "application/octet-stream",
      "x-upsert": "true",
    },
    body: readFileSync(local),
  });
  if (r.ok) ok++;
  else problems.push(`${o.bucket_id}/${newPath}: ${r.status} ${await r.text()}`);
}

console.log(`File caricati: ${ok} su ${objects.length}.`);
if (problems.length) {
  console.log("Problemi:\n" + problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}
