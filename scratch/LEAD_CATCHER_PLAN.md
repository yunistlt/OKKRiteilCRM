# Ловец Лидов — Дорожная карта

## Контекст
Ловец Лидов — это система работы с лидом от первого касания до оплаченного счёта.
Живёт в Next.js проекте OKK (okk.zmksoft.com). Виджет встраивается в Webasyst через блок `{literal}`.

Инфраструктура уже есть: Supabase, RetailCRM, Telphin, Яндекс SMTP, GPT-4o-mini.

---

## Статус на сейчас

- [x] Чат с AI (Елена) — GPT-4o-mini + RAG по базе знаний
- [x] Сохранение сессии в Supabase (`widget_sessions`, `widget_messages`)
- [x] Детекция телефона → автосоздание лида в RetailCRM
- [x] Обратный звонок через Telphin (`widget_callback_requests`)
- [x] Отправка wishlist на email (Яндекс SMTP)
- [x] Загрузка файлов (ТЗ) в Supabase Storage
- [x] Exit-intent: mouseleave + mouseout + pointerout + escape + blur
- [x] Карточки просмотренных товаров при exit-intent
- [x] Приветствие строго 1 раз за сессию (sessionStorage)
- [x] Защита от двойной инициализации виджета
- [x] **Мгновенное сохранение товара** (без 2-сек задержки) — коммит d20ecb9
- [x] **beforeunload страховка** (товар сохраняется при уходе) — коммит d20ecb9
- [x] **Превентивный exit-intent** (mousemove Y < 80px, debounce 150ms) — коммит d20ecb9
- [x] **Мгновенный показ сообщений при exit-intent** (без анимации печатания) — коммит d20ecb9

---

## Фаза 1 — Виджет: Быстрые действия (Неделя 1)

### 1.1 Кнопки быстрых действий в чате
- [x] Добавить CSS для `.okk-quick-btns` — горизонтальный scroll-ряд кнопок
- [x] Показывать кнопки через 25 сек после приветствия (если нет взаимодействия)
- [x] Кнопка **"📋 Хочу КП"** → отправляет в чат "Хочу получить коммерческое предложение"
- [x] Кнопка **"📞 Позвоните мне"** → показывает форму захвата телефона
- [x] Кнопка **"💬 Есть вопрос"** → фокус на поле ввода
- [x] После нажатия любой кнопки — скрыть блок кнопок
- [x] Файл: `scratch/current_site_widget.js`

### 1.2 Форма захвата телефона (inline в чате)
- [x] Функция `addPhoneCapture()` по аналогии с `addEmailCapture()`
- [x] Поля: имя, телефон (обязательные), компания (опционально)
- [x] Валидация: телефон в формате +7/8 + 10 цифр
- [x] При отправке → `POST /api/widget/chat` с `type: 'callback'`
- [x] Успех → сообщение "Перезвоним в течение 15 минут"
- [x] Файл: `scratch/current_site_widget.js`

---

## Фаза 1.5 — Калькулятор-квиз СНОЛЕКС (Неделя 1-2)

> Источник: `scratch/snolex_calculator_package.md` (разработан Gemini)
> Интерактивный конфигуратор муфельных печей категории 1369, встраивается на страницу категории Webasyst.
> **Двухшаговая лид-генерация**: Шаг 1 = email + спецификация, Шаг 2 = телефон + подарок (Алиса).

### 1.5.1 Бэкенд: API `/api/leads/catch`
- [x] Создать `app/api/leads/catch/route.ts`
- [x] **Шаг 1** (email + specs): валидация email → INSERT в новую таблицу `calculator_leads` → вернуть `lead_id`
- [x] **Шаг 2** (lead_id + phone + gift): UPDATE записи → создать лид в RetailCRM через `lib/retailcrm-leads.ts`
- [x] Маппинг в RetailCRM: `orderMethod = "quiz-calculator"`, теги `Калькулятор`, `СНОЛЕКС`, `Ловец_Лидов_ОКК`
- [x] Комментарий менеджера: объём, температура, сеть, цена, подарок, бонус "бесплатная онлайн-настройка"

