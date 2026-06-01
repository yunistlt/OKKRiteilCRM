# План реализации модуля «ИИ-Юрисконсульт» (Агент Лев)

- [ ] **Спринт 1: Инфраструктура и Due Diligence**
  - [x] Создать миграцию для таблиц legal_counterparties_cache, legal_contract_reviews, legal_consultant_threads
  - [x] Обновить RLS и RBAC с ролью legal
  - [x] Интеграция с API проверки контрагентов (Dadata/FNS/Rusprofile)
  - [x] Вывод светофора рисков в карточке заказа

- [ ] **Спринт 2: Внутренний Legal-Helpdesk**
  - [x] UI-панель чата для МОПов
  - [x] Дашборд /app/legal для юристов
  - [x] Сидинг базы знаний
  - [x] Версионирование и обновление KB
  - [x] Intent Routing и RAG
  - [x] Role-based sanitization контекста

- [ ] **Спринт 3: Договорная работа (MVP)**
  - [x] Загрузка файлов (Supabase Storage, антивирус)
  - [x] Экстракция текста (OCR + AI)
  - [x] Хранение оригинала и версий
  - [x] Реализация legal-evaluator.ts (правила)
  - [x] Асинхронность анализа contract/analyze

- [ ] **Спринт 4: Quality Gate и Релиз**
  - [x] Golden Fixtures (20-30 кейсов)
  - [x] Regression Suite
  - [ ] Финальные проверки quality gates

(Full 4-sprint checklist in archive)
