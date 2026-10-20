# Piano: eliminazione utente a due opzioni + revisione di 24 ore per gli autori

Requisito trasversale: ogni regola è applicata dal database (policy RLS, trigger, funzioni `SECURITY DEFINER`). L'interfaccia si limita a mostrarla. Tutti i messaggi di errore sono in italiano.

## Stato attuale verificato (lettura del database)

- `blog_posts.user_id` → `auth.users` **ON DELETE CASCADE**, colonna NOT NULL.
- `editorial_submissions.author_user_id` → `auth.users` **ON DELETE CASCADE**, colonna NOT NULL.
- `realities.created_by` è un uuid senza chiave esterna: cancellando un utente resta un ID orfano.
- `profiles`, `user_roles` e `reality_bookmarks` sono in CASCADE; `editorial_editions.curator_user_id` è in SET NULL.
- `notifications.user_id` non ha chiave esterna: oggi le notifiche vengono pulite a mano nella funzione.
- Policy di `blog_posts`: oggi l'autore può modificare i propri articoli anche quando sono `pending` o `scheduled`, e può inserire direttamente `scheduled` con una data qualsiasi nel futuro.
- `notify_blog_post_status_change` scatta solo sull'UPDATE: un articolo inserito già come `pending` non manda nessuna notifica.
- Cron attivo: `publish-scheduled-posts` (minuti 0 e 30) e `auto-confirm-pending-realities`.
- Dati: 9 articoli, tutti `published`. Il ruolo `moderator` esiste ed è trattato come staff: in questo piano conta come admin.

---

## 1. Eliminazione utente con due opzioni

### Database
1. **Chiavi esterne**
   - `blog_posts.user_id`: si toglie NOT NULL e si passa a **ON DELETE SET NULL**. Così, se un utente viene cancellato fuori dal pannello, i post restano.
   - `editorial_submissions.author_user_id`: si toglie NOT NULL e si passa a **ON DELETE SET NULL** (candidatura anonima).
   - Togliere NOT NULL è una modifica che il sistema mi chiederà di confermare prima di applicarla.
2. **Nuova colonna** `blog_posts.author_deleted boolean default false`, utile al sito per non mostrare il link al profilo. In alternativa basta `user_id IS NULL`: proposta di usare solo quello e non aggiungere la colonna.
3. **Trigger di pulizia** su `profiles`, AFTER DELETE: azzera `realities.created_by` e `confirmed_by`, e cancella le notifiche dell'utente. Vale anche per le cancellazioni fatte fuori dal pannello, perché il profilo cade in cascata con l'utente.
4. **Funzione `admin_delete_user_content(_target uuid, _actor uuid, _mode text)`**, `SECURITY DEFINER`, eseguibile solo da `service_role`:
   - Lavora in una sola transazione e si può rieseguire senza danni (idempotente).
   - Disattiva l'audit riga per riga (`set_config('app.skip_audit','on', true)`), così l'audit non conserva nome ed email dentro i dati vecchi.
   - `keep`: `user_id = NULL` sui post (`author_name` resta), `author_user_id = NULL` sulle candidature.
   - `all`: cancella i post e le candidature dell'utente.
   - In entrambi i casi: azzera `realities.created_by` e `confirmed_by`, cancella notifiche, segnalibri e ruoli.
   - Scrive una sola riga in `admin_audit_log`: `action='DELETE_USER'`, `table_name='auth.users'`, `row_id=_target`, `actor_id=_actor`, l'email di chi elimina, `new_data={mode, posts_count, submissions_count}`. Dell'utente eliminato resta solo l'ID.
   - Restituisce l'elenco dei percorsi della copertina e dell'avatar.
5. **`log_admin_action`**: se `app.skip_audit` è attivo non registra nulla. Se manca `auth.uid()` registra comunque, con `actor_email='sistema'`, invece di saltare. Così anche le cancellazioni da script lasciano traccia.
6. **Funzione `admin_user_delete_preview(_target)`** (solo `service_role`): conta post, candidature e realtà dell'utente, per la conferma nell'interfaccia.

### Edge function `manage-user`
- Nuove operazioni: `delete_user_preview { user_id }` e `delete_user { user_id, mode: 'keep' | 'all' }` (zod).
- Ordine dei passaggi e gestione degli errori:
  1. Controlli: solo admin, nessuno può eliminare se stesso.
  2. **Sospensione** dell'utente (reversibile). Se fallisce, ci si ferma e il sistema resta intatto.
  3. Chiamata a `admin_delete_user_content`, in transazione. Se fallisce, il database torna allo stato precedente; si toglie la sospensione e si restituisce l'errore.
  4. `auth.admin.deleteUser`, che porta via in cascata profilo e ruoli residui. Se fallisce, l'utente resta sospeso e senza ruoli, quindi è innocuo. Il messaggio diventa: "Eliminazione incompleta: riprova". Ripetere l'operazione è sicuro grazie al punto 3.
  5. Pulizia dello storage, senza bloccare l'operazione: avatar (`avatars/<uid>/…`) sempre; copertine (`blog-covers/<uid>/…`) solo con `all`. Se fallisce, si aggiunge un avviso alla risposta e una nota nella riga di audit (`storage_cleanup_failed`). Un file rimasto orfano non rompe nulla.
