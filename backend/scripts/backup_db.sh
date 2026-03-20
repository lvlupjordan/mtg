#!/bin/bash
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is not set"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTFILE="backup_${TIMESTAMP}.sql"

echo "Backing up to ${OUTFILE}..."
pg_dump "$DATABASE_URL" > "$OUTFILE"
echo "Done. $(du -h "$OUTFILE" | cut -f1) written to ${OUTFILE}"
