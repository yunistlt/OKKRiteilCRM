# Project Knowledge RAG — «умный Семён»

База знаний по всей методологии проекта. Питает консультанта Семёна на любой странице:
на `/salary` он отвечает про зарплату, на `/okk` — про контроль качества и т.д.
Не путать с `okk_consultant_knowledge` (она материализуется из структурного OKK-каталога) и
с VoC FAQ (`knowledge_base_qa`). Эта база наполняется **из markdown-доков проекта**.

## Как устроено

- **Таблица:** `project_knowledge` (`migrations/20260611_project_knowledge_rag.sql`) —
  pgvector `vector(1536)` + HNSW, поля `audience` (`all` / `staff`), `subsystem`, `source_path`,
  `heading`, `content_hash`. SQL-функция поиска `match_project_knowledge(..., allowed_audiences)`.
- **Поиск/контекст/роли:** `lib/project-knowledge.ts` (`searchProjectKnowledge`,
  `formatProjectKnowledgeContext`, `audiencesForRole`, `formatProjectKnowledgeForEmbedding`).
- **Промпт LLM:** ключ `okk_consultant_global_chat` в `ai_prompts`
  (дефолт — `lib/okk-consultant-ai.ts`).
- **Маршрут:** `app/api/okk/consultant/route.ts` → `buildGlobalKnowledgeAnswer` вызывается в
  глобальной (без выбранного заказа) ветке, когда детерминированного OKK-ответа нет.
  Разбор конкретного заказа в ОКК не затронут.

## Аналитические инструменты (function calling)

Кроме знаний из доков, в глобальной ветке Семён умеет отвечать на **любые числовые вопросы** через
OpenAI function calling. Агрегатор — `lib/consultant-tools.ts` (`buildConsultantTools` /
`executeConsultantTool`). Набор:

**Зарплата** (`lib/salary/consultant-tools.ts`, источник — персистентная `salary_calc`, как на
странице «Моя зарплата»):
- `get_my_salary({ period? })` — итого, оклад, премия, K_качества, K_команды, конверсия, ставки,
  предельная прибавка за заявку, рычаг конв-бонуса.
- `orders_to_reach({ target_total, period? })` — сколько заявок до целевой суммы (частный случай).
- `simulate_salary({ overrides, period? })` — **общий what-if**: пересчитывает ЗП настоящим движком
  (`computeManagerSalary`) под гипотезами `addNew/addPermanent/addPechVto/setConversionPct/
  addDutyShifts/setQualityScore/setTeamRevenueNoVat`. Корректно учитывает пороги и тиры. Так
  закрываются вопросы «если закрою N», «при конверсии X%», «что выгоднее A или B».

**Рейтинг ОКК** (`lib/okk-consultant-rating-tools.ts`, источник — `okk_order_scores`):
- `get_my_rating({ period? })` — средний `total_score`, deal/script %, число заказов, топ
  проваленных критериев. Рейтинг = `AVG(total_score)` (отдельной таблицы нет).
- `how_to_improve_my_rating({ period? })` — ранжированные фиксы по приросту среднего рейтинга
  (критерии равновесные, предельная ценность = `100/(2×проверенных)` deal, `100/(2×17)` script) +
  рычаг штрафов из `okk_violations`.

**Общая арифметика:** `calc({ expression, variables? })` — безопасный парсер (без eval), чтобы LLM
не считал в уме.

Зарплата/рейтинг подключаются при наличии `retail_crm_manager_id`; `calc` — всегда. Всё **только
чтение**, движки ЗП/рейтинга не меняются. **Приватность:** `manager_id` всегда из сессии — чужие
данные получить нельзя. Нет данных/доступа → `available:false`, Семён честно сообщает.
Симуляторы/рейтинг читают `orders`/`okk_order_scores` сервис-ролью (на Vercel —
`SUPABASE_SERVICE_ROLE_KEY`; под анон-ключом RLS их закрывает).
- **Разделы виджета:** лёгкие конфиги (`materializeToKb: false`) в `lib/okk-consultant.ts`
  дают корректный заголовок раздела по URL и подсказку подсистемы для RAG.

## Какие доки попадают в базу

- `docs/**/*.md`, `lib/retailcrm/*.md`, корневой `CLAUDE.md`.
- Исключены: `node_modules`, `.git`, `.next`, `scratch`, `.agent`.
- **Аудитория:** по умолчанию `all` (видят все роли). Внутренняя техничка → `staff`
  (видят только `admin`/`okk`/`rop`): `docs/ARCHITECTURE.md`, `docs/realtime-pipeline/**`,
  `CLAUDE.md`, файлы с `RELEASE`/`RUNBOOK` в имени. Переопределяется frontmatter-ключом
  `audience: staff|all` в самом md-файле.

Чанкинг — по заголовкам H1–H3, крупные секции дробятся по абзацам (≤1800 символов).
Повторный сидинг пропускает неизменённые чанки по `content_hash`; пропавшие — деактивирует.

## Обновление базы

Наполнение — **ручное**, после правок документации:

```bash
npm run kb:project-seed     # требует DATABASE_URL и OPENAI_API_KEY
```

База живёт в Postgres и сохраняется между деплоями, поэтому пересобирать её на каждый деплой
не нужно — достаточно запускать сидер после изменения доков. Скрипт идемпотентный: неизменённые
чанки пропускаются по `content_hash`, пропавшие — деактивируются.

> Авто-сидинг при сборке на Vercel **невозможен**: `scripts/` и `migrations/` исключены в
> `.vercelignore`, т.е. сидер в окружении сборки недоступен. Запускайте `kb:project-seed`
> локально/из CI с доступом к боевому `DATABASE_URL` и `OPENAI_API_KEY`.

Внимание: `kb:project-seed` и поиск в рантайме используют один и тот же `text-embedding-3-small`.
Не запускайте сидер без `OPENAI_API_KEY` (локальный хеш-фолбэк `lib/embeddings.ts` даст векторы,
несовместимые с боевыми запросами, и поиск сломается).
