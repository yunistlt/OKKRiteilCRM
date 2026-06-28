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

Migrations are raw SQL in `migrations/` (123+ files, date-prefixed). There is no migration runner framework — `scripts/migrate.js` / `scripts/apply-migration.js` execute a hardcoded file via `postgres`-js against `DATABASE_URL` from `.env.local`. To apply a new migration, point one of those scripts at it or run the SQL directly. Migrations must be additive/backwards-compatible (new columns with defaults, no breaking changes).

## Architecture

### Request flow & auth
- `middleware.ts` gates every route. Public prefixes (`/login`, `/api/auth`, `/api/cron`, `/api/sync`, `/api/matching`, `/api/monitoring`, `/api/widget`) bypass auth; everything else requires a session.
- Auth is JWT-based via `jose` (`lib/auth.ts`), supporting two sources: Supabase tokens (`sb-access-token`) and a legacy `auth_session` cookie. Roles: `admin | okk | rop | manager | demo`.
- RBAC is a route-prefix → allowed-roles table in `lib/rbac.ts` (`DEFAULT_ROUTE_RULES`). `lib/rbac-server.ts` resolves it server-side (rules can be overridden in DB). When adding a page or API route, add a matching `RouteRule` or it inherits the longest-prefix match.

### Database access
- **Server code uses the service-role client** exported from `utils/supabase.ts` as `supabase` (a lazy Proxy) — this bypasses RLS. There is no generated typed client in active use; queries are largely untyped. Other clients: `utils/supabase-admin.ts`, `utils/supabase-user.ts`, `utils/supabase-browser.ts` / `lib/supabase-browser.ts` (browser).
- `OPENAI_API_KEY` access goes through `utils/openai.ts` (`getOpenAIClient`, `isOpenAIConfigured`). AI work degrades gracefully when unconfigured rather than crashing.

### Event-driven pipeline (the core of the system)
External events (RetailCRM order changes, Telphin call/recording webhooks) are **not** processed synchronously. They enqueue jobs into a Postgres-backed queue, and **Vercel cron** invokes worker routes that claim and process them. This is the central pattern — understand it before touching sync/analysis.

- **Job queue**: `lib/system-jobs.ts` defines `SystemJobType`, `enqueueSystemJob`, `claimSystemJobs`, `completeSystemJob`, `failSystemJob`, idempotency keys, retry/backoff, concurrency keys, and dead-lettering.
- **Worker routes**: `app/api/cron/system-jobs/<job>/route.ts`. Each is a `GET` handler (`export const dynamic = 'force-dynamic'`, `maxDuration = 300`), checks `CRON_SECRET` via `Authorization: Bearer`, gates on a runtime feature flag (`isSystemJobsPipelineRuntimeEnabled`), claims a small batch with a concurrency cap, and records success/failure via `lib/system-worker-state.ts`.
- **Schedules**: `vercel.json` `crons` — most run every 1–2 minutes (order delta/upsert, call match, transcription, semantic rules, score refresh), plus nightly reconciliation, watchdog (every 5 min), system audit (every 4h).
- **Principles** (`docs/ARCHITECTURE.md`): webhook-first with poller fallback; each domain object has one canonical table (`orders`, `raw_telphin_calls`, `raw_order_events`) — legacy tables are read-only fallbacks; idempotency everywhere; graceful degradation when OpenAI/RetailCRM are down.

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
- **Salary ОП ("Зарплата")** — `lib/salary/`, `app/salary`, `app/api/salary/*`. Composable bonus-block engine (per-manager schemes/roles), effective-dated, zero-hardcode. **Read `docs/salary/OVERVIEW.md` (as-built canonical guide) before changing anything.** UI follows `golds/`.

### Conventions
- TypeScript strict mode is on (`noUnusedLocals`, `noUnusedParameters`). Import alias `@/*` maps to repo root.
- Zod for runtime validation of API inputs.
- `app/actions/` holds Next.js server actions; `app/api/` holds route handlers.
- `scripts/` (excluded from tsconfig) are operational `tsx` scripts — seeding, backfills, regression harnesses, one-off DB ops. `scratch/` is throwaway.
- Structured JSON logging; Telegram alerts (`lib/telegram.ts`) only fire on SLA breach, de-duplicated.

## Docs

`docs/INDEX.md` is the documentation map; `docs/ARCHITECTURE.md` has the full architectural principles; `docs/GLOSSARY.md` defines domain terms. Per-subsystem docs live under `docs/<subsystem>/`.
