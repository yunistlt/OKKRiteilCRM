#!/usr/bin/env bash
# Третья копия базы ОКК: домашняя Ubuntu сама забирает ночные дампы с VPS.
# Тянет ДОМ, а не толкает VPS — взломанный VPS не достанет домашний архив.
# Ключ на VPS заперт на чтение одного каталога (rrsync -ro).
set -uo pipefail

SRC="${OKK_PULL_SRC:-root@5.42.111.117:/}"
DIR="${OKK_HOME_DIR:-$HOME/okk-backups}"
KEY="${OKK_PULL_KEY:-$HOME/.ssh/okk_backup_pull}"
KEEP_DAYS="${OKK_HOME_KEEP_DAYS:-90}"
BOT="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${OWNER_CHAT_ID:-}"

alarm() {
  echo "$(date -Is) АВАРИЯ: $1"
  [ -n "$BOT" ] && [ -n "$CHAT" ] && curl -s -m 20 \
    "https://api.telegram.org/bot$BOT/sendMessage" \
    -d chat_id="$CHAT" -d text="Домашняя копия базы ОКК: $1" >/dev/null
}

mkdir -p "$DIR"

# Только ночные дампы (03:xx UTC) — дома нужен архив на глубину, а не частота.
if ! rsync -a --timeout=600 \
      -e "ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=30" \
      --include='okk-*T03*.dump' --exclude='*' \
      "$SRC" "$DIR/" 2>"$DIR/last-error.txt"; then
  alarm "не забралась с VPS: $(tail -c 300 "$DIR/last-error.txt" | tr '\n' ' ')"
  exit 1
fi

NEWEST=$(ls -1t "$DIR"/okk-*.dump 2>/dev/null | head -1)
if [ -z "$NEWEST" ]; then
  alarm "дома нет ни одного дампа"
  exit 1
fi

# Свежесть важнее факта копирования: rsync отработает успешно и тогда,
# когда на VPS уже сутки не появлялось новых дампов.
AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST") ) / 3600 ))
if [ "$AGE_H" -gt 36 ]; then
  alarm "самый свежий дамп старше $AGE_H ч — бэкап на VPS, похоже, встал"
fi

find "$DIR" -name 'okk-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) готово: $(ls -1 "$DIR"/okk-*.dump | wc -l) дампов, последний $(basename "$NEWEST"), $AGE_H ч назад"
