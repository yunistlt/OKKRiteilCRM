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
- [ ] Создать `app/api/leads/catch/route.ts`
- [ ] **Шаг 1** (email + specs): валидация email → INSERT в новую таблицу `calculator_leads` → вернуть `lead_id`
- [ ] **Шаг 2** (lead_id + phone + gift): UPDATE записи → создать лид в RetailCRM через `lib/retailcrm-leads.ts`
- [ ] Маппинг в RetailCRM: `orderMethod = "quiz-calculator"`, теги `Калькулятор`, `СНОЛЕКС`, `Ловец_Лидов_ОКК`
- [ ] Комментарий менеджера: объём, температура, сеть, цена, подарок, бонус "бесплатная онлайн-настройка"

### 1.5.2 База данных
- [ ] Создать миграцию `supabase/migrations/XXXXXX_calculator_leads.sql`
- [ ] Таблица `calculator_leads`:
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
- [ ] Заменить `OKK_API_URL` на `https://okk.zmksoft.com/api/leads/catch`
- [ ] Вставить в Webasyst блок `{literal}` на странице категории 1369
- [ ] Проверить работу расчёта цены (client-side формула): 10л=95к, 20л=×1.35, 50л=×2.1, 100л=×3.2 + температурные/фазовые коэффициенты
- [ ] Проверить маску телефона (Vanilla JS без jQuery)
- [ ] Проверить двухшаговый флоу: email → step-2 → phone → step-3 (success)

### 1.5.4 Масштабирование (задел на будущее)
- [ ] API `/api/leads/catch` сделать универсальным — принимает любой `specs` JSONB
- [ ] Заложить возможность клонирования фронтенда на другие категории (верстаки, ЛВЖ-шкафы)
- [ ] Параметр `category_id` в payload — для аналитики по категориям

---

## Фаза 2 — Панель менеджера (Неделя 2-3)

### 2.1 Список лидов
- [ ] Создать `app/lead-catcher/admin/page.tsx`
- [ ] Таблица: дата, никнейм, домен, статус, последнее сообщение, UTM-источник
- [ ] Фильтры: по статусу, дате, домену
- [ ] Пагинация (20 записей на страницу)
- [ ] Создать `app/api/lead-catcher/admin/route.ts` → SELECT из `widget_sessions`
- [ ] Добавить роль `lead_catcher_admin` в RBAC ([lib/access-control.ts](../lib/access-control.ts))

### 2.2 Карточка лида
- [ ] Создать `app/lead-catcher/admin/[sessionId]/page.tsx`
- [ ] Секция: Контакты (имя, телефон, email, компания)
- [ ] Секция: История чата (сообщения из `widget_messages`)
- [ ] Секция: Просмотренные товары (из `interested_products`)
- [ ] Секция: UTM и источник трафика
- [ ] Секция: Ссылка на лид в RetailCRM (если `crm_lead_id` есть)
- [ ] Кнопка: "Ответить в чат" → открывает форму ручного ответа

### 2.3 Ответ менеджера в чат
- [ ] Добавить поле `is_human_takeover` в `widget_sessions` (уже есть)
- [ ] API: `POST /api/lead-catcher/admin/[sessionId]/message` → INSERT в `widget_messages` с role='system'
- [ ] Виджет через poll() подхватывает сообщение менеджера
- [ ] Уведомление менеджера при новом сообщении от клиента (email или браузер)

---

## Фаза 3 — Напоминания (Неделя 3-4)

### 3.1 База данных
- [ ] Создать миграцию `supabase/migrations/XXXXXX_lead_reminders.sql`
- [ ] Таблица `lead_reminders`: id, session_id, type, scheduled_at, status, message, sent_at

### 3.2 Сценарии напоминаний
- [ ] **Брошенные товары**: если лид просматривал товары но не оставил контакт → письмо через 24 часа
- [ ] **Нет ответа**: если лид написал но менеджер не ответил > 4 часов → уведомление менеджеру
- [ ] **Запланированный звонок**: если клиент сказал "позвоните мне в X" → напоминание менеджеру
- [ ] **Реактивация**: если лид создан > 7 дней назад и статус не изменился → письмо

### 3.3 Cron
- [ ] Создать `app/api/cron/lead-reminders/route.ts`
- [ ] Добавить в `vercel.json`: `"*/60 * * * *": "/api/cron/lead-reminders"`
- [ ] Отправка email через существующий Яндекс SMTP (lib/)
- [ ] Отправка SMS через Telphin (если настроено)

