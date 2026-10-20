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

## Третья копия: домашняя Ubuntu

`okk-backup-pull.sh` — домашняя машина (`ssh home`, MacBookPro9-2, 915 ГБ) раз в сутки
забирает с VPS ночные дампы и держит их 90 дней.

Зачем третья: две первые копии живут у провайдеров. Домашняя спасает от потери аккаунта
Supabase или Timeweb, от шифровальщика и от нашей же ошибки, замеченной через месяц.

**Тянет дом, а не толкает VPS.** Поэтому на VPS нет ни доступа к дому, ни ключа от него:
взломанный VPS не дотянется до архива. Ключ дома (`~/.ssh/okk_backup_pull`) заперт на VPS
в `authorized_keys` на чтение одного каталога:

```
command="/usr/bin/rrsync -ro /var/backups/okk-db",restrict ssh-ed25519 AAAA...
```

Проверено: чтение работает, запись отбивается (`sending to read-only server is not
allowed`), shell отбивается (`SSH_ORIGINAL_COMMAND does not run rsync`).

Установка на домашней машине:

```bash
cp okk-backup-pull.sh ~/ && chmod +x ~/okk-backup-pull.sh
# ~/.okk-backup.env (права 600): TELEGRAM_BOT_TOKEN и OWNER_CHAT_ID
crontab -e
30 7 * * * set -a; . $HOME/.okk-backup.env; set +a; $HOME/okk-backup-pull.sh >> $HOME/okk-backup-pull.log 2>&1
```

Тревога в Telegram: не забралось с VPS, дома пусто, или самый свежий дамп старше 36 часов
(то есть бэкап на VPS встал, а rsync об этом молчит — отрабатывает-то он успешно).

Машина должна быть включена. Пропущенная ночь не страшна — на следующий раз догонит всё,
чего не хватает.

## Итог: три копии

| Копия | Где | Свежесть | Глубина | От чего спасает |
|---|---|---|---|---|
| 1 | Supabase | сутки | 7 дней | наша ошибка в данных |
| 2 | VPS Timeweb | 2 часа | 48 ч + 14 ночных | авария Supabase |
| 3 | Дом | сутки | 90 дней | потеря аккаунта, шифровальщик, старая ошибка |
