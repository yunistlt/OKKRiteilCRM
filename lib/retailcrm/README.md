# RetailCRM — единый узел интеграции

Папка-источник правды по интеграции с **RetailCRM** (инстанс `zmktlt.retailcrm.ru`,
приложение `okk.zmksoft.com`). Сюда складываем код + документацию, чтобы не искать
каждый раз имена эндпоинтов, ключей, полей и таблиц.

- **[API.md](./API.md)** — справочник RetailCRM API v5: эндпоинты, параметры, имена полей ответа (сверено с офиц. докой).
- **[NAMING.md](./NAMING.md)** — имена: env-переменные, таблицы/колонки БД, коды кастом-полей и справочников, ключевые маппинги (напр. `typ_castomer` → справочник `kategoriya_klienta`).

## Код здесь

- `dictionaries-sync.ts` — полный синк каталога RetailCRM (все справочники
  `custom-fields/dictionaries` + все поля `custom-fields` по всем сущностям).
  Экспорт: `fetchRetailcrmCatalog()` (только чтение из CRM), `syncRetailcrmCatalog()`
  (чтение + запись через supabase), `isRetailcrmConfigured()`.
  Потребители: `app/api/sync/dictionaries/route.ts` (эндпоинт + cron),
  `scripts/sync_retailcrm_dictionaries.ts` (CLI: `npm run retailcrm:sync-dictionaries`).

## Остальные RetailCRM-модули (пока в `lib/retailcrm-*.ts`, мигрируют сюда постепенно)

| Модуль | Назначение |
|--------|------------|
| `lib/retailcrm-orders.ts` | Загрузка/синхронизация заказов (delta, history, sinceId), пагинация |
| `lib/retailcrm-order-context.ts` | Сбор контекста заказа для ИИ |
| `lib/retailcrm-mapping.ts` | Маппинг кодов справочников/полей в человекочитаемые значения (читает `retailcrm_dictionaries`) |
| `lib/retailcrm-leads.ts` | Создание лидов/заказов, `getCrmConfig()` (источник url/key/site из env) |
| `lib/retailcrm-sync-state.ts` | Состояние синка (курсоры, overlap, circuit breaker) |

> Перенос этих модулей в `lib/retailcrm/` — отдельным PR (затрагивает ~13 импортов).

## Конфиг (как авторизуемся)

`getCrmConfig()` в `lib/retailcrm-leads.ts` — единственный источник, читает **только env**:
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