---

## Фаза 4 — Коммерческие предложения (Месяц 2)

### 4.1 База данных
- [ ] Создать миграцию: таблица `lead_proposals`
  - id, session_id, items JSONB, status, pdf_url, viewed_at, token, expires_at
  - status: draft | sent | viewed | accepted | rejected

### 4.2 Генерация КП
- [ ] Создать `app/api/lead-catcher/proposals/route.ts`
  - `POST` → создать КП из wishlist + параметры (скидка, срок, условия)
  - AI генерирует текст введения на основе диалога (GPT-4o-mini)
- [ ] Создать `lib/pdf-generator.ts`
  - Установить `@react-pdf/renderer` или `pdfmake`
  - Шаблон: шапка ЗМК, таблица позиций, итог, подпись
  - Сохранить PDF в Supabase Storage `okk-assets/proposals/{token}.pdf`

### 4.3 Публичная страница КП
- [ ] Создать `app/lead-catcher/proposal/[token]/page.tsx`
  - Красивая страница: логотип, позиции товаров, кнопка "Скачать PDF"
  - При открытии → UPDATE `lead_proposals.viewed_at` + уведомление менеджеру
  - Доступна без авторизации по уникальному токену
- [ ] Кнопки: "Принять КП" → статус accepted + уведомление, "Запросить изменения" → форма

### 4.4 Отправка КП
- [ ] При создании КП → отправить email клиенту с ссылкой
- [ ] Трекинг открытия: при открытии страницы `/proposal/[token]` → фиксируем viewed_at
- [ ] Создать запись в RetailCRM: статус "КП отправлено" + ссылка на КП

---

## Фаза 5 — Счета на оплату (Месяц 2-3)

### 5.1 База данных
- [ ] Создать миграцию: таблица `lead_invoices`
  - id, session_id, proposal_id, amount, items JSONB, status, payment_url, payment_system
  - paid_at, token, invoice_number, pdf_url
  - status: draft | sent | awaiting_payment | paid | cancelled | overdue

### 5.2 Генерация счёта
- [ ] Создать `app/api/lead-catcher/invoices/route.ts`
  - `POST` → создать счёт из КП или вручную
- [ ] Шаблон счёта в PDF (официальный формат: реквизиты, НДС, подпись, печать)

### 5.3 Платёжная интеграция
- [ ] Выбрать платёжную систему: Тинькофф / ЮКасса / СБП
- [ ] `POST /api/lead-catcher/invoices/[id]/pay` → создать платёжную ссылку
- [ ] `POST /api/lead-catcher/invoices/webhook` → вебхук от платёжки
  - Проверить подпись вебхука (!)
  - UPDATE `lead_invoices.status = 'paid'`
  - Уведомление менеджеру (email)
  - Обновить статус в RetailCRM

### 5.4 Публичная страница счёта
- [ ] Создать `app/lead-catcher/invoice/[token]/page.tsx`
  - Детали счёта, кнопка "Оплатить онлайн"
  - Статус оплаты в реальном времени (polling)

---

## Фаза 6 — Аналитика (Месяц 3)

### 6.1 Дашборд
- [ ] Создать `app/lead-catcher/admin/analytics/page.tsx`
- [ ] Метрики:
  - [ ] Лиды за период (день/неделя/месяц)
  - [ ] Конверсия: лид → контакт → КП → оплата
  - [ ] Топ просматриваемых товаров
  - [ ] Топ UTM-источников
  - [ ] Среднее время ответа менеджера
  - [ ] Средний чек КП и счёта

### 6.2 Экспорт
- [ ] Выгрузка лидов в CSV
- [ ] Выгрузка КП в Excel

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
| `app/api/leads/catch/route.ts` | ❌ Создать | API приёма заявок с калькулятора |
| `app/lead-catcher/admin/page.tsx` | ❌ Создать | Панель менеджера |
| `app/lead-catcher/proposal/[token]/page.tsx` | ❌ Создать | Публичная страница КП |
| `app/lead-catcher/invoice/[token]/page.tsx` | ❌ Создать | Страница счёта |
| `app/api/lead-catcher/proposals/route.ts` | ❌ Создать | API для КП |
| `app/api/lead-catcher/invoices/route.ts` | ❌ Создать | API для счётов |
| `app/api/cron/lead-reminders/route.ts` | ❌ Создать | Cron напоминаний |
| `lib/pdf-generator.ts` | ❌ Создать | Генерация PDF |
