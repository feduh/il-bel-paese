// Impacchetta le Edge Functions in file autonomi, per il server self-hosted.
// Ogni funzione diventa un unico file con tutte le dipendenze dentro: a runtime non scarica nulla
// da esm.sh, deno.land, jsr.io o dal registro npm. Se una funzione importa un indirizzo remoto non
// previsto, la build si ferma.
//
// Uso: node scripts/bundle-functions.mjs   →   deploy/functions/<nome>/index.ts
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath invece di import.meta.dirname: funziona anche con Node 18 (quello di Ubuntu 24.04)
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "deploy/functions");
const shimCors = join(root, "deploy/functions-src/shims/cors.ts");

const FUNCTIONS = {
  main: "deploy/functions-src/main/index.ts",
  "geocode-address": "supabase/functions/geocode-address/index.ts",
  "invite-collaborator": "supabase/functions/invite-collaborator/index.ts",
  "manage-user": "supabase/functions/manage-user/index.ts",
};

// Indirizzi remoti ammessi e pacchetto npm locale che li sostituisce
const REMOTE = [
  [/^npm:@supabase\/supabase-js@2\/cors$/, shimCors],
  [/^npm:@supabase\/supabase-js@[^/]+$/, "@supabase/supabase-js"],
  [/^https:\/\/esm\.sh\/@supabase\/supabase-js@[^/]+$/, "@supabase/supabase-js"],
  [/^https:\/\/deno\.land\/x\/zod@[^/]+\/mod\.ts$/, "zod"],
  [/^jsr:@panva\/jose@6$/, "jose"],
];

const vendorPlugin = {
  name: "vendor-remote-imports",
  setup(b) {
    b.onResolve({ filter: /^(https?:|npm:|jsr:)/ }, async (args) => {
      const hit = REMOTE.find(([re]) => re.test(args.path));
      if (!hit) {
        return { errors: [{ text: `Import remoto non previsto: ${args.path} (aggiungilo a REMOTE con un pacchetto locale)` }] };
      }
      const target = hit[1];
      if (target.startsWith("/")) return { path: target };
      const r = await b.resolve(target, { kind: args.kind, resolveDir: root });
      return { path: r.path, errors: r.errors };
    });
  },
};

if (existsSync(out)) rmSync(out, { recursive: true });
for (const [name, entry] of Object.entries(FUNCTIONS)) {
  const outfile = join(out, name, "index.ts");
  mkdirSync(join(out, name), { recursive: true });
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    mainFields: ["module", "main"],
    conditions: ["deno", "worker", "browser", "import"],
    plugins: [vendorPlugin],
    banner: { js: `// Generato da scripts/bundle-functions.mjs a partire da ${entry}. Non modificare a mano.\n// @ts-nocheck` },
    logLevel: "warning",
  });
  const code = readFileSync(outfile, "utf8");
  const leaks = code.match(/(?:from\s*|import\s*\(\s*)["'](?:https?:|npm:|jsr:)[^"']*["']/g);
  if (leaks) throw new Error(`${name}: restano import remoti: ${leaks.join(", ")}`);
  console.log(`${name}: ${(code.length / 1024).toFixed(0)} kB`);
}
// File vuoto richiesto dal router (importMapPath): nessuna mappa, tutto è già nei pacchetti
writeFileSync(join(out, "deno.jsonc"), "{}\n");
