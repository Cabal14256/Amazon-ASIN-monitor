#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/opt/Amazon-ASIN-monitor}"
STATIC_DIR="${STATIC_DIR:-/opt/1panel/www/sites/Amazon-ASIN-monitor/index}"
BACKUP_DIR="${BACKUP_DIR:-/root/deploy-backups/Amazon-ASIN-monitor}"
HEALTH_HOST="${HEALTH_HOST:-139.224.73.167}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:3001/health}"
HTTPS_HEALTH_URL="${HTTPS_HEALTH_URL:-https://127.0.0.1/health}"

WORKER_CONTAINERS_DEFAULT="Amazon-ASIN-monitor-worker-1,Amazon-ASIN-monitor-file-1,Amazon-ASIN-monitor-task-1"
API_CONTAINERS_DEFAULT="Amazon-ASIN-monitor-scheduler-1,Amazon-ASIN-monitor-server"

ARCHIVE_PATH=""
COMMIT_LABEL="${COMMIT_LABEL:-manual}"
SKIP_BACKUP=false
SKIP_STATIC_SYNC=false
SKIP_RESTART=false
SKIP_HEALTH_CHECK=false
KEEP_ARCHIVE=false
INSTALL_ROOT=false
INSTALL_SERVER=false
BUILD_FRONTEND=false
ALLOW_MISSING_CONTAINERS=false

WORKER_CONTAINERS=()
API_CONTAINERS=()

log() {
  printf '[INFO] %s\n' "$1"
}

warn() {
  printf '[WARN] %s\n' "$1" >&2
}

fail() {
  printf '[ERROR] %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  bash deploy.sh
  bash deploy.sh --archive /root/amazon-asin-monitor-deploy.tar.gz --commit-label 7dde213
  bash deploy.sh --archive /root/package.tar.gz --install-server --build

Options:
  --archive <path>             Extract a tar.gz package into PROJECT_ROOT before deploy.
  --project-root <path>        Project root on the 1Panel host.
  --static-dir <path>          OpenResty static site directory.
  --backup-dir <path>          Backup output directory.
  --health-host <host>         Host header used for health checks.
  --api-health-url <url>       Plain HTTP health endpoint.
  --https-health-url <url>     HTTPS health endpoint.
  --commit-label <label>       Label used in the backup filename.
  --worker-containers <csv>    Worker containers to restart first.
  --api-containers <csv>       API containers to restart after workers.
  --install-root               Run npm ci in PROJECT_ROOT after extraction.
  --install-server             Run npm ci in PROJECT_ROOT/server after extraction.
  --build                      Run npm run build in PROJECT_ROOT after extraction.
  --skip-backup                Skip the pre-deploy backup archive.
  --skip-static-sync           Skip refreshing STATIC_DIR from PROJECT_ROOT/dist.
  --skip-restart               Skip docker container restarts.
  --skip-health-check          Skip health endpoint verification.
  --keep-archive               Keep the uploaded archive after a successful deploy.
  --allow-missing-containers   Warn instead of failing when a configured container is absent.
  -h, --help                   Show this help message.

Notes:
  - Run this on the 1Panel host.
  - When --archive is provided, the archive must contain repo-relative paths such as dist/, server/, src/.
  - The script atomically swaps the static site directory by copying PROJECT_ROOT/dist into STATIC_DIR.
EOF
}

