# Архитектурные принципы OKKRiteilCRM

**Дата:** Май 2026  
**Версия:** 1.0

---

## 1. Принцип: Tenancy-First Design (для SaaS)

При переходе на multi-tenant платформу (Phase 2):

✅ **ПРАВИЛО 1: account_id везде**
- Каждая таблица, связанная с данными аккаунта, имеет FK на `accounts.id`
- Примеры: orders, clients, integrations, audit_events, job_runs
- Исключения: stateless таблицы (roles, permissions, system configs)

✅ **ПРАВИЛО 2: RLS везде**
- Все запросы к Supabase идут с проверкой row-level security
- Policy автоматически фильтрует по `account_id` текущего пользователя
- Невозможно вернуть чужие данные даже через SQL инъекцию

✅ **ПРАВИЛО 3: Tenant context в запросе**
- Middleware извлекает `account_id` из JWT токена
- Каждый Route Handler получает `{userId, accountId}` в контексте
- API автоматически фильтрует по accountId

---

## 2. Принцип: Event-Driven Architecture (Real-time Pipeline)

Критичные контуры (RetailCRM sync, Telphin calls, transcription) используют event-driven модель:

✅ **ПРАВИЛО 1: Webhook-first**
- Основной путь получения событий — вебхук (recording_ready, call_end, order_changed)
- Fallback poller служит только страховкой для пропущенных событий

✅ **ПРАВИЛО 2: Job queue для обработки**
- Каждое событие создаёт job в очереди (не выполняется синхронно в webhook)
- Worker процессы забирают job, обрабатывают с retries и обновляют статус
- Idempotency ключи предотвращают дубли при повторных событиях

✅ **ПРАВИЛО 3: Single source of truth**
- Для каждого доменного объекта есть одна каноническая таблица
- raw_telphin_calls — для звонков, orders — для заказов, raw_order_events — для история
- Legacy/compatibility таблицы читаются только для fallback, не пишутся напрямую

✅ **ПРАВИЛО 4: Graceful degradation**
- При недоступности внешнего API (OpenAI, RetailCRM) события сохраняются в бэклог
- Downstream обработка (scoring, insights) деградирует, но не падает
- Нет каскадных отказов между независимыми компонентами

---

## 3. Принцип: AI Agent Specialization

Каждый ИИ-агент специализируется на одной задаче и не берёт соседние:

✅ **ПРАВИЛО 1: Разделение ответственности**
- Анна → анализ фактов заказа (без судебных решений)
- Максим → применение правил и подсчёт штрафов
- Игорь → мониторинг SLA и приоритеты (чистая логика, без AI)
- Семён → синхронизация и Lead Catching
- Елена → консультирование и сбор контактов
- Виктория (4 роли) → реактивация клиентов

✅ **ПРАВИЛО 2: Чёткие интерфейсы**
- Каждый агент читает из одной таблицы (input)
- Пишет в одну таблицу или очередь (output)
- Передачи между агентами через таблицы, не через синхронные вызовы

✅ **ПРАВИЛО 3: Quality gates**
- Каждый агент имеет set регрессионных тестов (golden fixtures)
- Hallucination detection (факты проверяются по справочникам)
- Output validation перед передачей следующему агенту

---

## 4. Принцип: Data Isolation & Security

✅ **ПРАВИЛО 1: Encrypted credentials**
- API ключи интеграций хранятся в encrypted JSONB в БД, не в env переменных
- Каждый аккаунт имеет свои ключи
- Смена ключа — UPDATE в БД, без redeploy

✅ **ПРАВИЛО 2: Role-based sanitization**
- Дарья (Legal helpdesk) не раскрывает внутренние лимиты и согласования правила
- Борис (Due diligence) показывает full breakdown только legal/supervisor
- Разные пользователи видят разные fields одного и того же заказа

✅ **ПРАВИЛО 3: Audit trail**
- Все критичные действия (create user, update integration, delete report) логируются
- Audit включает: кто, что, когда, старые значения, новые значения
- No delete-only, все — soft delete с timestamp

---

## 5. Принцип: Progressive Enhancement & Backwards Compatibility

При крупных рефакторах:

✅ **ПРАВИЛО 1: Feature flags**
- Новая логика по умолчанию отключена
- Разрешает перевести её в shadow-mode на долю трафика
- Затем постепенно увеличивать долю

