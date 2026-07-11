# Сервис распределения платежей «с точки»

Принимает банковские платежи из **банка Точка** (Точка.API) и разносит их по
соответствующим заказам RetailCRM. Неоднозначные/несопоставленные — в очередь на
ручной разбор. Работает по двум каналам: **вебхук** (онлайн, вперёд) и **выписка**
(история, бэкофилл).

> Статус: 🟢 в проде. Страница: `/payments` (роли `admin`, `rop`).

---

## 1. Как это работает (сверху)

```
┌─ Онлайн ──────────────────────────────────────────────────────────────┐
│  Точка ──вебхук(JWT RS256)──▶ POST /api/payments/tochka                │
│                                 проверка подписи → нормализация         │
│                                 → запись → СРАЗУ матчинг+проброс         │
└───────────────────────────────────────────────────────────────────────┘
┌─ История (бэкофилл) ──────────────────────────────────────────────────┐
│  /payments «Загрузить за период» ──▶ POST /api/payments/backfill        │
│    список счетов → создать выписку → дождаться Ready → транзакции        │
│    → входящие (Credit) → запись → СРАЗУ матчинг+проброс                 │
└───────────────────────────────────────────────────────────────────────┘
                              │
                   ┌──────────┴───────────┐
             уверенный матч          неоднозначно / нет матча
                    │                        │
      RetailCRM POST orders/payments/create  ▼
                    │              очередь ручного разбора (/payments)
                    ▼                        │
             status=matched         оператор привязывает вручную →
             + ссылка на заказ      проброс в RetailCRM
```

**Обработка синхронная, по событию** — матчинг и проброс выполняются сразу при
приёме вебхука и при загрузке выписки, крон не ждём. Крон-воркер
(`point-payment-ingest`, раз в 15 мин) оставлен только как **страховочный ретрай**
для платежей, которые не проброшены из-за временной ошибки RetailCRM.

---

## 2. Матчинг платёж → заказ

Ключ привязки — **номер счёта из назначения платежа**, который в этой точке
совпадает с **номером заказа RetailCRM** (`orders.number`).

1. **Основной** (`order_number`, confidence `high`): из `purpose` извлекается номер
   счёта/договора (`lib/payments/matching.ts::extractInvoiceNumbers`) и ищется заказ
   по `orders.number`. Единственное совпадение → авто-привязка.
2. **Фолбэк** (`inn_amount_date`, confidence `medium`): ИНН плательщика + сумма
   заказа (телефона у юрлиц нет).
3. **Иначе** → `pending_match`, кандидаты сохраняются в `match_candidates` для
   ручного разбора.

Реальные форматы назначения:
- `ОПЛАТА ПО СЧЕТУ №53433 ОТ 08.06.2026Г …` → заказ `53433`
- `Окончательная по счету № 53016 …, к дог. № 53016` → заказ `53016`
- `Оплата по счету № 1007/2 …` → `1007/2`, затем база `1007`

Частичные платежи (аванс + окончательная) поддержаны: каждый платёж — отдельная
строка и отдельный `payment` в заказе RetailCRM; сумму ведёт CRM.

---

## 3. Формат данных Точки (как есть)

### Вебхук (входящий платёж)
Тело POST — **JWT, подписанный RS256**. Декодированный payload:

```jsonc
{
  "webhookType": "incomingPayment",       // + incomingSbpPayment / incomingSbpB2BPayment
  "customerCode": "300…",
  "paymentId": "10730323",                 // идемпотентность (совпадает с выпиской)
  "purpose": "ОПЛАТА ПО СЧЕТУ №53433 …",   // назначение платежа
  "documentNumber": "3685",
  "date": "2026-07-10",
  "SidePayer":     { "name": "…", "inn": "…", "kpp": "…", "account": "…",
                     "bankCode": "…", "bankName": "…", "amount": "484898.30", "currency": "RUB" },
  "SideRecipient": { "account": "…", "amount": "484898.30", "currency": "RUB" }
}
```

⚠️ **Сумма и реквизиты плательщика — внутри `SidePayer`, а не на верхнем уровне.**
Для входящего платежа плательщик = `SidePayer`, наш счёт = `SideRecipient`.

### Выписка (Open Banking)
Транзакции: `Data.Statement[0].Transaction[]`. Входящие — `creditDebitIndicator: "Credit"`.

```jsonc
{
  "paymentId": "payment-2026-07-10_…",
  "transactionId": "cbs-tb;…",
  "creditDebitIndicator": "Credit",        // Credit = входящий; Debit игнорируем
  "status": "Booked",
  "documentNumber": "3685",
  "documentProcessDate": "2026-07-10",
  "description": "ОПЛАТА ПО СЧЕТУ №53433",  // назначение
  "Amount": { "amount": 484898.30, "currency": "RUB" },
  "DebtorParty":   { "name": "…", "inn": "…", "kpp": "…" },  // плательщик
  "DebtorAccount": { "identification": "…" }
}
```

---

## 4. Безопасность

- Вебхук приходит как **JWT (RS256)**; подпись проверяется публичным ключом Точки:
  `TOCHKA_WEBHOOK_JWKS_URL` (URL) или `TOCHKA_WEBHOOK_PUBLIC_KEY` (PEM/SPKI).
  Публичный ключ Точки: `https://enter.tochka.com/doc/openapi/static/keys/public`.
- **Авто-проброс в RetailCRM — только для платежей с проверенной подписью.**
  Непроверенные (`signature_verified=false`) уходят в ручной разбор.
- **Устойчивый приём:** если проверка подписи не проходит по любой причине
  (неверный ключ/формат/сеть), платёж не теряется с 500 — принимается как
  непроверенный и уходит в ручной разбор.
- Опционально общий секрет `TOCHKA_WEBHOOK_SECRET` (в query `?secret=` или заголовке
  `x-webhook-secret`).
- Платежи из **выписки** получены нами по авторизованному API → доверенные
  (`signature_verified=true`, авто-матч разрешён).

---

## 5. Подключение вебхука (через API, не через UI)

У банка Точка **нет интерфейса для вебхуков** — адрес приёма подключается её API.
На странице `/payments` есть панель **«⚙️ Подключение вебхука Точки»**:

- **Подключить вебхук** → `PUT /uapi/webhook/v1.0/{clientId}` с телом
  `{"webhooksList":[…],"url":"https://<домен>/api/payments/tochka"}` (сервер, токен из env).
- **Тест доставки** → `POST …/test_send` (Точка присылает тестовый платёж).
- **Проверить статус** → `GET …` (текущая подписка) + показывает сырьё последнего
  полученного вебхука (диагностика формата).

Скрипт-альтернатива: `scripts/tochka_webhook.ts` (`get | set <url> | test | delete`).

---

## 6. Загрузка выписки (бэкофилл истории)

Панель **«📥 Загрузить выписку за период»** на `/payments`: выбрать даты → «Загрузить».

- `POST /api/payments/backfill { from, to }` (YYYY-MM-DD).
- Поток: список счетов (`GET /open-banking/v1.0/accounts`) → создать выписку по
  каждому (`POST …/statements`) → дождаться статуса **`Ready`** (не `Created`!) →
  забрать `Transaction[]` → входящие записать и сразу разнести.
- Создание/опрос по всем счетам — **параллельно** (счетов может быть десятки).
- Идемпотентно по `paymentId` (совпадает с вебхуком — дублей не будет).
- Ответ: `{ ingested, matched, pending, details[] }`.

> Примечание: справочники предупреждают, что полная выписка требует OAuth (JWT → 501),
> но на боевом ключе этой точки выписка **доступна по JWT** (проверено). Если вернётся
> `needs_oauth`/501 — понадобится настройка OAuth+Consent.

---

## 7. Данные (`point_payments`)

Миграция: `migrations/20260711_point_payments.sql` (аддитивная).

Ключевые поля: `source`, `external_payment_id` (уникум с `source`), `webhook_type`,
`signature_verified`, `amount_kopecks`, `payment_date`, `purpose`, `document_number`,
`payer_name/_inn/_kpp/_account`, `status`, `match_method`, `match_confidence`,
`extracted_invoice_number(s)`, `match_candidates`, `matched_order_number`,
`matched_order_id`, `retailcrm_payment_id`, `retailcrm_synced_at`, `retailcrm_error`,
`raw_payload`.

### Статусы
- `pending_match` — ждёт матчинга или ручного разбора
- `matched` — привязан автоматически (по номеру заказа/ИНН)
- `manual` — привязан оператором вручную
- `ignored` — намеренно пропущен (не наш / возврат)
- `failed` — ошибка обработки

---

## 8. UI `/payments`

- Панели: подключение вебхука, загрузка выписки за период.
- Вкладки очереди: «Требуют разбора / Привязанные / Вручную / Пропущенные / Все».
- Карточка платежа: сумма, плательщик, ИНН, дата, назначение, извлечённый номер,
  бейджи статуса/«подпись не проверена».
- **Номер заказа кликабелен** → карточка заказа в RetailCRM (`{RETAILCRM_URL}/orders/{id}/edit`).
- Разбор: кнопки-кандидаты, ручной ввод номера, «Пропустить».
- Окна результата (статус вебхука/выписка) — с кнопкой **«Копировать»**.

---

## 9. ENV

| Переменная | Назначение | Default |
|------------|------------|---------|
| `TOCHKA_JWT_TOKEN` | Токен доступа к Точка.API (Bearer) | — |
| `TOCHKA_CLIENT_ID` | Client_ID приложения | из `iss` токена |
| `TOCHKA_API_BASE` | Базовый URL API | `https://enter.tochka.com/uapi` |
| `TOCHKA_API_VERSION` | Версия в пути вебхука | `v1.0` |
| `TOCHKA_WEBHOOK_JWKS_URL` | JWKS для проверки подписи вебхука | — |
| `TOCHKA_WEBHOOK_PUBLIC_KEY` | Публичный ключ Точки (PEM/SPKI), альтернатива JWKS | — |
| `TOCHKA_WEBHOOK_SECRET` | Опциональный общий секрет вебхука | — |
| `RETAILCRM_BANK_PAYMENT_TYPE` | Код типа оплаты RetailCRM (`payment-types`) | `bank-transfer` |
| `RETAILCRM_URL` | Базовый URL CRM (проброс платежа + ссылки) | — |
| `CRON_SECRET` | Bearer-авторизация крон-воркера | — |

---

## 10. Компоненты (файлы)

| Слой | Файл |
|------|------|
| Таблица | `migrations/20260711_point_payments.sql` |
| Типы/утилиты | `lib/payments/types.ts` |
| Вебхук: декод JWT + нормализация | `lib/payments/tochka.ts` |
| Вебхук: подписка через API | `lib/payments/tochka-admin.ts` |
| Выписка (бэкофилл) | `lib/payments/tochka-statement.ts` |
| Матчинг заказа | `lib/payments/matching.ts` |
| Сервис (приём/обработка/привязка) | `lib/payments/service.ts` |
| Проброс платежа в RetailCRM | `lib/retailcrm/payments.ts` |
| Вебхук приёма (публичный) | `app/api/payments/tochka/route.ts` |
| Подписка/тест/статус вебхука | `app/api/payments/subscribe/route.ts` |
| Загрузка выписки | `app/api/payments/backfill/route.ts` |
| Список/разбор | `app/api/payments/{list,[id]/assign,[id]/ignore}` |
| Крон-ретрай (страховка, 15 мин) | `app/api/cron/system-jobs/point-payment-ingest/route.ts` |
| UI | `app/payments/page.tsx` |
| Скрипт вебхука | `scripts/tochka_webhook.ts` |
| Тесты | `tests/point-payments*.test.ts` |

---

## 11. Грабли (что уже поймано)

- **Версия вебхука — `v1.0`** (с `v`), не `1.0` — иначе 501.
- **Выписка: путь `open-banking/v1.0/…`**, не `/uapi/accounts` — иначе 404.
- **Статус выписки `Created` ≠ готово**; готово — только `Ready`.
- **Сумма/плательщик вебхука — в `SidePayer`**, а не на верхнем уровне.
- **У Точки нет UI для вебхуков** — только API (`PUT /webhook/v1.0/{clientId}`).
- JWT-токен и Client_ID — из кабинета (JWT-ключи), OAuth не нужен.

---

## 12. Применение миграции

Раннера миграций нет. Применить `migrations/20260711_point_payments.sql` напрямую к
БД (`DATABASE_URL`), как остальные миграции проекта (см. корневой `CLAUDE.md`).
