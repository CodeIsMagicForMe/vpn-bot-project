#!/usr/bin/env bash
set -euo pipefail

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR=${BACKUP_DIR:-"./backups"}
mkdir -p "$BACKUP_DIR"

echo "Creating PostgreSQL backup at $BACKUP_DIR/backup_$TIMESTAMP.sql.gz"

PGPASSWORD=${DB_PASSWORD:-password123} pg_dump \
  -h ${DB_HOST:-localhost} \
  -p ${DB_PORT:-5432} \
  -U ${DB_USER:-vpn_user} \
  ${DB_NAME:-vpn_bot} | gzip > "$BACKUP_DIR/backup_$TIMESTAMP.sql.gz"

echo "Backup completed."

