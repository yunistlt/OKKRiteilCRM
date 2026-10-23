#!/usr/bin/env bash
# Выкатка сборки на VPS: распаковать рядом, переключить симлинк, перезапустить.
# Прежний выпуск остаётся на месте — откат это один ln -sfn и restart.
#
#   ./deploy.sh /path/to/okk-<sha>.tar.gz
#
set -euo pipefail

ARCHIVE="${1:?укажите архив сборки}"
RELEASES=/opt/okk/releases
NAME="$(basename "$ARCHIVE" .tar.gz)"
TARGET="$RELEASES/$NAME"

[ -f /etc/okk.env ] || { echo "нет /etc/okk.env — переменные окружения не перенесены"; exit 1; }

echo "== распаковываю в $TARGET"
rm -rf "$TARGET"
mkdir -p "$TARGET"
tar xzf "$ARCHIVE" -C "$TARGET"
# Архивы, собранные на macOS, тащат служебные ._* файлы — они мешают читать каталог.
find "$TARGET" -name '._*' -delete
[ -f "$TARGET/server.js" ] || { echo "в архиве нет server.js — это не standalone-сборка"; exit 1; }

PREV="$(readlink -f /opt/okk/current || true)"
echo "== переключаю current: ${PREV:-<нет>} -> $TARGET"
ln -sfn "$TARGET" /opt/okk/current

echo "== перезапускаю okk.service"
systemctl restart okk.service
sleep 4

# Проверяем, что новый выпуск действительно отвечает; иначе возвращаем прежний.
if curl -fsS -o /dev/null --max-time 20 http://127.0.0.1:3000/login; then
    echo "== готово, сборка отвечает. Номер: $(cat "$TARGET/.next/BUILD_ID" 2>/dev/null || echo '?')"
else
    echo "!! новая сборка не отвечает"
    if [ -n "$PREV" ] && [ -d "$PREV" ]; then
        echo "== откатываю на $PREV"
        ln -sfn "$PREV" /opt/okk/current
        systemctl restart okk.service
    fi
    exit 1
fi

# Держим на диске три последних выпуска (50 ГБ всего, сборка ~90 МБ распакованной).
# Чистим ТОЛЬКО свои каталоги okk-*: рядом живёт тестовый стенд (releases/staging),
# и общая чистка «по дате» однажды снесла бы его.
ls -1dt "$RELEASES"/okk-*/ 2>/dev/null | tail -n +4 | grep -v -F "$(readlink -f /opt/okk/current)" | xargs -r rm -rf
