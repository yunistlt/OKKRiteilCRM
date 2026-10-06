# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OKKRiteilCRM — a Next.js 14 (App Router) CRM/quality-control platform for a Russian retail business. It ingests data from **RetailCRM** (orders) and **Telphin** (phone calls), transcribes and analyzes calls, scores order/manager quality against configurable rules, and runs a fleet of specialized AI agents (each with a Russian persona/name) on top of that data. Deployed on **Vercel**; data lives in **Supabase (Postgres)**.

**Language policy (hard rule):** All user-facing text, AI-generated reasons, rule names, and explanations MUST be in **Russian**. Internal logic, slugs, filtering, and data comparisons use technical codes only. Never hardcode Russian display strings or status lists in logic — fetch mappings dynamically from the DB. See `.agent/workflows/constraints.md`.

## Commands

```bash
npm run dev            # local dev server (next dev)
npm run build          # production build (also the type-check gate — there is no separate tsc script)
npm run lint           # next lint (eslint)
npm run test           # vitest run (tests live in tests/, *.test.ts)
npm run test:watch     # vitest watch
npx vitest run tests/rate-limit.test.ts   # run a single test file
```

Domain-specific quality gates (run before changing the named subsystems):
```bash
npm run okk:consultant-quality-gate    # MANDATORY before changing OKK consultant routing/prompt/catalog/seeding/privacy
npm run okk:consultant-regression      # deterministic benchmark + golden checks
npm run okk:consultant-real-cases:refresh   # rebuild anonymized golden fixture from live DB (POSTGRES_URL/DATABASE_URL)
npm run legal:regression               # legal agents regression
npm run messenger:api-smoke            # smoke test against deployed messenger API
```

**Выкатка (решение владельца 02.10.2026): прод — ветка `main`, Vercel деплоит push в неё.** Правка, сделанная по заданию, не считается сделанной, пока лежит в feat-ветке: люди работают на `main`. Довожу до прода сам — `git push origin <ветка>:main` (перемотка, когда ветка идёт поверх main) — и называю владельцу короткий хеш сборки, он сверяет его под логотипом ОКК. Инцидент 02.10.2026: шесть фиксов пролежали день в `feat/own-crm-core`, менеджер работал на вчерашней сборке и повторно жаловался на уже исправленное.

**ЗАКОН (решение владельца 02.10.2026): ничего не выдумываем от себя.** Делаем ровно то, что сказал владелец. Кнопки, поля, экраны, «удобные» механики, которых не просили, не появляются. Появилась идея — сначала предложение словами («хочу сделать то-то, потому что то-то») и согласование, и только потом код. Инцидент: самодельная кнопка «Подставить в заказ» в реквизитах заказа.

**ЗАКОН (решение владельца 06.10.2026): ОДИН ИСТОЧНИК ПРАВДЫ.** У каждого значения ровно одно место хранения. Нужны те же данные в другом месте — берём их ИЗ источника, а не держим копию. Логи, даты, смены, параметры — храним, это не копии, а история.

Повод — инцидент 06.10.2026, стоивший менеджерам рабочего дня. Статус заказа хранился в двух местах: колонка `orders.status` и копия в `raw_payload.status`. Колонку обновляет наше приложение, копию — перенос из RetailCRM; перенос отключили, и они разъехались у 17 заказов. Я решил, что права копия, проверил догадку на двух заказах из семнадцати и выровнял все — заказы, переданные в производство, вернулись в «Счёт на оплате» (жалобы Евгении Матвеевой и Елены Парфёновой: 54932, 54131, 53666, 54691, 54836).

Отсюда два следствия, оба обязательны:
1. **Пока у значения два места хранения, выравнивать их автоматически НЕЛЬЗЯ** — любое направление затирает чью-то правду. Сначала убрать второе место, потом синхронизировать.
2. **Массовая правка боевых данных — только после поштучной сверки.** Показать «было → станет» по КАЖДОЙ строке с обоснованием из независимого источника (история, RetailCRM), и лишь потом выполнять. Семнадцать строк — это не «массово», это семнадцать проверок. Если защита от массовой правки сработала — это повод проверять дальше, а НЕ искать обход и не передавать команду владельцу на выполнение.

Статус заказа: единственный источник — колонка `orders.status`. `status_since`, `statusUpdatedAt`, `statusComment` — не дубли, а история и параметры, их держим.

**ЗАКОН (решение владельца 04.10.2026): ни одного заказа без активного менеджера.** У каждого заказа есть хозяин из работающих сейчас людей — «ничьих» заказов и заказов на уволенных быть не должно: их никто не ведёт, они не попадают ни в план дня, ни в оценки, ни в зарплату. При раздаче **смотрим, за кем закреплён клиент заказа**: все заказы одного контрагента идут одному менеджеру, а если у клиента уже есть заказы у кого-то из команды — туда же. Иначе постоянный клиент достанется чужому менеджеру, а в зарплате будет считаться новым. Распределение — клиентами, не отдельными заказами; выравнивание по числу заказов делается между клиентами.