✅ **ПРАВИЛО 2: Legacy compatibility layer**
- Старые пути (legacy cron, legacy tables) продолжают работать до migration window
- Новый path пишет в canonical table, старый пишет в legacy за флагом
- После стабилизации флаг выключается, legacy удаляется миграцией

✅ **ПРАВИЛО 3: No breaking migrations**
- Миграции добавляют новые поля (NOT NULL со значением по умолчанию)
- Старые query-ы продолжают работать с новыми полями
- Deployment не требует синхронизации версий

---

## 6. Принцип: Observable Systems

Каждый критичный компонент должен быть наблюдаемым:

✅ **ПРАВИЛО 1: Structured logging**
- Все события логируются в JSON формате (не plain text)
- Включены: timestamp, level, component, action, error, context
- Логи индексируются для быстрого поиска

✅ **ПРАВИЛО 2: Metrics & SLA tracking**
- Для каждого критичного пути есть SLA (lag, throughput, error rate)
- Metrics хранятся в `sync_state` таблице для долгосрочного tracking
- Dashboard показывает p50/p95 latency и hotspot-очередь

✅ **ПРАВИЛО 3: Actionable alerts**
- Telegram alerts только при превышении SLA, не за каждый event
- Каждый alert содержит: что случилось, когда, вероятная причина, как исправить
- De-duplication alerts по типу проблемы за 15-минутное окно

---

## 7. Принцип: Type Safety Everywhere

✅ **ПРАВИЛО 1: TypeScript для всего**
- Backend, frontend, API contracts, migrations — всё типизировано
- Zod для runtime validation API requests
- @supabase/supabase-js для type-safe DB queries

✅ **ПРАВИЛО 2: Strict mode**
- `strict: true` в tsconfig.json
- `noImplicitAny: true`
- `noUnusedLocals: true`, `noUnusedParameters: true`

✅ **ПРАВИЛО 3: Contract testing**
- API responses проверяются через Zod schemas
- Клиент и сервер используют одни и те же types для DTO
- Breaking API changes ловятся на тестах

---

## 8. Принцип: No God Functions

Каждая функция должна быть понятной за 5 минут:

✅ **ПРАВИЛО 1: Single responsibility**
- Функция делает одно
- Если есть несколько ветвей логики → выделить helper'ы

✅ **ПРАВИЛО 2: Pure functions where possible**
- Входы → выходы, без side effects
- Side effects (write DB, call API) выполняются в отдельном слое

✅ **ПРАВИЛО 3: Explicit error handling**
- Нет silent failures
- Исключения либо обрабатываются, либо пробрасываются с контекстом
- `try/catch` не ловит и не забивает ошибки

---

## 9. Принцип: Infrastructure as Code

✅ **ПРАВИЛО 1: Все в git**
- SQL миграции в `migrations/`
- Database seed'ы в `seeds/`
- Infrastructure configs в корне проекта

✅ **ПРАВИЛО 2: Воспроизводимые окружения**
- `.env.example` описывает все нужные переменные
- Новый разработчик может развернуть project локально
- Staging и production отличаются только переменными окружения

✅ **ПРАВИЛО 3: Documentation as code**
- README.md на английском / русском (в зависимости от целевой аудитории)
- Доки хранятся в `docs/` рядом с кодом
- Большие планы хранятся как markdown в архиве проекта (не в отдельных файлах)

---

## 10. Матрица ответственности по модулям

| Модуль | Владелец | SLA | Критичность |
|--------|----------|-----|-------------|
| **ОКК Консультант** | Team OKK | 1-2 min lag | 🔴 CRITICAL |
| **Legal AI** | Team Legal | 4 sprints | 🟡 HIGH |
| **Messenger** | Team Messenger | 92% ready | 🟡 HIGH |
| **Lead Catcher** | Team Sales | Live | 🟢 MEDIUM |
| **Real-time Pipeline** | Team Infra | < 2 min SLA | 🔴 CRITICAL |
| **Transcription** | Team Infra | p95 < 5 min | 🟡 HIGH |
| **Reactivation** | Team Growth | Async | 🟢 MEDIUM |
| **Knowledge Base** | Team KM | Async | 🟢 MEDIUM |

| **AI Team** | Admin | Source of truth | 📚 REFERENCE |

---

## Дополнительные ссылки

- [INDEX.md](INDEX.md) — главная навигация по всем модулям
- [GLOSSARY.md](GLOSSARY.md) — терминология проекта
- `/docs/*/README.md` — описание каждого модуля
