#!/usr/bin/env bash
set -Eeuo pipefail

APP_PATTERN_DEFAULT='Amazon-ASIN-monitor|amazon-asin-monitor|amazon_asin_monitor|asin-api|asin-worker|asin-monitor'
APP_PATTERN="${APP_PATTERN:-$APP_PATTERN_DEFAULT}"
API_CONTAINER="${API_CONTAINER:-}"
LOG_MINUTES="${LOG_MINUTES:-30}"

section() {
  printf '\n==== %s ====\n' "$1"
}

info() {
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
  bash server/scripts/diagnose-1panel-prod.sh
  bash server/scripts/diagnose-1panel-prod.sh --api-container Amazon-ASIN-monitor-server
  bash server/scripts/diagnose-1panel-prod.sh --pattern 'Amazon-ASIN-monitor|asin-api'

Options:
  --api-container <name>   Specify the API container explicitly.
  --pattern <regex>        Regex used to find 1Panel containers.
  --log-minutes <minutes>  How many recent log minutes to scan. Default: 30.
  -h, --help               Show this help message.

Notes:
  - Run this on the 1Panel host, not inside the container.
  - Docker CLI is required on the host.
  - The script does not modify data. It only inspects env, DB schema, and logs.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --api-container)
      [ "$#" -ge 2 ] || fail "--api-container requires a value"
      API_CONTAINER="$2"
      shift 2
      ;;
    --pattern)
      [ "$#" -ge 2 ] || fail "--pattern requires a value"
      APP_PATTERN="$2"
      shift 2
      ;;
    --log-minutes)
      [ "$#" -ge 2 ] || fail "--log-minutes requires a value"
      LOG_MINUTES="$2"
      shift 2
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

command -v docker >/dev/null 2>&1 || fail "docker is not installed on this host"

docker ps >/dev/null 2>&1 || fail "docker is not available for the current user"

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

docker_sh() {
  local container="$1"
  shift
  docker exec "$container" sh -lc "$*"
}

docker_proc1_env() {
  local container="$1"
  docker exec "$container" sh -lc 'tr "\000" "\n" </proc/1/environ 2>/dev/null || true'
}

docker_app_pid() {
  local container="$1"
  docker exec "$container" sh -lc '
    pgrep -o -f "node .*src/index.js|node .*src/worker-index.js|node src/index.js|node src/worker-index.js" 2>/dev/null || true
  '
}

docker_app_env() {
  local container="$1"
  local app_pid
  app_pid="$(docker_app_pid "$container" | tr -d "\r" | head -n 1)"
  if [ -n "$app_pid" ]; then
    docker exec "$container" sh -lc "tr '\000' '\n' </proc/$app_pid/environ 2>/dev/null || true"
  else
    docker_proc1_env "$container"
  fi
}

get_container_role() {
  local container="$1"
  local role
  role="$(docker_app_env "$container" | awk -F= '$1=="PROCESS_ROLE"{print $2; exit}' || true)"
  trim "$role"
}

list_candidates() {
  docker ps --format '{{.Names}}' | grep -Ei "$APP_PATTERN" || true
}

print_candidate_summary() {
  local container="$1"
  local role image status
  role="$(get_container_role "$container")"
  image="$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || printf 'unknown')"
  status="$(docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || printf 'unknown')"
  printf '%-40s role=%-8s status=%-10s image=%s\n' "$container" "${role:-unknown}" "$status" "$image"
}

detect_api_container() {
  if [ -n "$API_CONTAINER" ]; then
    docker inspect "$API_CONTAINER" >/dev/null 2>&1 || fail "container not found: $API_CONTAINER"
    return 0
  fi

  local candidates candidate role first_candidate
  candidates="$(list_candidates)"
  [ -n "$candidates" ] || fail "no running containers matched pattern: $APP_PATTERN"

  first_candidate=""
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if [ -z "$first_candidate" ]; then
      first_candidate="$candidate"
    fi
    role="$(get_container_role "$candidate")"
    if [ "$role" = "api" ]; then
      API_CONTAINER="$candidate"
      return 0
    fi
  done <<EOF
$candidates
EOF

  API_CONTAINER="$first_candidate"
}

print_container_inventory() {
  section "1Panel Container Inventory"
  local candidates candidate
  candidates="$(list_candidates)"
  if [ -z "$candidates" ]; then
    warn "No container names matched pattern: $APP_PATTERN"
    info "All running containers:"
    docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
    return
  fi

  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    print_candidate_summary "$candidate"
  done <<EOF
$candidates
EOF
}