- La vecchia operazione `delete_user` senza `mode` viene rifiutata: "Scegli un'opzione di eliminazione".

### Interfaccia
- `UsersManagementPanel.tsx`: la finestra di eliminazione chiama prima l'anteprima. Mostra "Questo utente ha N articoli (X pubblicati) e M candidature" e due pulsanti radio: "Elimina l'utente e mantieni i post" / "Elimina tutto". Per confermare l'opzione "Elimina tutto" bisogna digitare la parola ELIMINA.
- `MagazinePost.tsx`, `Blog.tsx`, `Editoriale.tsx`, liste e `authorNames.ts`: se `user_id` è null si mostra solo `author_name`, senza link e senza box bio.
- `AutoreProfilo.tsx`: se il profilo non esiste, compare "Autore non più presente".
- Pannello di curatela: una candidatura con autore null appare come "Autore rimosso".
- `AuditLogPanel.tsx`: mostra in modo leggibile le righe `DELETE_USER`.

---

## 2. Finestra di revisione di 24 ore per gli autori

### Modello degli stati
```text
draft --invio (data >= invio+24h)--> scheduled --cron--> published
                                       |  \--respingi (nota)--> rejected --> draft
                                       \--ritira--> draft
```
- Per gli autori si unificano gli stati su `scheduled`, con data obbligatoria. `pending` non viene più usato per i nuovi invii: resta valido solo per eventuali righe vecchie (oggi non ce ne sono) e nel codice viene trattato come `scheduled`.
- Nuovo stato `rejected`.

### Database
- **Nuove colonne in `blog_posts`**: `submitted_at timestamptz`, `rejection_note text`, `rejected_by uuid`, `rejected_at timestamptz`.
- **Funzione `is_privileged_publisher(uid, post)`**: vera per admin, moderator, coordinatore, editor_chief dell'edizione del post e guest_editor della special issue del post.
- **Funzione `can_review_post(post)`**:
  - Admin e moderator: sempre.
  - Per un post di edizione o special issue: chief o guest di riferimento.
  - Per un post senza edizione: coordinatore.
