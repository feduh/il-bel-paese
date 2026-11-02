// Ricrea gli utenti sul nuovo server, SENZA password, e salva la corrispondenza tra ID vecchi e nuovi.
// Ogni persona imposterà poi la propria password con "Password dimenticata".
//
// Uso:
//   NEW_SUPABASE_URL=https://api.tuodominio.it NEW_SERVICE_ROLE_KEY=... \
//   node migration/create-users.mjs migration/data/04_utenti_e_file.json migration/data/id-map.json
//
// Si può rilanciare senza danni: un utente già presente (stessa email) viene riconosciuto e non duplicato.
import { writeFileSync } from "node:fs";
import { readExport, readIdMap, requireEnv } from "./lib.mjs";

const [, , exportPath, mapPath = "migration/data/id-map.json"] = process.argv;
if (!exportPath) {
  console.error("Uso: node migration/create-users.mjs <04_utenti_e_file.json> [id-map.json]");
  process.exit(1);
}

const url = requireEnv("NEW_SUPABASE_URL");
const key = requireEnv("NEW_SERVICE_ROLE_KEY");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const { auth_users: users } = readExport(exportPath);
const idMap = readIdMap(mapPath);

async function listExisting() {
  const byEmail = new Map();
  for (let page = 1; ; page++) {
    const r = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!r.ok) throw new Error(`Elenco utenti fallito: ${r.status} ${await r.text()}`);
    const body = await r.json();
    const list = body.users ?? [];
    for (const u of list) byEmail.set(u.email?.toLowerCase(), u.id);
    if (list.length < 200) break;
  }
  return byEmail;
}

const existing = await listExisting();
let created = 0;
let reused = 0;

for (const u of users) {
  const email = u.email?.toLowerCase();
  if (!email) {
    console.warn(`Utente ${u.id} senza email: saltato.`);
    continue;
  }
  if (existing.has(email)) {
    idMap[u.id] = existing.get(email);
    reused++;
    continue;
  }
  // Si prova a mantenere lo stesso ID; se il server lo ignora, la mappa registra quello nuovo.
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: u.id, email: u.email, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`Creazione di ${u.email} fallita: ${r.status} ${await r.text()}`);
  const body = await r.json();
  idMap[u.id] = body.id ?? body.user?.id;
  created++;
}

writeFileSync(mapPath, JSON.stringify(idMap, null, 2));
const changed = Object.entries(idMap).filter(([a, b]) => a !== b).length;
console.log(`Utenti: ${created} creati, ${reused} già presenti. ID cambiati: ${changed}. Mappa salvata in ${mapPath}.`);
console.log("Gli utenti sospesi (banned_until) vanno risospesi a mano dal pannello admin dopo l'import.");
