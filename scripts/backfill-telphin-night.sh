#!/bin/bash
# Ночная дотяжка истории звонков Телфина (решение владельца 05.10.2026).
# Журнал: /tmp/telphin-backfill.log. Прерванный прогон продолжается ключом --continue.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a
echo "=== старт $(date) ==="
exec npx tsx scripts/backfill-telphin-history.ts "$@"
