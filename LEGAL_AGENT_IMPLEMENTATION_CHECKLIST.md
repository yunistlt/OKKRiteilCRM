# План реализации модуля «ИИ-Юрисконсульт» (Агент Лев, legacy agent_type = 'alexander')

- [ ] **Спринт 1: Инфраструктура и Due Diligence**
  - [x] Создать миграцию для таблиц:
    - [x] legal_counterparties_cache (TTL для кэша)
    - [x] legal_contract_reviews (audit trail: оригинал и анализ)
    - [x] legal_consultant_threads / legal_consultant_messages (agent_type = 'alexander')
  - [x] Обновить RLS и RBAC:
    - [x] Добавить роль `legal` (или расширить granular permissions)
    - [x] Политики доступа для contract_reviews (can_access_order, has_full_order_access)
  - [x] Интеграция с API проверки контрагентов (Dadata/FNS/Rusprofile)
  - [x] Логирование параметров и инициаторов проверок
  - [x] Вывод светофора рисков в карточке заказа

- [ ] **Спринт 2: Внутренний Legal-Helpdesk**
  - [x] UI-панель чата для МОПов (боковая панель)
  - [x] Дашборд /app/legal для юристов
  - [x] Сидинг базы знаний (правила, инструкции, NDA, возвраты)
  - [x] Версионирование и обновление KB (миграции + seed script)
  - [x] Intent Routing (описать fallback-логику)
  - [x] Настройка RAG (structured catalog + knowledge layer)
  - [x] Role-based sanitization контекста
  - [x] Fallback UI для ошибок AI/интеграций
  - [x] Быстрый переход к созданию задачи для юриста

- [ ] **Спринт 3: Договорная работа (MVP)**
  - [x] Загрузка файлов (Supabase Storage, антивирусная проверка, ограничения типов/размеров)
    - [x] Signed upload foundation + ограничения типов/размеров
    - [x] Интеграция с антивирусной проверкой (mock foundation)
  - [x] Экстракция текста (OCR + AI, fallback на ручную валидацию)
    - [x] Автоизвлечение для PDF/DOCX/TXT
    - [x] Fallback на ручную валидацию для неподдерживаемых/плохих файлов
    - [x] OCR для сканов и image-based PDF
  - [x] Хранение оригинала и версий после анализа
  - [x] Реализация legal-evaluator.ts (правила: суммы, штрафы, подсудность)
  - [x] Подсветка проблемных пунктов, предложения для протокола разногласий
  - [x] Асинхронность анализа contract/analyze
    - [x] Синхронный analyze route foundation
    - [x] Background job / очередь анализа

- [ ] **Спринт 4: Quality Gate и Релиз**
  - [x] Golden Fixtures: scripts/legal_agent_real_cases.fixture.json (20-30 кейсов)
  - [x] Regression Suite: npm run legal:regression (интеграция с CI/CD)
  - [ ] Проверка:
    - [x] Factual grounding (нет выдуманных законов/штрафов)
    - [x] Privacy / RBAC (нет утечек секретных данных)
    - [x] Boundary Policy (ИИ отвечает "Не знаю" вне RAG)
  - [x] Документация API (Swagger) и схем БД (dbdocs)
  - [x] Добавление Legal-модуля в release runbook

---

**P.S.**
- [x] Проработать механизм обновления базы знаний и версионирования
  - [x] Логировать все критичные действия (audit trail)
  - [x] Предусмотреть расширяемость ролей и granular permissions
  - [x] Описать структуру входных данных для API (contract/analyze, chat)
- [x] Предусмотреть fallback для AI/интеграций и ручную эскалацию
