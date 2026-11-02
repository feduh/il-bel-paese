# Migrazione dei dati da Lovable Cloud

Strumenti per spostare dati e schema di Il Bel Paese da Lovable Cloud a un Supabase installato in proprio.
Il piano completo, con l'ordine dei passaggi e le verifiche, è nel documento di migrazione; qui ci sono solo gli strumenti.

> **I dati esportati contengono informazioni personali** (email, profili, messaggi di contatto).
> Vanno salvati in `migration/data/`, che è esclusa dal repository. Non vanno mai committati.

## Perché non si riapplicano le 76 migrazioni

Le migrazioni in `supabase/migrations/` non funzionano su un database vuoto: alcune inseriscono dati che non esistono più
(per esempio un profilo collegato a una realtà di prova cancellata) e alcune **creano account di prova con password scritte
nel codice** (`admin@admin.it`, `coordinatore@test.it`, `author@test.it`). Lo schema del nuovo server si costruisce quindi
dallo stato reale del database (`export/00_schema_ddl.sql`) e si verifica confrontando le due "fotografie" (`export/05_schema.sql`).

## Contenuto

| File | A cosa serve |
| --- | --- |
| `export/00_schema_ddl.sql` | Genera `baseline.sql`: tabelle, funzioni, vincoli, indici, RLS, policy, trigger, permessi, realtime, bucket, job pianificati |
| `export/01_contenuti.sql` | Realtà, tag, immagini, articoli, edizioni, special issue, candidature |
| `export/02_persone.sql` | Profili, ruoli, segnalibri, notifiche, messaggi di contatto, segnalazioni |
| `export/03_audit.sql` | Registro di audit |
| `export/04_utenti_e_file.sql` | Utenti **senza password né token**, bucket ed elenco dei file |
| `export/05_schema.sql` | Fotografia dello schema da lanciare su entrambi i database: i risultati devono coincidere |
| `export/06_funzioni_sorgente.sql` | Testo completo delle funzioni, per indagare una differenza |
| `create-users.mjs` | Ricrea gli utenti sul nuovo server senza password e salva la mappa ID vecchi → nuovi |
| `build-import.mjs` | Trasforma l'esportazione in `import.sql` (una transazione, senza far scattare trigger e notifiche) |
| `storage.mjs` | `links`: elenco dei file da scaricare; `upload`: caricamento sul nuovo storage |
| `test/` | Prova locale: simulazione degli schemi Supabase e riapplicazione delle migrazioni |

## Sequenza

1. **Esportazione** (sul vecchio database, appena torna raggiungibile): lanciare `00`–`05` e salvare ogni risultato in
   `migration/data/` con lo stesso nome (`00_schema_ddl.sql` → `baseline.sql`, gli altri `.json`).
2. **File**: `node migration/storage.mjs links migration/data/04_utenti_e_file.json > migration/data/link-file.md`,
   poi scaricare ogni file in `migration/data/files/<bucket>/<percorso>`.
3. **Schema** (sul nuovo Supabase, vuoto): applicare `baseline.sql`, poi lanciare `05_schema.sql` e confrontarlo con
   quello del vecchio database. Le uniche differenze ammesse sono parentesi in più o in meno nelle policy.
4. **Utenti**: `create-users.mjs` (vedi intestazione dello script per le variabili d'ambiente).
5. **Dati**: `build-import.mjs` → `import.sql` → applicarlo; l'ultima query stampa i conteggi da confrontare.
6. **File**: `node migration/storage.mjs upload …`.
7. **Accesso**: ogni utente imposta una nuova password con "Password dimenticata". Gli utenti sospesi vanno risospesi.

## Prova locale

Su un Postgres di prova: caricare `test/supabase-stub.sql`, poi `test/replay.sh "psql …"` per vedere fin dove arrivano le
migrazioni, oppure applicare un `baseline.sql` generato e confrontare le fotografie. Lo stub simula solo ciò che serve alle
migrazioni e non va mai usato su un server vero.
