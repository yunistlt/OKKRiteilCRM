# Project Knowledge RAG — «умный Семён»

База знаний по всей методологии проекта. Питает консультанта Семёна на любой странице:
на `/salary` он отвечает про зарплату, на `/reactivation` — про реактивацию и т.д.
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

Вручную после правок документации:

```bash
npm run kb:project-seed     # требует DATABASE_URL и (для качественных эмбеддингов) OPENAI_API_KEY
```

Автоматически при деплое: `postbuild` запускает `scripts/maybe_seed_project_kb.js`, который
сидит базу **только** при `KB_SEED_ON_BUILD=1` и наличии `DATABASE_URL` (иначе мягко пропускает,
чтобы локальный/CI-билд без БД не падал). На Vercel выставить env `KB_SEED_ON_BUILD=1`.

Без `OPENAI_API_KEY` эмбеддинги считаются локальным хеш-фолбэком (`lib/embeddings.ts`) —
сидинг и сборка не падают, но качество поиска ниже; на проде ключ должен быть задан.