split_csv() {
  local raw="$1"
  local item
  IFS=',' read -r -a items <<<"$raw"
  for item in "${items[@]}"; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    if [[ -n "$item" ]]; then
      printf '%s\n' "$item"
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || fail "--archive requires a value"
      ARCHIVE_PATH="$2"
      shift 2
      ;;
    --project-root)
      [[ $# -ge 2 ]] || fail "--project-root requires a value"
      PROJECT_ROOT="$2"
      shift 2
      ;;
    --static-dir)
      [[ $# -ge 2 ]] || fail "--static-dir requires a value"
      STATIC_DIR="$2"
      shift 2
      ;;
    --backup-dir)
      [[ $# -ge 2 ]] || fail "--backup-dir requires a value"
      BACKUP_DIR="$2"
      shift 2
      ;;
    --health-host)
      [[ $# -ge 2 ]] || fail "--health-host requires a value"
      HEALTH_HOST="$2"
      shift 2
      ;;
    --api-health-url)
      [[ $# -ge 2 ]] || fail "--api-health-url requires a value"
      API_HEALTH_URL="$2"
      shift 2
      ;;
    --https-health-url)
      [[ $# -ge 2 ]] || fail "--https-health-url requires a value"
      HTTPS_HEALTH_URL="$2"
      shift 2
      ;;
    --commit-label)
      [[ $# -ge 2 ]] || fail "--commit-label requires a value"
      COMMIT_LABEL="$2"
      shift 2
      ;;
    --worker-containers)
      [[ $# -ge 2 ]] || fail "--worker-containers requires a value"
      mapfile -t WORKER_CONTAINERS < <(split_csv "$2")
      shift 2
      ;;
    --api-containers)
      [[ $# -ge 2 ]] || fail "--api-containers requires a value"
      mapfile -t API_CONTAINERS < <(split_csv "$2")
      shift 2
      ;;
    --install-root)
      INSTALL_ROOT=true
      shift
      ;;
    --install-server)
      INSTALL_SERVER=true
      shift
      ;;
    --build)
      BUILD_FRONTEND=true
      shift
      ;;
    --skip-backup)
      SKIP_BACKUP=true
      shift
      ;;
    --skip-static-sync)
      SKIP_STATIC_SYNC=true
      shift
      ;;
    --skip-restart)
      SKIP_RESTART=true
      shift
      ;;
    --skip-health-check)
      SKIP_HEALTH_CHECK=true
      shift
      ;;
    --keep-archive)
      KEEP_ARCHIVE=true
      shift
      ;;
    --allow-missing-containers)
      ALLOW_MISSING_CONTAINERS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ ${#WORKER_CONTAINERS[@]} -eq 0 ]]; then
  mapfile -t WORKER_CONTAINERS < <(split_csv "$WORKER_CONTAINERS_DEFAULT")
fi
if [[ ${#API_CONTAINERS[@]} -eq 0 ]]; then
  mapfile -t API_CONTAINERS < <(split_csv "$API_CONTAINERS_DEFAULT")
fi

[[ -d "$PROJECT_ROOT" ]] || fail "PROJECT_ROOT not found: $PROJECT_ROOT"
[[ -d "$PROJECT_ROOT/server" ]] || fail "Server directory not found: $PROJECT_ROOT/server"
command -v tar >/dev/null 2>&1 || fail "tar is required"

if ! $SKIP_RESTART; then
  command -v docker >/dev/null 2>&1 || fail "docker is required when restart is enabled"
fi
if $INSTALL_ROOT || $INSTALL_SERVER || $BUILD_FRONTEND; then
  command -v npm >/dev/null 2>&1 || fail "npm is required for install/build steps"
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DIST_DIR="$PROJECT_ROOT/dist"

backup_paths=(
  "$DIST_DIR"
  "$STATIC_DIR"
  "$PROJECT_ROOT/server/src"
  "$PROJECT_ROOT/server/scripts"
  "$PROJECT_ROOT/src"
  "$PROJECT_ROOT/package.json"
  "$PROJECT_ROOT/package-lock.json"
  "$PROJECT_ROOT/server/package.json"
  "$PROJECT_ROOT/server/package-lock.json"
  "$PROJECT_ROOT/deploy.sh"
  "$PROJECT_ROOT/scripts/deploy-1panel.ps1"
)

existing_backup_paths=()
for path in "${backup_paths[@]}"; do
  if [[ -e "$path" ]]; then
    existing_backup_paths+=("$path")
  fi
done

create_backup() {
  if $SKIP_BACKUP; then
    log "Skipping backup"
    return
  fi
  mkdir -p "$BACKUP_DIR"
  if [[ ${#existing_backup_paths[@]} -eq 0 ]]; then
    warn "No existing paths found for backup"
    return
  fi
  local backup_file="$BACKUP_DIR/predeploy-$TIMESTAMP-$COMMIT_LABEL.tar.gz"
  tar -czPf "$backup_file" "${existing_backup_paths[@]}"
  log "Backup created: $backup_file"
}

extract_archive() {
  if [[ -z "$ARCHIVE_PATH" ]]; then
    log "No archive provided, skipping extraction"
    return
  fi
  [[ -f "$ARCHIVE_PATH" ]] || fail "Archive not found: $ARCHIVE_PATH"
  log "Extracting archive: $ARCHIVE_PATH"
  tar -xzf "$ARCHIVE_PATH" -C "$PROJECT_ROOT"
}

install_dependencies() {
  if $INSTALL_ROOT; then
    log "Running npm ci in $PROJECT_ROOT"
    (
      cd "$PROJECT_ROOT"
      npm ci
    )
  fi
  if $INSTALL_SERVER; then
    log "Running npm ci in $PROJECT_ROOT/server"
    (
      cd "$PROJECT_ROOT/server"
      npm ci
    )
  fi
}

build_frontend() {
  if ! $BUILD_FRONTEND; then
    return
  fi
  log "Running npm run build in $PROJECT_ROOT"
  (
    cd "$PROJECT_ROOT"
    npm run build
  )
}

sync_static_site() {
  if $SKIP_STATIC_SYNC; then
    log "Skipping static site sync"
    return
  fi
  [[ -f "$DIST_DIR/index.html" ]] || fail "dist/index.html not found: $DIST_DIR/index.html"

  local static_parent
  local static_new
  local static_old

  static_parent="$(dirname "$STATIC_DIR")"
  static_new="$static_parent/index.new-$TIMESTAMP"
  static_old="$static_parent/index.prev-$TIMESTAMP"

  mkdir -p "$static_parent"
  rm -rf "$static_new"
  mkdir -p "$static_new"
  cp -a "$DIST_DIR/." "$static_new/"

  if [[ -d "$STATIC_DIR" ]]; then
    mv "$STATIC_DIR" "$static_old"
    log "Previous static dir moved to: $static_old"
  fi
  mv "$static_new" "$STATIC_DIR"
  log "Static site refreshed: $STATIC_DIR"
}

restart_one_container() {
  local container="$1"
  if ! docker inspect "$container" >/dev/null 2>&1; then
    if $ALLOW_MISSING_CONTAINERS; then
      warn "Container not found, skipping: $container"
      return
    fi
    fail "Container not found: $container"
  fi
  log "Restarting container: $container"
  docker restart "$container" >/dev/null
  docker inspect --format '{{.Name}} status={{.State.Status}} started={{.State.StartedAt}}' "$container"
}

restart_containers() {
  if $SKIP_RESTART; then
    log "Skipping container restart"
    return
  fi
  local container
  for container in "${WORKER_CONTAINERS[@]}"; do
    restart_one_container "$container"
  done
  for container in "${API_CONTAINERS[@]}"; do
    restart_one_container "$container"
  done
}

http_get_with_host() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error --insecure --header "Host: $HEALTH_HOST" "$url"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$url" "$HEALTH_HOST" <<'PY'
import ssl
import sys
import urllib.request

url = sys.argv[1]
host = sys.argv[2]
request = urllib.request.Request(url, headers={"Host": host})
context = ssl._create_unverified_context()
with urllib.request.urlopen(request, context=context, timeout=15) as response:
    sys.stdout.write(response.read().decode("utf-8", "ignore"))
PY
    return
  fi
  fail "Neither curl nor python3 is available for health checks"
}

verify_health() {
  if $SKIP_HEALTH_CHECK; then
    log "Skipping health checks"
    return
  fi

  sleep 5
  log "Checking health endpoint: $API_HEALTH_URL"
  http_get_with_host "$API_HEALTH_URL"
  printf '\n'

  log "Checking health endpoint: $HTTPS_HEALTH_URL"
  http_get_with_host "$HTTPS_HEALTH_URL"
  printf '\n'
}

cleanup_archive() {
  if [[ -z "$ARCHIVE_PATH" ]]; then
    return
  fi
  if $KEEP_ARCHIVE; then
    log "Keeping archive: $ARCHIVE_PATH"
    return
  fi
  rm -f "$ARCHIVE_PATH"
  log "Removed archive: $ARCHIVE_PATH"
}

log "1Panel deploy started"
log "PROJECT_ROOT=$PROJECT_ROOT"
log "STATIC_DIR=$STATIC_DIR"
log "COMMIT_LABEL=$COMMIT_LABEL"

create_backup
extract_archive
install_dependencies
build_frontend
sync_static_site
restart_containers
verify_health
cleanup_archive

log "1Panel deploy completed"