### 1.5.2 База данных
- [x] Создать миграцию `migrations/20260506_calculator_leads.sql`
- [x] Таблица `calculator_leads`:
  - `id` UUID PRIMARY KEY
  - `email` TEXT NOT NULL
  - `phone` TEXT
  - `gift` TEXT
  - `price` INTEGER
  - `specs` JSONB — `{category_id, category_name, volume, temp, phase}`
  - `crm_order_id` TEXT — ID заказа в RetailCRM после Шага 2
  - `step` INTEGER DEFAULT 1 — текущий шаг (1 или 2)
  - `created_at` TIMESTAMPTZ DEFAULT NOW()
  - `updated_at` TIMESTAMPTZ DEFAULT NOW()

### 1.5.3 Фронтенд: виджет калькулятора (готов, нужна интеграция)
- [ ] Взять готовый HTML/CSS/JS из `scratch/snolex_calculator_package.md`
- [x] Заменить `OKK_API_URL` на `https://okk.zmksoft.com/api/leads/catch`
- [ ] Вставить в Webasyst блок `{literal}` на странице категории 1369
- [ ] Проверить работу расчёта цены (client-side формула): 10л=95к, 20л=×1.35, 50л=×2.1, 100л=×3.2 + температурные/фазовые коэффициенты
- [ ] Проверить маску телефона (Vanilla JS без jQuery)
- [ ] Проверить двухшаговый флоу: email → step-2 → phone → step-3 (success)

### 1.5.4 Масштабирование (задел на будущее)
- [ ] API `/api/leads/catch` сделать универсальным — принимает любой `specs` JSONB
- [ ] Заложить возможность клонирования фронтенда на другие категории (верстаки, ЛВЖ-шкафы)
- [ ] Параметр `category_id` в payload — для аналитики по категориям

---

## Фаза 2 — Панель менеджера ✅ УЖЕ РЕАЛИЗОВАНА

> Существует: `app/okk/lead-catcher/page.tsx` — полноценная панель с real-time чатом.

### 2.1 Список лидов
- [x] `app/okk/lead-catcher/page.tsx` — список сессий с поиском
- [x] Таблица: дата, никнейм, домен, статус, последнее сообщение
- [x] Фильтр поиска по имени и городу
- [x] Онлайн-статус (зелёная точка — активен < 5 мин)
- [x] Realtime подписка через Supabase channels

### 2.2 Карточка лида
- [x] История чата (все сообщения из `widget_messages`)
- [x] Просмотренные товары, UTM, Landing Page, город
- [x] Логи событий (`widget_events`)
- [x] Заметки менеджера (`manager_notes`)

### 2.3 Ответ менеджера в чат
- [x] Кнопка «Перехватить диалог» → `is_human_takeover = true`
- [x] Поле ввода → INSERT в `widget_messages` с role='assistant'
- [x] Виджет подхватывает через `poll()` каждые 3 сек

---

## Фаза 3 — Напоминания (Неделя 3-4)

### 3.1 База данных
- [x] Создать миграцию `migrations/20260506_lead_reminders.sql`
- [x] Таблица `lead_reminders`: id, session_id, type, scheduled_at, status, recipient_email, manager_email, sent_at, error_message
- [x] Уникальный индекс `(session_id, type)` — не дублировать напоминания

### 3.2 Сценарии напоминаний
- [x] **Брошенные товары** (`abandoned_cart`): нет контакта, > 24ч → уведомление менеджеру
- [x] **Нет ответа** (`no_manager_reply`): последнее сообщение от user, нет ответа > 4ч → уведомление менеджеру
- [x] **Реактивация** (`reactivation`): лид > 7 дней без движения + есть email → письмо клиенту

### 3.3 Cron
- [x] Создать `app/api/cron/lead-reminders/route.ts`
- [x] Добавить в `vercel.json`: `"0 * * * *"` (каждый час)
- [x] Отправка email через Яндекс SMTP (`SMTP_USER` / `SMTP_PASS`)
- [x] Настроить `MANAGER_NOTIFICATION_EMAIL` в env (или fallback на `SMTP_USER`)
- [ ] Применить миграцию `20260506_lead_reminders.sql` в Supabase

