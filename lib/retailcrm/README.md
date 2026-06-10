# RetailCRM — единый узел интеграции

Папка-источник правды по интеграции с **RetailCRM** (инстанс `zmktlt.retailcrm.ru`,
приложение `okk.zmksoft.com`). Сюда складываем код + документацию, чтобы не искать
каждый раз имена эндпоинтов, ключей, полей и таблиц.

- **[API.md](./API.md)** — справочник RetailCRM API v5: эндпоинты, параметры, имена полей ответа (сверено с офиц. докой).
- **[NAMING.md](./NAMING.md)** — имена: env-переменные, таблицы/колонки БД, коды кастом-полей и справочников, ключевые маппинги (напр. `typ_castomer` → справочник `kategoriya_klienta`).

## Модули папки (`@/lib/retailcrm/<name>`)

| Модуль | Назначение |
|--------|------------|
| `dictionaries-sync.ts` | Полный синк каталога: все справочники `custom-fields/dictionaries` + все поля `custom-fields` по всем сущностям. Экспорт: `fetchRetailcrmCatalog()` (чтение из CRM), `syncRetailcrmCatalog()` (чтение+запись), `isRetailcrmConfigured()`. Потребители: `app/api/sync/dictionaries/route.ts` (эндпоинт+cron), `scripts/sync_retailcrm_dictionaries.ts` (`npm run retailcrm:sync-dictionaries`) |
| `orders.ts` | Загрузка/синхронизация заказов (delta, history, sinceId), пагинация |
| `order-context.ts` | Сбор контекста заказа для ИИ |
| `mapping.ts` | Маппинг кодов справочников/полей в человекочитаемые значения (читает `retailcrm_dictionaries`) |
| `leads.ts` | Создание лидов/заказов, `getCrmConfig()` (источник url/key/site из env) |
| `sync-state.ts` | Состояние синка (курсоры, overlap, circuit breaker) |

## Конфиг (как авторизуемся)

`getCrmConfig()` в `lib/retailcrm/leads.ts` — единственный источник, читает **только env**:
`RETAILCRM_URL` (или `RETAILCRM_BASE_URL`), `RETAILCRM_API_KEY` (или `RETAILCRM_KEY`),
`RETAILCRM_SITE`. На проде заданы в Vercel; локально в `.env.local` их НЕТ
(поэтому живой синк локально не запускается — только на проде/с ключом).

## Главные грабли

- **`limit` обязателен и ограничен набором значений.** Для заказов/истории — строго `20|50|100`
  (иначе 400). Для `custom-fields`/`custom-fields/dictionaries` — `20|50|100|250`. Используем `100`.
- **Значения справочников НЕ приходят внутри `custom-fields`.** Их даёт отдельный метод
  `GET /api/v5/custom-fields/dictionaries`. Старый синк читал `field.dictionaryElements` и
  возвращал `synced_count:0` — это тупик, не повторять.
- **`typ_castomer`** (поле заказа) хранит **категорию товара**, а имена категорий — в справочнике
  с кодом **`kategoriya_klienta`** (не `typ_castomer`!). Само поле `kategoriya_klienta` в заказах пустое.
  Подробности — в [NAMING.md](./NAMING.md).