- **`validate_blog_post_schedule`** (riscritta):
  - Accetta gli stati `draft`, `pending`, `scheduled`, `rejected`, `published`.
  - Per chi non è un editore con pieni poteri, il passaggio a `scheduled` imposta `submitted_at = now()` (sempre l'orario del server, mai quello del client). Richiede `scheduled_for >= submitted_at + interval '24 hours'` e lo slot di 30 minuti. Errore: "La data di pubblicazione deve essere almeno 24 ore dopo l'invio".
  - Un autore non può impostare `published` né `pending`.
  - `rejected` richiede una `rejection_note` non vuota ("Inserisci una nota per l'autore") e `can_review_post`. Imposta `rejected_by` e `rejected_at`.
  - Il ritorno a `draft` azzera `scheduled_for` e `submitted_at` (la nota di rifiuto resta finché il post non viene reinviato).
- **Nuovo trigger di blocco** (BEFORE UPDATE, `SECURITY DEFINER`), per gli autori che non sono editori con pieni poteri:
  - Se `OLD.status` è `scheduled`, `pending` o `rejected`, l'unica modifica permessa è `status → draft`. Ogni altro campo deve restare uguale. Errore: "Articolo bloccato: ritiralo in bozza per modificarlo".
  - Chi può fare la revisione, se non è l'autore, può solo passare a `rejected` (con la nota) o lasciare il post invariato.
- **Policy RLS di `blog_posts`**:
  - INSERT dell'autore: solo `draft`. L'invio avviene con un UPDATE, così il trigger si applica sempre.
  - UPDATE: l'autore sui propri post in `draft`, `scheduled`, `pending` o `rejected`. Chi rivede, sui post in `scheduled` per cui `can_review_post` è vera. Lo staff, come oggi.
  - DELETE dell'autore: anche dei post `rejected`.
  - SELECT: si aggiunge `can_review_post` (il coordinatore vede già tutto).
- **`notify_blog_post_status_change`**, si aggiunge il caso `→ scheduled` inviato da un autore:
  - Notifica all'admin sempre.
  - Se c'è un'edizione o special issue: al chief e/o guest di riferimento.
  - Altrimenti: ai coordinatori.
  - Nessun doppione (DISTINCT) e mai all'autore stesso.
  - `→ rejected`: notifica all'autore con la nota.
  - Il messaggio mostra la data in ora italiana (`AT TIME ZONE 'Europe/Rome'`).
- **`publish_scheduled_posts`**: resta invariata; pubblica solo `scheduled`, quindi non tocca mai `rejected`.

### Fuso orario
- Tutto viene salvato in UTC (`timestamptz`). Le 24 ore sono una durata assoluta, quindi non dipendono dal fuso né dall'ora legale.
- Il calendario lavora in `Europe/Rome`: propone come prima data utile il primo slot da :00 o :30 che sia almeno a invio + 24 h, e la converte in UTC con `toISOString`.
- L'Italia ha uno scostamento orario intero, quindi gli slot da 30 minuti coincidono anche in UTC.
- Se tra l'apertura del calendario e l'invio passa del tempo, è il database a ricontrollare. L'interfaccia mostra l'errore e ricalcola la prima data utile.

### Interfaccia
- `ArticoloEditor.tsx`:
  - Per i soli autori c'è un unico pulsante "Invia (pubblicazione dal …)" con data e ora obbligatorie, preimpostate sulla prima data utile; il calendario disabilita le date precedenti.
  - Con l'articolo in `scheduled` o `rejected` i campi sono in sola lettura e compare il pulsante "Ritira in bozza".
  - Se l'articolo è `rejected`, la nota appare in evidenza.
  - Gli editori con pieni poteri mantengono "Pubblica" e "Programma".
- `PanelArticoli.tsx`: badge "In revisione fino al …" e "Respinto".
- `PanelModerazione.tsx` (e il pannello curatela per chief e guest): elenco dei post in revisione con il conto alla rovescia, il pulsante "Respingi" e la nota obbligatoria.
- `ScheduledTimeline.tsx` e `types.ts`: si aggiunge lo stato `rejected`.

---

## Rischi per i dati esistenti
- **9 articoli pubblicati**: non vengono toccati dai nuovi controlli, che scattano solo al cambio di stato o di data.
  - Rischio: il trigger di blocco o le nuove policy potrebbero impedire allo staff le modifiche ordinarie. Lo verifichiamo nei test.
- **Togliere NOT NULL da `user_id`** può rompere il codice che dà per scontato un valore. Vanno corretti i tipi e tutte le occorrenze, `authorNames.ts` incluso.
- **12 realtà**: non vengono cancellate. Il trigger di pulizia azzera solo `created_by` e `confirmed_by` dell'utente eliminato. L'auto-conferma richiede `created_by`, quindi una realtà ancora `pendente` di un utente eliminato non si conferma da sola. Va confermata a mano: comportamento voluto, segnalato qui.
- **7 profili**: nessuna modifica. Gli account di test editor non vengono toccati.
- **Audit**: nessuna riga esistente modificata. Togliere il "salto" quando manca `auth.uid()` aggiunge righe con attore "sistema" ogni volta che il cron pubblica: è accettabile, oppure si può escludere il cron con lo stesso flag `app.skip_audit`. Proposta: escluderlo.
- **Lavori a metà**: prima di applicare le modifiche si controlla che non ci siano post `pending` o `scheduled` (oggi sono 0).

## Verifica per ruolo
Test con chiamate dirette all'API, usando un token per ruolo (account di test), non solo dall'interfaccia:
- **Autore**:
  - Un INSERT con `scheduled` o `published` viene rifiutato.
  - Un invio a meno di 24 h, o fuori dagli slot da 30 minuti, viene rifiutato.
  - Un invio valido funziona.
  - Modificare il titolo di un post `scheduled` viene rifiutato; ritirarlo in bozza funziona.
  - Reinviandolo, `submitted_at` riparte.
  - Non può respingere, né falsificare `submitted_at`.
- **Coordinatore**: può respingere un post del Bollettino (senza nota viene rifiutato); non può respingere un post di un'edizione; pubblica subito.
- **Editor chief / guest editor**: ricevono la notifica e possono respingere solo i post della propria edizione o special issue; pubblicano subito i propri.
- **Admin**: riceve tutte le notifiche e può respingere qualsiasi post.
- **Cron**: un post `scheduled` scaduto viene pubblicato, uno `rejected` no.
- **Eliminazione**, su utenti di test creati apposta:
  - "Mantieni": i post restano pubblicati, senza link al profilo.
  - "Tutto": post, candidature e copertine vengono rimossi, le realtà restano.
  - In entrambi i casi: la riga in `admin_audit_log` contiene solo l'ID, e notifiche, segnalibri e avatar spariscono.
  - Un errore simulato al passaggio 4 lascia l'utente sospeso e senza ruoli; ripetendo l'operazione si completa.
  - Una cancellazione via SQL mantiene i post.
- **Test automatici** (vitest), uno per regola: la prima data utile = primo slot da 30 minuti a partire da invio + 24 h, con un caso a cavallo del cambio d'ora; quali pulsanti vede ciascun ruolo.

## Fuori da questo piano
- Spostare la verifica copyright lato server.