**ЗАКОН (решение владельца 02.10.2026): номер заказа — всегда ссылка в карточку заказа.** Везде, где номер показан человеку (списки звонков и писем, планы дня, отчёты, модалки, уведомления, юридические документы), он кликабельный и ведёт на `/orders?order=<НОМЕР>`. Только через `components/ui/OrderNumberLink.tsx` — свой `<a>` под это не писать. Подробности в `golds/GOLD_UI_TABLES.md` §8.

**ЗАКОН (решение владельца 02.10.2026): ничего не создаём, не проверив, что такого уже нет.** Таблица, колонка, поле, функция, эндпоинт, настройка — сначала поиск, потом решение: `select table_name from information_schema.tables where table_name ilike '%тема%'`, `select column_name from information_schema.columns where table_name='...'`, `select proname from pg_proc where proname ilike '%...%'`, плюс `grep` по `migrations/` и `lib/`. И отдельно — **кто ещё пишет в эту таблицу**: `upsert_clients` / `upsert_orders_v2` / триггеры колонок могут затирать новые поля пустотой из RetailCRM (тогда правь их тем же изменением, через `COALESCE(NULLIF(новое,''), своё)`). Дополнить существующее всегда лучше, чем завести рядом ещё одно (инцидент: таблица `client_requisites` при живых колонках реквизитов в `clients`).

Migrations are raw SQL in `migrations/` (341 files as of 2026-10-01, date-prefixed). There is no migration runner framework — `scripts/migrate.js` / `scripts/apply-migration.js` execute a hardcoded file via `postgres`-js against `DATABASE_URL` from `.env.local`. To apply a new migration, point one of those scripts at it or run the SQL directly. Migrations must be additive/backwards-compatible (new columns with defaults, no breaking changes).

## Architecture

