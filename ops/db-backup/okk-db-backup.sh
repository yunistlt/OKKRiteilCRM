#!/usr/bin/env bash
# Свой бэкап базы ОКК на VPS. Не зависит от Supabase: если лягут они — дамп у нас.
# Настройки: /etc/okk-db-backup.env (права 600). Установка — README.md рядом.
set -uo pipefail

: "${OKK_DB_URL:?нет OKK_DB_URL}"
DIR="${OKK_BACKUP_DIR:-/var/backups/okk-db}"
KEEP_HOURS="${OKK_KEEP_HOURS:-72}"     # сколько часов держим частые дампы
KEEP_DAYS="${OKK_KEEP_DAYS:-30}"       # сколько дней держим ночной дамп (03:xx)
BOT="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${OWNER_CHAT_ID:-}"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DIR/okk-$STAMP.dump"
mkdir -p "$DIR"

alarm() {
  echo "$(date -Is) АВАРИЯ: $1"
  [ -n "$BOT" ] && [ -n "$CHAT" ] && curl -s -m 20 \
    "https://api.telegram.org/bot$BOT/sendMessage" \
    -d chat_id="$CHAT" -d text="Бэкап базы ОКК не сделан: $1" >/dev/null
}

START=$(date +%s)
# -Fc: сжатый формат, восстанавливается выборочно через pg_restore
if ! pg_dump "$OKK_DB_URL" -Fc --no-owner --no-privileges -f "$OUT.part" 2>"$DIR/last-error.txt"; then
  alarm "pg_dump упал: $(tail -c 400 "$DIR/last-error.txt" | tr '\n' ' ')"
  rm -f "$OUT.part"
  exit 1
fi
mv "$OUT.part" "$OUT"
SIZE=$(stat -c %s "$OUT")
SECS=$(( $(date +%s) - START ))

# Пустой или подозрительно маленький дамп — это не бэкап, а ложное спокойствие.
PREV=$(ls -1t "$DIR"/okk-*.dump 2>/dev/null | sed -n 2p)
if [ "$SIZE" -lt 1000000 ]; then
  alarm "дамп всего $SIZE байт — проверь вручную"
  exit 1
fi
if [ -n "$PREV" ]; then
  PSIZE=$(stat -c %s "$PREV")
  if [ "$SIZE" -lt $(( PSIZE / 2 )) ]; then
    alarm "дамп $SIZE байт против $PSIZE в прошлый раз — проверь вручную"
  fi
fi

# Ротация: частые дампы держим KEEP_HOURS, ночной (03:xx UTC) — KEEP_DAYS.
find "$DIR" -name 'okk-*T0[0-2]*.dump' -mmin +$(( KEEP_HOURS * 60 )) -delete
find "$DIR" -name 'okk-*T0[4-9]*.dump' -mmin +$(( KEEP_HOURS * 60 )) -delete
find "$DIR" -name 'okk-*T1*.dump' -mmin +$(( KEEP_HOURS * 60 )) -delete
find "$DIR" -name 'okk-*T2*.dump' -mmin +$(( KEEP_HOURS * 60 )) -delete
find "$DIR" -name 'okk-*T03*.dump' -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) готово: $OUT, $SIZE байт, $SECS с"
