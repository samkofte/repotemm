#!/usr/bin/env bash
# RemoteMM Enterprise - Docker Compose Fleet Management Utility
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

usage() {
  echo "RemoteMM Enterprise - Docker Management CLI"
  echo "Usage: $0 [command]"
  echo ""
  echo "Commands:"
  echo "  up       - Build images and start all containers in background"
  echo "  down     - Stop and remove containers (preserves ./data volume)"
  echo "  restart  - Restart the Gateway service"
  echo "  status   - Display running container status and healthchecks"
  echo "  logs     - Stream live logs from all containers"
  echo "  health   - Query /api/health endpoint of the Gateway"
  echo "  backup   - Create a timestamped archive of ./data (SQLite + Audit logs)"
  echo ""
  exit 1
}

CMD="${1:-}"

case "$CMD" in
  up)
    echo "[RemoteMM] Starting Docker Compose environment..."
    if [ ! -f .env ]; then
      echo "[RemoteMM] .env not found. Copying from .env.example..."
      cp .env.example .env
    fi
    docker compose up -d --build
    echo "[RemoteMM] Containers started. Checking status in 3 seconds..."
    sleep 3
    docker compose ps
    ;;
  down)
    echo "[RemoteMM] Stopping Docker Compose environment..."
    docker compose down
    echo "[RemoteMM] Stopped successfully. (Persistent data preserved in ./data)"
    ;;
  restart)
    echo "[RemoteMM] Restarting Gateway container..."
    docker compose restart gateway
    echo "[RemoteMM] Gateway restarted."
    ;;
  status)
    docker compose ps
    ;;
  logs)
    docker compose logs -f --tail=100
    ;;
  health)
    echo "[RemoteMM] Testing Gateway Healthcheck..."
    if command -v curl >/dev/null 2>&1; then
      curl -s http://localhost:3001/api/health || curl -s http://localhost/api/health
      echo ""
    else
      docker compose exec gateway wget -qO- http://localhost:3001/api/health
      echo ""
    fi
    ;;
  backup)
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="remotemm_data_backup_${TIMESTAMP}.tar.gz"
    echo "[RemoteMM] Creating backup of ./data volume to $BACKUP_FILE..."
    tar -czvf "$BACKUP_FILE" data/
    echo "[RemoteMM] Backup created successfully: $BACKUP_FILE"
    ;;
  *)
    usage
    ;;
esac
