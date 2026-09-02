#!/usr/bin/env bash
# Nightly historian backup to S3. Add to cron:
#   15 2 * * *  /opt/hydroflow/deploy/backup.sh >> /var/log/hydroflow-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/hydroflow}"
BUCKET="${BUCKET:-s3://js-holding-hydroflow-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# sqlite3 .backup is safe on a live WAL database; copying the file is not.
sqlite3 "$APP_DIR/data/hydroflow.db" ".backup '$TMP/hydroflow-$STAMP.db'"
gzip -9 "$TMP/hydroflow-$STAMP.db"
aws s3 cp "$TMP/hydroflow-$STAMP.db.gz" "$BUCKET/daily/" --storage-class STANDARD_IA

# Keep 30 daily copies in the bucket's lifecycle policy; prune nothing here.
echo "$(date -uIs) backed up hydroflow-$STAMP.db.gz"
