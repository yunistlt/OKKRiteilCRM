# Свой бэкап базы ОКК

Дамп базы на VPS обратного прокси (5.42.111.117, Timeweb), раз в 2 часа.

## Зачем, если бэкапы есть у Supabase

У нас тариф Pro без add-on PITR ($100/мес, 20.10.2026 решили не брать): Supabase делает
**один дамп в сутки**. Авария в конце дня стоила бы всей дневной работы отдела. Свой дамп
раз в 2 часа сокращает потерю до двух часов и, в отличие от бэкапа Supabase, лежит не у
Supabase — то есть переживает и аварию самого Supabase.

Повод: 20.10.2026 на соседнем заводе лёг сервер базы ЦехУспеха и встала работа 30 заводов
на много часов.

## Установка на VPS

```bash
sudo install -d /opt/okk-db-backup /var/backups/okk-db
sudo cp okk-db-backup.sh /opt/okk-db-backup/
sudo chmod +x /opt/okk-db-backup/okk-db-backup.sh
```

Клиент Postgres 17 (версия клиента не ниже серверной, иначе pg_dump откажется):

```bash
sudo apt-get install -y postgresql-client-17   # репозиторий pgdg, уже подключён
```

Настройки — `/etc/okk-db-backup.env`, права `600`:

```
OKK_DB_URL=postgresql://postgres.<ref>:<пароль>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
OKK_BACKUP_DIR=/var/backups/okk-db
OKK_KEEP_HOURS=48
OKK_KEEP_DAYS=14
TELEGRAM_BOT_TOKEN=<токен @okkzmk_bot>
OWNER_CHAT_ID=<личка владельца>
```

**Порт 5432, не 6543.** 6543 — транзакционный пулер, `pg_dump` через него не работает.

Крон (`sudo crontab -e`):

```
5 */2 * * * set -a; . /etc/okk-db-backup.env; set +a; /opt/okk-db-backup/okk-db-backup.sh >> /var/log/okk-db-backup.log 2>&1
```

## Что хранится

| Что | Срок |
|---|---|
| Дампы каждые 2 часа | 48 часов |
| Ночной дамп (03:xx UTC) | 14 дней |

Формат `-Fc` (сжатый, выборочное восстановление через `pg_restore`).

## Тревога

Скрипт пишет владельцу в Telegram, если: `pg_dump` упал, дамп меньше 1 МБ, дамп вдвое
меньше предыдущего. Молчание = бэкап сделан. Сам скрипт ничего не чинит.

## Восстановление — см. ../DR.md
