#!/usr/bin/env bash
# archive-logs.sh
# Consolidates PM2 backend logs + Amazon SP-API debug logs into a single dated archive file.
# Safe to run: Amazon logger already redacts tokens/secrets/passwords/authorization headers.
#
# Usage:
#   chmod +x backend/scripts/archive-logs.sh
#   ./backend/scripts/archive-logs.sh               # archive last 2000 lines
#   ./backend/scripts/archive-logs.sh 5000          # archive last N lines
#   ./backend/scripts/archive-logs.sh --follow      # tail and keep appending
#
# Requires PM2 logs at /var/www/adventra/logs/backend-out.log (adjust LOG_SRC below).

set -euo pipefail

LOG_DIR="${LOG_DIR:-/var/www/adventra/logs}"
LOG_SRC="${LOG_SRC:-${LOG_DIR}/backend-out.log}"
ARCHIVE_DIR="${ARCHIVE_DIR:-${LOG_DIR}/archive}"
MAX_LINES="${1:-2000}"
FOLLOW="${2:-}"

mkdir -p "${ARCHIVE_DIR}"

TS=$(date +"%Y%m%d-%H%M%S")
ARCHIVE_FILE="${ARCHIVE_DIR}/backend-${TS}.log"

if [[ ! -f "${LOG_SRC}" ]]; then
  echo "Source log not found: ${LOG_SRC}" >&2
  exit 1
fi

if [[ "${FOLLOW}" == "--follow" ]]; then
  echo "Tailing ${LOG_SRC} -> ${ARCHIVE_FILE} (Ctrl-C to stop)"
  tail -n "${MAX_LINES}" -f "${LOG_SRC}" | tee -a "${ARCHIVE_FILE}"
else
  echo "Archiving last ${MAX_LINES} lines from ${LOG_SRC} -> ${ARCHIVE_FILE}"
  tail -n "${MAX_LINES}" "${LOG_SRC}" > "${ARCHIVE_FILE}"
  echo "Wrote $(wc -l < "${ARCHIVE_FILE}") lines to ${ARCHIVE_FILE}"
fi