### Request flow & auth
- `middleware.ts` gates every route. Public prefixes (`/login`, `/api/auth`, `/api/cron`, `/api/sync`, `/api/matching`, `/api/monitoring`, `/api/widget`) plus the PWA files `/messenger-sw.js` and `/manifest.webmanifest` bypass auth (the service worker MUST stay public — behind auth the browser's background update request gets redirected to login and the UI stays frozen on cached code); everything else requires a session.
- Auth is JWT-based via `jose` (`lib/auth.ts`), supporting two sources: Supabase tokens (`sb-access-token`) and a legacy `auth_session` cookie. Roles: `admin | okk | rop | manager | jurist | demo` (`AppRole` in `lib/auth.ts`). **Passwords are currently stored in plain text** — `verifyPassword` compares strings despite the `password_hash` column name; known debt, task `P-5` in `docs/own-crm/ROADMAP.md`.
- RBAC is a route-prefix → allowed-roles table in `lib/rbac.ts` (`DEFAULT_ROUTE_RULES`). `lib/rbac-server.ts` resolves it server-side (rules can be overridden in DB). When adding a page or API route, add a matching `RouteRule` or it inherits the longest-prefix match — `tests/rbac-coverage.test.ts` enforces this (page↔API role parity + a baseline of legacy uncovered routes; new routes must get their own rule).

### Database access
- **Server code uses the service-role client** exported from `utils/supabase.ts` as `supabase` (a lazy Proxy) — this bypasses RLS. There is no generated typed client in active use; queries are largely untyped. Other clients: `utils/supabase-admin.ts`, `utils/supabase-user.ts`, `utils/supabase-browser.ts` / `lib/supabase-browser.ts` (browser).
- `OPENAI_API_KEY` access goes through `utils/openai.ts` (`getOpenAIClient`, `isOpenAIConfigured`). AI work degrades gracefully when unconfigured rather than crashing.

### Event-driven pipeline (the core of the system)
External events (RetailCRM order changes, Telphin call/recording webhooks) are **not** processed synchronously. They enqueue jobs into a Postgres-backed queue, and **Vercel cron** invokes worker routes that claim and process them. This is the central pattern — understand it before touching sync/analysis.

- **Job queue**: `lib/system-jobs.ts` defines `SystemJobType`, `enqueueSystemJob`, `claimSystemJobs`, `completeSystemJob`, `failSystemJob`, idempotency keys, retry/backoff, concurrency keys, and dead-lettering.
- **Worker routes**: `app/api/cron/system-jobs/<job>/route.ts`. Each is a `GET` handler (`export const dynamic = 'force-dynamic'`, `maxDuration = 300`), checks `CRON_SECRET` via `Authorization: Bearer`, gates on a runtime feature flag (`isSystemJobsPipelineRuntimeEnabled`), claims a small batch with a concurrency cap, and records success/failure via `lib/system-worker-state.ts`.
- **Schedules**: `vercel.json` `crons` — most run every 1–2 minutes (order delta/upsert, call match, transcription, semantic rules, score refresh), plus nightly reconciliation, watchdog (every 5 min), system audit (every 4h).
- **Principles** (`docs/ARCHITECTURE.md`): webhook-first with poller fallback; each domain object has one canonical table (`orders`, `raw_telphin_calls`, `raw_order_events`) — legacy tables are read-only fallbacks. **Calls are mid-migration:** the owner's rule is that `retailcrm_calls` (order number straight from RetailCRM) is the source of truth and our matching (`call_order_matches`, ~29% wrong) is only a fallback; OKK and transcription still read `raw_telphin_calls` — task `C-3`; idempotency everywhere; graceful degradation when OpenAI/RetailCRM are down.

### AI agents
Each agent is a specialized module that reads from one table and writes to one table/queue — they hand off via tables, not synchronous calls. The personas (Семён/OKK consultant, Анна/order facts, Максим/rules & penalties, Игорь/SLA, Елена/lead catcher, plus the Legal team Лев/Дарья/Борис/Григорий) are the **source of truth** documented in `docs/ai-team/STAFF_ROLES.md`. Read it before modifying agent logic.

Major subsystems (each is a cluster of `lib/*.ts` + `app/api/*` + `app/<feature>` + `docs/<feature>`):
- **OKK Consultant ("Семён")** — `lib/okk-consultant*.ts`, `lib/okk-evaluator.ts`. Most safety-critical; has a strict quality gate and golden fixtures. Chats are global and isolated from order context.
- **Rules & quality** — `lib/rule-engine*.ts`, `lib/quality-control.ts`, `lib/violations.ts`, `lib/prioritization.ts`, `lib/semantic.ts`.
- **RetailCRM sync** — `lib/retailcrm/`, `lib/sync/`. **API v5 constraint:** `limit` param MUST be exactly `20`, `50`, or `100` — other values give 400. **Единый справочник интеграции (эндпоинты, имена env-ключей/полей/таблиц, коды справочников RetailCRM) — `lib/retailcrm/` (`README.md` / `API.md` / `NAMING.md`); сверяйся с ним, а не ищи заново.**
- **Telphin calls & transcription** — `lib/telphin*.ts`, `lib/call-matching.ts`, `lib/transcribe.ts` / `lib/transcription.ts`.
- **Legal AI** — `lib/legal-*.ts` (consultant, contract analysis, OCR, antivirus, counterparty check).
- **Lead Catcher ("Елена")** — `app/api/lead-catcher/*`, `app/lead-catcher`, embeddable widget (`/api/widget`).
- **Corporate Messenger** — `lib/messenger/`, `app/messenger`. Has web-push and a separate release runbook.
- **Своя CRM (own-crm)** — `lib/own-crm/`, `app/orders`, `app/clients`, `migrations/2026092*`/`2026100*`. The strategic track: RetailCRM is a temporary source, order/client fields now live in `orders`/`clients` columns named exactly as RetailCRM names them (126 columns in `orders`), filled by triggers `orders_fill_retailcrm_columns` / `order_items_sync`. `orders.is_own` + `managers.own_crm` mark orders that live only here. **Read `docs/own-crm/OVERVIEW.md` (as-built) and `docs/own-crm/ROADMAP.md` (numbered tasks Z/K/T/M/C/A/P) before touching orders, clients or sync.**
- **Salary ОП ("Зарплата")** — `lib/salary/`, `app/salary`, `app/api/salary/*`. Composable bonus-block engine (per-manager schemes/roles), effective-dated, zero-hardcode. **Read `docs/salary/OVERVIEW.md` (as-built canonical guide) before changing anything.** UI follows `golds/`.

### Conventions
- TypeScript strict mode is on (`noUnusedLocals`, `noUnusedParameters`). Import alias `@/*` maps to repo root.
- Zod for runtime validation of API inputs.
- `app/actions/` holds Next.js server actions; `app/api/` holds route handlers.
- `scripts/` (excluded from tsconfig) are operational `tsx` scripts — seeding, backfills, regression harnesses, one-off DB ops. `scratch/` is throwaway.
- Structured JSON logging; Telegram alerts (`lib/telegram.ts`) only fire on SLA breach, de-duplicated.

## Docs

`docs/INDEX.md` is the documentation map; `docs/ARCHITECTURE.md` has the full architectural principles; `docs/GLOSSARY.md` defines domain terms. Per-subsystem docs live under `docs/<subsystem>/`.