---

## Фаза 4 — Коммерческие предложения (Месяц 2)

### 4.1 База данных
- [x] Создать миграцию `migrations/20260506_lead_proposals.sql`
- [x] Таблица `lead_proposals`: id, session_id, title, intro, items JSONB, discount_pct, valid_until, status, token (unique), pdf_url, viewed_at, sent_at, created_by

### 4.2 Генерация КП
- [x] Создать `app/api/lead-catcher/proposals/route.ts`
  - [x] `GET ?session_id=` → список КП сессии
  - [x] `POST` → создать КП, AI-введение (`generate_intro: true`), генерация PDF
- [x] Создать `lib/pdf-generator.ts`
  - [x] Установить `@react-pdf/renderer` v4.5.1
  - [x] Шаблон PDF: шапка ЗМК, таблица позиций, скидка, итог с НДС, условия, подпись
  - [x] Сохранить PDF в Supabase Storage `okk-assets/proposals/{token}.pdf`

### 4.3 Публичная страница КП
- [x] Создать `app/lead-catcher/proposal/[token]/page.tsx`
  - [x] Отображение позиций, итого, условий
  - [x] При открытии → UPDATE `viewed_at` + статус `viewed`
  - [x] Кнопка "Скачать PDF" (если есть pdf_url)
  - [x] Доступна без авторизации по токену

### 4.4 Отправка КП
- [x] Создать `app/api/lead-catcher/proposals/[id]/send/route.ts`
  - [x] `POST /api/lead-catcher/proposals/{id}/send` → отправить email клиенту
  - [x] Email-шаблон в стиле Елены (ЗМК): ссылка на онлайн-страницу + PDF
  - [x] Обновить статус КП → `sent`
  - [x] Добавить комментарий к заказу в RetailCRM
- [x] Создать `migrations/20260506_widget_sessions_extend.sql`
  - [x] Колонки: nickname, has_contacts, interested_products, contact_name/email/phone/company, crm_order_id

---

## Фаза 5 — Счета на оплату (Месяц 2-3)

### 5.1 База данных
- [x] Создать миграцию `migrations/20260506_lead_invoices.sql`
  - [x] Таблица `lead_invoices`: invoice_number, items JSONB, total_amount, vat_pct, payer_*, status, token, pdf_url, due_date, paid_at, sent_at, viewed_at
  - [x] Статусы: draft | sent | awaiting_payment | paid | cancelled | overdue
  - [x] Последовательность `lead_invoice_seq` для автономеров ЗМК-YYYY-NNNN

### 5.2 Генерация счёта
- [x] Создать `app/api/lead-catcher/invoices/route.ts`
  - [x] `POST` → создать счёт (номер ЗМК-YYYY-NNNN, PDF в Supabase Storage)
  - [x] `GET ?session_id=` → список счётов сессии
- [x] Добавить `generateInvoicePDF()` в `lib/pdf-generator.ts`
  - [x] Официальный формат: реквизиты продавца (env INVOICE_SELLER_*), плательщик, таблица, НДС, подпись
  - [x] Реквизиты читаются из env-переменных (fallback: заглушки)

### 5.3 Управление счётом
- [x] Создать `app/api/lead-catcher/invoices/[id]/route.ts`
  - [x] `PATCH` → сменить статус (в т.ч. отметить оплаченным вручную)
- [x] Создать `app/api/lead-catcher/invoices/[id]/send/route.ts`
  - [x] `POST` → отправить email клиенту + комментарий в RetailCRM
  - [x] Email-шаблон: сумма, срок, реквизиты для перевода

### 5.4 Публичная страница счёта
- [x] Создать `app/lead-catcher/invoice/[token]/page.tsx`
  - [x] Плательщик, состав, реквизиты для банковского перевода
  - [x] При открытии → UPDATE viewed_at
  - [x] Кнопка "Скачать PDF"
  - [x] Блок "Оплачен" при status=paid

