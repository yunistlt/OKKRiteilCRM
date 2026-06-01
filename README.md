# OKKRiteilCRM

Вся документация и планы проекта теперь находятся в [docs/INDEX.md](docs/INDEX.md).

— Для навигации и поиска используйте [docs/INDEX.md](docs/INDEX.md)
— Архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
— Глоссарий: [docs/GLOSSARY.md](docs/GLOSSARY.md)

Исходный код и бизнес-логика — в соответствующих папках /app, /lib, /components.

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
