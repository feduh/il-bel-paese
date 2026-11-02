// Funzioni condivise dagli script di migrazione. Nessuna dipendenza esterna: solo Node 18+.
import { readFileSync, existsSync } from "node:fs";

/** Legge un file di esportazione. Accetta sia l'oggetto puro sia la risposta di query_database ({ rows: [{ export: … }] }). */
export function readExport(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw && Array.isArray(raw.rows)) return raw.rows[0].export;
  if (raw && raw.export) return raw.export;
  return raw;
}

export function readIdMap(path) {
  return path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

/**
 * Sostituisce ovunque gli ID utente vecchi con quelli nuovi e il vecchio indirizzo del database con il nuovo.
 * Gli UUID sono unici, quindi una sostituzione testuale è sicura e copre anche URL dei file, percorsi e JSON annidati
 * (per esempio old_data/new_data del registro di audit).
 */
export function remapText(text, idMap, oldBase, newBase) {
  let out = text;
  for (const [oldId, newId] of Object.entries(idMap)) {
    if (oldId !== newId) out = out.split(oldId).join(newId);
  }
  if (oldBase && newBase && oldBase !== newBase) out = out.split(oldBase).join(newBase);
  return out;
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Variabile d'ambiente mancante: ${name}`);
    process.exit(1);
  }
  return v.replace(/\/$/, "");
}
