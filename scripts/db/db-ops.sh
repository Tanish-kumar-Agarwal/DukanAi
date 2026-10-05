#!/usr/bin/env bash
# Entrypoint of the compose `db-ops` service (roadmap 7.7, 9.2): a MySQL 8
# client container with the backup scripts mounted at /scripts, the backups
# volume at /backups and the binary-log archive at /backups/binlog.
#
#   docker compose --profile ops run --rm db-ops backup [--label TEXT]       # nightly
#   docker compose --profile ops run --rm db-ops binlog-archive --flush      # every 5 minutes
#   docker compose --profile ops run --rm db-ops restore /backups/<file>.sql.gz --yes [--to "YYYY-MM-DD HH:MM:SS"]
#   docker compose --profile ops run --rm db-ops list                        # dumps and the archive
#   docker compose --profile ops run --rm db-ops latest                      # path of the newest dump
set -euo pipefail
cmd="${1:-}"; shift || true
BACKUPS="${BACKUP_DIR:-/backups}"
ARCHIVE="${BINLOG_ARCHIVE_DIR:-$BACKUPS/binlog}"
case "$cmd" in
  backup) exec bash /scripts/backup.sh "$@" ;;
  binlog-archive) exec bash /scripts/binlog-archive.sh "$@" ;;
  restore) exec bash /scripts/restore.sh "$@" ;;
  list)
    ls -lh "$BACKUPS"/*.sql.gz 2>/dev/null || echo "no backups in $BACKUPS"
    if [ -d "$ARCHIVE" ]; then
      n="$(find "$ARCHIVE" -maxdepth 1 -type f ! -name '*.sha256' ! -name '.*' | wc -l)"
      echo "binary-log archive $ARCHIVE: $n file(s); last success: $(cat "$ARCHIVE/.last-success" 2>/dev/null || echo never)"
    else
      echo "no binary-log archive in $ARCHIVE (run binlog-archive --flush)"
    fi
    ;;
  latest) ls -1 "$BACKUPS"/*.sql.gz 2>/dev/null | sort | tail -n 1 ;;
  *) echo "usage: db-ops backup [--label TEXT] | binlog-archive [--flush] | restore FILE --yes [--to TIME] | list | latest" >&2; exit 2 ;;
esac
