# Server Infomaniak (VPS Lite) — file di configurazione

I passaggi completi, con le verifiche, sono nel piano di migrazione. Qui c'è solo cosa fa ogni file.

| File | Dove va sul server | A cosa serve |
| --- | --- | --- |
| `docker-compose.override.yml` | resta qui, nel repo clonato in `/opt/ilbelpaese/repo` | Adatta il Supabase ufficiale: Caddy davanti, Studio e database solo locali, niente imgproxy, funzioni impacchettate, rete con indirizzi fissi |
| `Caddyfile` | resta qui | Sito e API sullo stesso dominio, HTTPS automatico, Studio mai esposto |
| `supabase.env.example` | da riportare in `/opt/supabase/docker/.env` | I valori da cambiare: dominio, solo inviti, email Infomaniak |
| `firewall.sh` | resta qui | I container non possono uscire su internet, tranne DNS, posta e il rinnovo HTTPS di Caddy |
| `backup.sh` | resta qui | Ogni notte: dump del database e dei file, 14 copie sul server, copia cifrata su kDrive |
| `systemd/*` | `/etc/systemd/system/` | Avvio automatico del firewall e backup notturno |

## Struttura sul server

```
/opt/supabase/docker        Supabase ufficiale (supabase/supabase, cartella docker/, versione fissata)
/opt/ilbelpaese/repo        questo repository
/opt/ilbelpaese/site        build del sito (cartella dist)
/opt/ilbelpaese/functions   funzioni impacchettate (deploy/functions dopo node scripts/bundle-functions.mjs)
/opt/ilbelpaese/backups     copie locali dei backup
```

## Avvio

```
cd /opt/supabase/docker
docker compose -f docker-compose.yml -f /opt/ilbelpaese/repo/deploy/server/docker-compose.override.yml up -d
sudo systemctl enable --now ilbelpaese-firewall.service ilbelpaese-backup.timer
```

## Verificato prima di salire sul server

- `docker compose config` con i file ufficiali di Supabase (commit c238864, 2 novembre 2026): porte, dipendenze, volumi e rete risultano come previsto
- `caddy validate` sul Caddyfile (Caddy 2.10.2)
- `firewall.sh` su un Docker reale: applica le regole, si può rilanciare senza duplicarle, `off` le rimuove

Da verificare sul server: avvio reale dei container, router delle funzioni con i pacchetti, invio email, rinnovo del certificato, ripristino di un backup.