### 5.5 ~~Платёжная интеграция~~ (не реализуем)
- Оплата только через банк — менеджер вручную отмечает `status=paid`
- Онлайн-эквайринг не нужен

---

## Фаза 6 — Аналитика (Месяц 3)

### 6.1 Дашборд
- [x] Создать `app/lead-catcher/admin/analytics/page.tsx` + `LeadAnalyticsClient.tsx`
- [x] Метрики:
  - [x] Лиды за период (7/30/90/365 дней)
  - [x] Воронка конверсии: лид → контакт → КП → счёт → оплата
  - [x] Топ просматриваемых товаров
  - [x] Топ UTM-источников
  - [x] Средний чек КП и счёта
  - [x] Выручка по оплаченным счетам
  - [x] График по дням (лиды / КП / оплаты)
- [x] Создать `app/api/lead-catcher/analytics/route.ts` — API аналитики

### 6.2 Экспорт
- [x] Выгрузка лидов в CSV
- [x] Выгрузка КП в CSV
- [x] Выгрузка счётов в CSV
- [x] Создать `app/api/lead-catcher/export/route.ts` — CSV с UTF-8 BOM (для Excel)

---

## Технические долги

- [ ] Убрать `interestTimerMs: 2000` из `WIDGET_CONFIG` (уже не используется)
- [ ] Перенести логику захвата товаров в отдельную функцию `captureCurrentProduct()`
- [ ] Добавить rate limiting на API endpoints (против спама)
- [ ] Добавить honeypot поле в форму захвата контактов (защита от ботов)
- [ ] Мониторинг ошибок (Sentry или логи в Supabase)
- [ ] Тесты для критических путей: захват лида, создание КП, подтверждение оплаты

---

## Relevant Files

| Файл | Статус | Описание |
|------|--------|----------|
| `scratch/current_site_widget.js` | ✅ В работе | Webasyst виджет |
| `app/api/widget/chat/route.ts` | ✅ Есть | Основной чат API |
| `app/api/widget/wishlist-email/route.ts` | ✅ Есть | Отправка wishlist |
| `app/api/widget/upload/route.ts` | ✅ Есть | Загрузка файлов |
| `lib/retailcrm-leads.ts` | ✅ Есть | Создание лидов в RetailCRM |
| `scratch/snolex_calculator_package.md` | ✅ Есть | Готовый пакет калькулятора СНОЛЕКС |
| `app/api/leads/catch/route.ts` | ✅ Создан | API приёма заявок с калькулятора |
| `migrations/20260506_calculator_leads.sql` | ✅ Создана | Миграция таблицы calculator_leads |
| `migrations/20260506_lead_reminders.sql` | ✅ Создана | Миграция таблицы lead_reminders |
| `app/api/cron/lead-reminders/route.ts` | ✅ Создан | Cron напоминаний (каждый час) |
| `app/lead-catcher/admin/page.tsx` | ✅ Есть (okk/lead-catcher) | Панель менеджера |
| `app/lead-catcher/proposal/[token]/page.tsx` | ✅ Создана | Публичная страница КП |
| `app/lead-catcher/invoice/[token]/page.tsx` | ✅ Создана | Страница счёта |
| `app/lead-catcher/admin/analytics/page.tsx` | ✅ Создана | Дашборд аналитики |
| `app/api/lead-catcher/proposals/route.ts` | ✅ Создан | API для КП |
| `app/api/lead-catcher/invoices/route.ts` | ✅ Создан | API для счётов |
| `app/api/lead-catcher/analytics/route.ts` | ✅ Создан | API аналитики |
| `app/api/lead-catcher/export/route.ts` | ✅ Создан | CSV экспорт (лиды/КП/счета) |
| `app/api/cron/lead-reminders/route.ts` | ✅ Создан | Cron напоминаний (каждый час) |
| `lib/pdf-generator.ts` | ✅ Создан | Генерация PDF (@react-pdf/renderer) |
