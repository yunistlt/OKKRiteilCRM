# OKKRiteilCRM: Система AI-контроля качества и реактивации

Интеллектуальная надстройка над RetailCRM для автоматизации контроля качества (ОКК) и возврата ушедших B2B-клиентов.

## 🚀 Основные модули

### 1. Контроль качества (Агент Максим)
Система автоматического аудита заказов и звонков.
- **Главный дашборд**: Наглядная таблица всех заказов с чек-листом (ТЗ, ИНН, звонок и т.д.).
- **Движок правил (Rule Engine)**: Гибкая настройка правил проверки (наличие полей, семантический анализ звонков).
- **Система штрафов**: Автоматический расчет рейтинга менеджера на основе выявленных нарушений.
- **Telegram-уведомления**: Мгновенные алерты руководителю о критических ошибках.

### 2. Защита ассортимента (Агент Елена)
Экспертный контроль наличия товара.
- **Верификация отмен**: Проверка реальности причины «Нет таких позиций» через базу знаний и сайт.
- **База знаний**: Автоматическое изучение новых товаров и сбор тех-характеристик.
- **Предотвращение потерь**: Блокировка попыток менеджеров слить заказ на стандартный товар.

### 3. Реактивация B2B (Агент Виктория)
Модуль для оживления «забытых» клиентов и отказников.
- **Сегментация**: Умные фильтры по LTV, среднему чеку, давности заказа и специфике B2B.
- **Персонализация**: ИИ изучает историю клиента и пишет живое, нешаблонное письмо от лица менеджера.
- **Трекинг**: Система внутреннего трекинга прочтений (Tracking Pixel) — вы видите, когда клиент открыл письмо.
- **Анализ ответов**: Классификация входящих писем (Горячий / Отказ) и автоматические ответы или создание заказов.

## 🛠 Технологический стек
- **Frontend**: Next.js 14 (App Router), Tailwind CSS.
- **Backend**: Next.js API Routes, Supabase (PostgreSQL).
- **AI**: OpenAI GPT-4o-mini / GPT-4o.
- **Integrations**: RetailCRM API, Telphin (звонки), Telegram Bot API.

## 🏗 Структура проекта
- `/app/okk` — Главный дашборд контроля качества.
- `/app/admin/reactivation` — Панель управления кампаниями Виктории.
- `/lib/okk-evaluator.ts` — Логика движка правил Максима.
- `/app/api/cron` — Фоновые задачи (синхронизация, воркеры).
- `/app/api/reactivation/track` — Обработка трекинг-пикселя.

## ✅ Quality Gate Консультанта ОКК

Для Семёна в репозитории есть отдельный quality workflow:

- `npm run okk:consultant-real-cases:refresh` — пересобрать anonymized golden fixture из живых данных через `POSTGRES_URL` или `DATABASE_URL`.
- `npm run okk:consultant-real-cases:check` — проверить, что текущий golden fixture не разошёлся с тем, что генерирует актуальный runtime.
- `npm run okk:consultant-regression` — прогнать deterministic benchmark и golden checks по real-case fixture.
- `npm run okk:consultant-quality-gate` — полный обязательный барьер перед изменениями в routing, prompt, catalog, seeding и privacy logic.

Практический цикл такой:

1. При осознанном обновлении живых кейсов сначала запускается refresh.
2. После этого проверяется drift через check.
3. Перед завершением изменений прогоняется общий quality gate.

## ✅ Корпоративный мессенджер: smoke и release

Для корпоративного мессенджера есть отдельный release-контур:

- `npm run messenger:api-smoke` — automated smoke для deployed messenger API.
- [OKK_CORPORATE_MESSENGER_SMOKE_CHECK.md](OKK_CORPORATE_MESSENGER_SMOKE_CHECK.md) — production checklist для браузеров, push и ручных сценариев.
- [OKK_CORPORATE_MESSENGER_RELEASE_RUNBOOK.md](OKK_CORPORATE_MESSENGER_RELEASE_RUNBOOK.md) — практический порядок финального прогона и env.
- [scripts/messenger_api_smoke.env.example](scripts/messenger_api_smoke.env.example) — шаблон env для запуска smoke-скрипта.

---
*Документация по ролям ИИ-команды: [AI_STAFF_ROLES.md](file:///Users/andreiterenkov/Downloads/OKKRiteilCRM-actual/AI_STAFF_ROLES.md)*
