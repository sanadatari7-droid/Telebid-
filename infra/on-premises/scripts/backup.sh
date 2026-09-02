#!/usr/bin/env bash
# Dumps the on-premises Postgres database to a compressed, timestamped
# file and prunes dumps older than RETENTION_DAYS. Intended to run from
# cron — see the "Routine Operations" section of ../README.md for the
# exact crontab line.
#
# Usage: ./backup.sh
# Env overrides: ENV_FILE, BACKUP_DIR, RETENTION_DAYS, CONTAINER_NAME
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.prod}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
CONTAINER_NAME="${CONTAINER_NAME:-telebid-postgres}"

if [ ! -f "$ENV_FILE" ]; then
  echo "backup.sh: $ENV_FILE not found — copy .env.prod.example to .env.prod first" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "backup.sh: POSTGRES_PASSWORD is not set in $ENV_FILE" >&2
  exit 1
fi

if ! docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "backup.sh: container '$CONTAINER_NAME' not found — is docker-compose.prod.yml running?" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
OUT_FILE="$BACKUP_DIR/telebid_$(date +%Y%m%d_%H%M%S).sql.gz"

echo "backup.sh: dumping telebid database to $OUT_FILE"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
  pg_dump -U telebid telebid | gzip > "$OUT_FILE"

if [ ! -s "$OUT_FILE" ]; then
  echo "backup.sh: dump file is empty — treating as a failure" >&2
  rm -f "$OUT_FILE"
  exit 1
fi

echo "backup.sh: OK ($(du -h "$OUT_FILE" | cut -f1))"

echo "backup.sh: pruning dumps older than $RETENTION_DAYS days in $BACKUP_DIR"
find "$BACKUP_DIR" -name 'telebid_*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete
