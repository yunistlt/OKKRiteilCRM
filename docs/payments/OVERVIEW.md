# Сервис распределения платежей «с точки»

Принимает банковские платежи из **банка Точка** (Точка.API) и разносит их по
соответствующим заказам RetailCRM. Неоднозначные/несопоставленные платежи —
в очередь на ручной разбор.

## Поток данных

```
Точка (вебхук JWT) ──POST──▶ /api/payments/tochka
                               │  проверка подписи + нормализация
                               ▼
                        point_payments (status=pending_match)   [Supabase]
                               │
        cron */1 ──▶ /api/cron/system-jobs/point-payment-ingest
                               │  матчинг заказа
                    ┌──────────┴───────────┐
              уверенный матч            неоднозначно / нет матча
              + подпись OK                     │
                    │                          ▼
                    ▼                  очередь ручного разбора
        RetailCRM POST orders/payments/create   (страница /payments)
                    │                          │
                    ▼                          ▼
             status=matched            оператор привязывает →
             retailcrm_synced_at       status=manual + проброс в CRM
```

## Матчинг платёж → заказ

Ключ привязки — **номер счёта из назначения платежа**, который в этой точке
совпадает с **номером заказа RetailCRM** (`orders.number`).

1. **Основной** (`order_number`, confidence `high`): из `purpose` извлекается номер
   счёта/договора (`lib/payments/matching.ts::extractInvoiceNumbers`) и ищется
   заказ по `orders.number`. Единственное совпадение → авто-привязка.
2. **Фолбэк** (`inn_amount_date`, confidence `medium`): ИНН плательщика + сумма
   заказа. Телефона у юрлиц нет, поэтому используется ИНН контрагента.
3. **Иначе** → `pending_match`, кандидаты сохраняются в `match_candidates` для
   ручного разбора.

Реальные форматы назначения (из боевых платежей):
- `ОПЛАТА ПО СЧЕТУ №53433 ОТ 08.06.2026Г ...` → заказ `53433`
- `Окончательная по счету № 53016 ..., к дог. № 53016` → заказ `53016`
- `Оплата по счету № 1007/2 ...` → `1007/2`, затем база `1007`

Частичные платежи (аванс + окончательная) поддержаны: каждый платёж — отдельная
строка и отдельный `payment` в заказе RetailCRM; суммирование ведёт CRM.

## Безопасность

Вебхук Точки приходит как **JWT (RS256)**. Подпись проверяется публичным ключом
Точки (`TOCHKA_WEBHOOK_JWKS_URL` или `TOCHKA_WEBHOOK_PUBLIC_KEY`). Если ключ не
настроен — платёж принимается, но `signature_verified=false`, и **авто-проброс в
RetailCRM запрещён**: такой платёж уходит в ручной разбор. Это защищает от
поддельных платежей, создающих оплату в CRM.

Дополнительно можно задать общий секрет `TOCHKA_WEBHOOK_SECRET` (проверяется в
query `?secret=` или заголовке `x-webhook-secret`).

## Компоненты

| Слой | Файл |
|------|------|
| Таблица | `migrations/20260711_point_payments.sql` (`point_payments`) |
| Типы/утилиты | `lib/payments/types.ts` |
| Адаптер Точки (JWT + нормализация) | `lib/payments/tochka.ts` |
| Матчинг заказа | `lib/payments/matching.ts` |
| Сервис (приём/обработка/привязка) | `lib/payments/service.ts` |
| Запись платежа в RetailCRM | `lib/retailcrm/payments.ts` |
| Вебхук приёма | `app/api/payments/tochka/route.ts` (публичный) |
| Крон-воркер | `app/api/cron/system-jobs/point-payment-ingest/route.ts` |
| API разбора | `app/api/payments/list`, `app/api/payments/[id]/assign`, `.../ignore` |
| UI разбора | `app/payments/page.tsx` |
| Тесты | `tests/point-payments.test.ts` |

## ENV

| Переменная | Назначение |
|------------|------------|
| `TOCHKA_JWT_TOKEN` | Токен доступа к Точка.API (JWT-ключ). Для будущих вызовов выписок/статусов |
| `TOCHKA_WEBHOOK_JWKS_URL` | URL JWKS с публичным ключом Точки (проверка подписи вебхука) |
| `TOCHKA_WEBHOOK_PUBLIC_KEY` | Альтернатива JWKS — публичный ключ PEM (SPKI) |
| `TOCHKA_WEBHOOK_SECRET` | Опциональный общий секрет вебхука |
| `RETAILCRM_BANK_PAYMENT_TYPE` | Код типа оплаты RetailCRM (`payment-types`), по умолчанию `bank-transfer` |
| `CRON_SECRET` | Bearer-авторизация крон-воркера |

## Статусы `point_payments.status`

- `pending_match` — ждёт матчинга или ручного разбора
- `matched` — привязан автоматически (по номеру заказа/ИНН)
- `manual` — привязан оператором вручную
- `ignored` — намеренно пропущен (не наш платёж / возврат)
- `failed` — ошибка обработки

## Настройка вебхука в Точке

1. В личном кабинете Точки создать **JWT-ключ** (для внутренней интеграции), а не
   OAuth 2.0 (OAuth нужен только для подключения чужих клиентов Точки).
2. Указать URL вебхука: `https://<домен>/api/payments/tochka` (+ `?secret=…`, если
   используете `TOCHKA_WEBHOOK_SECRET`).
3. Подписаться на события входящих платежей (`incomingPayment`, СБП-входящие).
4. Задать `TOCHKA_WEBHOOK_JWKS_URL`/`TOCHKA_WEBHOOK_PUBLIC_KEY` для проверки подписи.

## Применение миграции

Раннера миграций нет. Применить `migrations/20260711_point_payments.sql` напрямую
к БД (`DATABASE_URL`), как остальные миграции проекта (см. корневой `CLAUDE.md`).
