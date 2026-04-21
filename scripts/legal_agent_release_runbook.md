# Legal-модуль: release runbook

## 1. Что уже закрыто кодом

- Все миграции и схемы для contract_reviews, review_versions, audit_log применены.
- Антивирус, OCR, анализ и подсветка рисков работают через API и UI.
- Golden fixtures и regression suite реализованы (npm run legal:regression).
- RBAC, granular permissions, audit trail реализованы.
- Документация API (Swagger) и схем БД (dbdocs) подготовлены.

## 2. Что ещё нельзя закрыть локально без deployed environment

- Проверка production RBAC и privacy на реальных данных.
- Проверка boundary policy (ИИ не отвечает вне RAG).
- Проверка production audit trail и логирования.
- Проверка интеграции с внешними AI/LLM сервисами (OpenAI, fallback).

## 3. Минимальные переменные для smoke

- SUPABASE_URL, SUPABASE_KEY
- OPENAI_API_KEY (если требуется)
- LEGAL_CONTRACT_BUCKET

## 4. Рекомендуемый порядок финального прогона

1. Применить все миграции к Supabase.
2. Убедиться, что в Vercel выставлены все env.
3. Запушить актуальную ветку в GitHub.
4. Дождаться deploy в Vercel.
5. Заполнить env.
6. Запустить `npm run legal:regression`.
7. Пройти ручной smoke по UI (upload, анализ, история версий, KB, чат).

## 5. Команда запуска

```bash
npm run legal:regression
```