print_effective_env() {
  section "Effective Env In API Container"
  docker_app_env "$API_CONTAINER" | sort | awk -F= '
      BEGIN { IGNORECASE=1 }
      /^(NODE_ENV|PROCESS_ROLE|SCHEDULER_ENABLED|TRUST_PROXY|CORS_ORIGIN|AUTH_COOKIE_NAME|AUTH_HINT_COOKIE_NAME|LOG_LEVEL|DB_|COMPETITOR_DB_)=/ {
        key=$1;
        value=substr($0, length($1) + 2);
        if (key ~ /(PASSWORD|TOKEN|SECRET|AUTHORIZATION)/) {
          value="***MASKED***";
        }
        print key "=" value;
      }
    ' || warn "failed to read proc1 env from container: $API_CONTAINER"
}

print_runtime_paths() {
  section "Container Runtime Context"
  docker_sh "$API_CONTAINER" '
    APP_PID="$(pgrep -o -f "node .*src/index.js|node .*src/worker-index.js|node src/index.js|node src/worker-index.js" 2>/dev/null || true)"
    printf "pwd=%s\n" "$(pwd)"
    printf "node=%s\n" "$(command -v node || printf not-found)"
    printf "npm=%s\n" "$(command -v npm || printf not-found)"
    printf "proc1_cwd=%s\n" "$(readlink /proc/1/cwd 2>/dev/null || printf unknown)"
    printf "proc1_cmdline=%s\n" "$(tr "\000" " " </proc/1/cmdline 2>/dev/null || printf unknown)"
    printf "app_pid=%s\n" "${APP_PID:-unknown}"
    if [ -n "${APP_PID:-}" ]; then
      printf "app_cwd=%s\n" "$(readlink /proc/$APP_PID/cwd 2>/dev/null || printf unknown)"
      printf "app_cmdline=%s\n" "$(tr "\000" " " </proc/$APP_PID/cmdline 2>/dev/null || printf unknown)"
    fi
  ' || warn "failed to inspect runtime context"
}

