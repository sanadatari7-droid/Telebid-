#!/usr/bin/env bash
# Restores a backup produced by backup.sh. DESTRUCTIVE — overwrites
# whatever is currently in the database with the dump's contents.
#
# Usage: ./restore.sh path/to/telebid_20260115_020000.sql.gz [--yes]
# Env overrides: ENV_FILE, CONTAINER_NAME
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.prod}"
CONTAINER_NAME="${CONTAINER_NAME:-telebid-postgres}"

DUMP_FILE="${1:-}"
SKIP_CONFIRM="${2:-}"

if [ -z "$DUMP_FILE" ]; then
  echo "Usage: $0 path/to/dump.sql.gz [--yes]" >&2
  exit 1
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "restore.sh: $DUMP_FILE not found" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "restore.sh: $ENV_FILE not found — copy .env.prod.example to .env.prod first" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "restore.sh: POSTGRES_PASSWORD is not set in $ENV_FILE" >&2
  exit 1
fi

if ! docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "restore.sh: container '$CONTAINER_NAME' not found — is docker-compose.prod.yml running?" >&2
  exit 1
fi

if [ "$SKIP_CONFIRM" != "--yes" ]; then
  echo "This OVERWRITES every table in the live 'telebid' database with the contents of:"
  echo "  $DUMP_FILE"
  read -r -p "Type 'restore' to continue: " CONFIRM
  if [ "$CONFIRM" != "restore" ]; then
    echo "restore.sh: aborted"
    exit 1
  fi
fi

echo "restore.sh: restoring $DUMP_FILE into $CONTAINER_NAME"
gunzip -c "$DUMP_FILE" | docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
  psql -U telebid telebid

echo "restore.sh: OK — restart the backend so any cached connections pick up the restored data:"
echo "  docker compose --env-file .env.prod -f docker-compose.prod.yml restart backend"
