#!/usr/bin/env bash
# Il Bel Paese — backup notturno del database e dei file caricati.
#
# 1. esporta il database con pg_dump (formato custom, si ripristina con pg_restore)
# 2. archivia la cartella dei file caricati (avatar, copertine, immagini delle realtà)
# 3. tiene le ultime 14 copie sul server
# 4. copia tutto su kDrive, CIFRATO (remote rclone "kdrive-cifrato", vedi piano), e lì tiene 60 giorni
#
# Il dump contiene dati personali (email, profili): per questo su kDrive va solo cifrato.
#
# Uso: sudo /opt/ilbelpaese/repo/deploy/server/backup.sh     (il timer systemd lo lancia ogni notte)
# Verifica di un backup:  pg_restore --list <file.dump> | head

set -euo pipefail

BACKUP_DIR="/opt/ilbelpaese/backups"
SUPABASE_DIR="/opt/supabase/docker"
REMOTE="kdrive-cifrato:il-bel-paese"
KEEP_LOCAL=14
KEEP_REMOTE_DAYS=60

stamp="$(date -u +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[$stamp] Esportazione del database"
docker exec supabase-db pg_dump -U postgres -d postgres -Fc --no-owner \
  > "$BACKUP_DIR/db_$stamp.dump.part"
mv "$BACKUP_DIR/db_$stamp.dump.part" "$BACKUP_DIR/db_$stamp.dump"

# Un dump vuoto o troncato non deve sostituire i backup buoni
size=$(stat -c %s "$BACKUP_DIR/db_$stamp.dump")
if [ "$size" -lt 10000 ]; then
  echo "ERRORE: dump troppo piccolo ($size byte), backup interrotto" >&2
  exit 1
fi
docker exec -i supabase-db pg_restore --list < "$BACKUP_DIR/db_$stamp.dump" > /dev/null

echo "[$stamp] Archivio dei file caricati"
tar -C "$SUPABASE_DIR/volumes" -czf "$BACKUP_DIR/files_$stamp.tar.gz" storage

echo "[$stamp] Pulizia delle copie locali più vecchie (ne restano $KEEP_LOCAL)"
for pattern in 'db_*.dump' 'files_*.tar.gz'; do
  ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)) | xargs -r rm -f
done

echo "[$stamp] Copia cifrata su kDrive"
rclone copy "$BACKUP_DIR" "$REMOTE" --include "*_$stamp.*" --log-level NOTICE
rclone delete "$REMOTE" --min-age "${KEEP_REMOTE_DAYS}d" --log-level NOTICE

echo "[$stamp] Backup completato"