run_db_probe() {
  section "Competitor DB Probe"
  docker exec -i "$API_CONTAINER" sh -lc '
    set -eu

    SERVER_DIR=""
    ENV_FILE=""
    for dir in \
      /app/server \
      /app \
      /usr/src/app/server \
      /usr/src/app \
      /opt/app/server \
      /opt/app \
      /workspace/server \
      /workspace \
      /www/server \
      /www
    do
      if [ -d "$dir/node_modules/mysql2" ]; then
        SERVER_DIR="$dir"
        break
      fi
    done

    if [ -z "$SERVER_DIR" ]; then
      found_dir="$(find / -maxdepth 5 -type d -path "*/node_modules/mysql2" 2>/dev/null | head -n 1 || true)"
      if [ -n "$found_dir" ]; then
        SERVER_DIR="${found_dir%/node_modules/mysql2}"
      fi
    fi

    if [ -z "$SERVER_DIR" ]; then
      echo "[ERROR] unable to locate node_modules/mysql2 inside container"
      exit 1
    fi

    PROC1_CWD="$(readlink /proc/1/cwd 2>/dev/null || true)"
    APP_PID="$(pgrep -o -f "node .*src/index.js|node .*src/worker-index.js|node src/index.js|node src/worker-index.js" 2>/dev/null || true)"
    APP_CWD=""
    if [ -n "$APP_PID" ]; then
      APP_CWD="$(readlink /proc/$APP_PID/cwd 2>/dev/null || true)"
    fi
    for env_path in \
      "$APP_CWD/.env" \
      "$PROC1_CWD/.env" \
      "$SERVER_DIR/.env" \
      "$SERVER_DIR/server/.env" \
      /app/.env \
      /app/server/.env \
      /usr/src/app/.env \
      /usr/src/app/server/.env
    do
      if [ -n "$env_path" ] && [ -f "$env_path" ]; then
        ENV_FILE="$env_path"
        break
      fi
    done

    echo "[INFO] using node workspace: $SERVER_DIR"
    if [ -n "$ENV_FILE" ]; then
      echo "[INFO] using dotenv file: $ENV_FILE"
    else
      echo "[WARN] dotenv file not found, only process env will be used"
    fi
    cd "$SERVER_DIR"
    if [ -n "$ENV_FILE" ]; then
      DOTENV_CONFIG_PATH="$ENV_FILE" node -r dotenv/config -
    else
      node -
    fi
  ' <<'NODE'
const mysql = require('mysql2/promise');

function mask(value) {
  if (!value) {
    return '';
  }
  return '***MASKED***';
}

async function main() {
  const config = {
    host: process.env.COMPETITOR_DB_HOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.COMPETITOR_DB_PORT || process.env.DB_PORT || 3306),
    user: process.env.COMPETITOR_DB_USER || process.env.DB_USER || '',
    password:
      process.env.COMPETITOR_DB_PASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.COMPETITOR_DB_NAME || 'amazon_competitor_monitor',
  };

  console.log(
    `[INFO] target competitor db: host=${config.host} port=${config.port} user=${config.user} database=${config.database} password=${mask(
      config.password,
    )}`,
  );

  const connection = await mysql.createConnection(config);
  try {
    const [tables] = await connection.query(
      "SHOW TABLES LIKE 'competitor_variant_groups'",
    );
    console.log(`[INFO] competitor_variant_groups exists: ${tables.length > 0}`);

    if (tables.length === 0) {
      console.log(
        '[WARN] table competitor_variant_groups is missing in the effective competitor database',
      );
      return;
    }

    const [columns] = await connection.query(
      'SHOW COLUMNS FROM competitor_variant_groups',
    );
    const fieldNames = columns.map((item) => item.Field);
    const expectedFields = [
      'id',
      'name',
      'country',
      'brand',
      'is_broken',
      'variant_status',
      'feishu_notify_enabled',
      'create_time',
      'update_time',
      'last_check_time',
    ];
    const missingFields = expectedFields.filter(
      (field) => !fieldNames.includes(field),
    );

    console.log(
      `[INFO] competitor_variant_groups columns: ${fieldNames.join(', ')}`,
    );
    console.log(
      `[INFO] missing expected columns: ${
        missingFields.length > 0 ? missingFields.join(', ') : '(none)'
      }`,
    );

    const [countRows] = await connection.query(
      'SELECT COUNT(*) AS total FROM competitor_variant_groups',
    );
    console.log(
      `[INFO] competitor_variant_groups row count: ${countRows[0]?.total ?? 0}`,
    );

    try {
      const [probeRows] = await connection.query(`
        SELECT COUNT(DISTINCT vg.id) AS total
        FROM competitor_variant_groups vg
        LEFT JOIN competitor_asins a ON a.variant_group_id = vg.id
        WHERE 1=1 AND vg.is_broken = 1
      `);
      console.log(
        `[INFO] probe query succeeded, broken group total: ${
          probeRows[0]?.total ?? 0
        }`,
      );
    } catch (error) {
      console.log(
        `[ERROR] probe query failed: ${error.message} (code=${error.code || ''})`,
      );
    }

    if (missingFields.includes('is_broken')) {
      console.log('[WARN] minimal SQL to restore the immediate missing column:');
      console.log(
        'ALTER TABLE competitor_variant_groups ADD COLUMN is_broken TINYINT(1) DEFAULT 0 COMMENT \'variant status\' AFTER brand;',
      );
      console.log(
        'ALTER TABLE competitor_variant_groups ADD INDEX idx_is_broken (is_broken);',
      );
    }

    if (
      missingFields.some((field) =>
        ['variant_status', 'feishu_notify_enabled', 'last_check_time'].includes(
          field,
        ),
      )
    ) {
      console.log('[WARN] schema still looks behind current code expectations.');
      console.log(
        '[WARN] compare the table against server/database/competitor-init.sql before applying a broader ALTER.',
      );
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.log(
    `[ERROR] database inspection failed: ${error.message} (code=${error.code || ''})`,
  );
  process.exit(1);
});
NODE
}

print_relevant_logs() {
  section "Recent Logs"
  docker logs --since "${LOG_MINUTES}m" "$API_CONTAINER" 2>&1 | grep -E '已拒绝未授权连接|Unknown column|vg\.is_broken|WebSocket|竞品数据库查询错误' || true
}

print_summary() {
  section "Quick Interpretation"
  cat <<'EOF'
- If the DB probe says "missing expected columns: is_broken", the effective competitor database schema is behind current code.
- If is_broken exists in the probe but logs still show "Unknown column 'vg.is_broken'", the container is likely reading a different DB config than expected or another API container is still on old env.
- A few "WebSocket unauthorized" warnings are usually tolerable. Repeated warnings right after login suggest cookies are not reaching /ws through the proxy.
EOF
}

print_container_inventory
detect_api_container

section "Selected API Container"
printf '%s\n' "$API_CONTAINER"

print_effective_env
print_runtime_paths
run_db_probe
print_relevant_logs
print_summary
