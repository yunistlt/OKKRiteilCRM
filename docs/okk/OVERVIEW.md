# ОКК (Контроль качества) — as-built OVERVIEW

Канонический handoff-док подсистемы. Читать ПЕРВЫМ в новом чате, до кода.
Смежные доки: `docs/okk-consultant/` (Семён-чат), `docs/transcription/` (STT), `docs/realtime-pipeline/` (очередь джоб), `docs/salary/OVERVIEW.md` (потребитель баллов).

## 0. Что это

Раздел `/okk` — таблица «Контроль качества»: каждая строка = заказ RetailCRM, колонки = критерии
(SLA, заполнение полей, звонки, скрипт продаж). Итог по заказу — проценты в `okk_order_scores`,
из которых считается ЗП отдела продаж и рейтинг менеджеров.

**Две независимые системы правил** (не путать):
| | `okk_rules` | `okk_criteria` |
|---|---|---|
| Что | нарушения и штрафные баллы | критерии качества (колонки таблицы `/okk`) |
| UI | `/settings/rules` | `/okk/criteria` |
| Движок | `lib/rule-engine.ts` | `lib/okk-evaluator.ts` |
| Итог | строки в `okk_violations` (`points`) | поля и `score_breakdown` в `okk_order_scores` |

Связь односторонняя: сумма `points` нарушений заказа вычитается из итогового `total_score`.

## 1. Поток данных (сверху вниз)

```
Telphin ──► /api/sync/telphin (2 мин) ──► raw_telphin_calls
                                             │
RetailCRM ─► retailcrm-order-delta/upsert ─► orders, raw_order_events, order_history_log
                                             │
                    system-jobs/call-match ──► call_order_matches (звонок ↔ заказ)
                                             │
                    system-jobs/transcription ──► STT submit
                    system-jobs/transcription-poll ──► транскрипт готов
                                             │
                    lib/transcription-downstream.ts ставит 3 джобы:
                      ├─ call-semantic-rules   → rule-engine (semantic) → okk_violations
                      ├─ order_score_refresh   → evaluateOrder()        → okk_order_scores
                      └─ order_insight_refresh → Анна (инсайты)
```
Плюс кроны: `rule-engine` каждые 5 мин (sql-правила), `score-refresh` каждую минуту (точечно),
полный прогон `/api/okk/run-all` ночью в 04:15.

## 2. Транскрибация

Код: `lib/transcribe.ts`, `lib/transcription.ts`, воркеры `app/api/cron/system-jobs/transcription*`.

1. `isTranscribable(call)` — гейт по длительности (порог из БД, `getTranscriptionMinDuration`).
2. `submitCallTranscription` → self-hosted STT (`STT_URL`, контракт `POST /transcribe`), режим pull/push:
   `isSelfHostedSttConfigured()` / `isSttPullMode()`. Фолбэк — OpenAI.
3. `transcription-poll` → `pollSubmittedTranscription`, готовый текст → `finalizeTranscript`
   (моно, роли расставляет `diarizeTranscript` через GPT) или `finalizeTranscriptFromChannels`
   (стерео: роли по каналам — надёжнее, см. `docs/transcription/STT_STEREO_ROLES.md`).
4. `markCallTranscriptionSkipped(callId, reason)` — короткие/битые записи, чтобы не висели в очереди.
5. Watchdog: `/api/cron/stt-watchdog` + `system-jobs/watchdog` (застрявшие в processing, retry/dead-letter).

Известная проблема: путаница ролей Менеджер/Клиент на моно-записях + бэклог pending/expired/failed.

## 3. Правила нарушений (`okk_rules` → `okk_violations`)

Создание — конструктором в `app/settings/rules/` (`new-rule-modal.tsx`, `rule-block-editor.tsx`,
`checklist-editor.tsx`). Правило = JSON `logic: { trigger, conditions[] }`, плюс `severity`,
`points` (штраф), `notify_telegram`, таргетинг по ролям (группы менеджера из CRM).

Блоки (`matchBlock`, `lib/rule-engine.ts:541`):
- `status_change` (`target_status`, `direction: to|from`)
- `field_change` (`field_code`)
- `field_empty` (`field_path`)
- `time_elapsed` (`hours`)
- `call_exists`, `new_call_transcribed`

Спец-условия (обрабатываются отдельно в `runRuleEngine`):
- `no_new_comments` — активность после события
- `semantic_check` — ИИ-проверка транскрипта/текста
- `reschedule_policy_check` — политика переносов

Типы: `rule_type = 'sql'` (детерминированно) | `'semantic'` (`semantic_prompt` → `lib/semantic.ts`,
gpt-4o-mini, JSON `{is_violation, evidence, confidence, reasoning, insufficient_data}`).
`insufficient_data = true` → нарушение НЕ фиксируется (не штрафуем за отсутствие данных).
Чек-лист-режим правила — `evaluateChecklist` / `evaluateStageChecklist` (`lib/quality-control.ts`).

Идемпотентность — уникальные ключи в `okk_violations` (`rule_code+call_id`, `rule_code+order_id+violation_time`).
Прогон: `runRuleEngine(startDate, endDate, ruleId?, dryRun?, adHocRule?, trace?, targetOrderId?)` —
поддерживает dry-run и trace для отладки прямо из UI.

## 4. Оценка заказа (`okk_criteria` → `okk_order_scores`)

`evaluateOrder(orderId)` в `lib/okk-evaluator.ts`:

0. `syncOrderFromRetailCRM` — live-подтяжка заказа перед оценкой.
1. **Семён** `collectFacts` — факты без ИИ: заполненность полей CRM, ТЗ, контакты,
   статус звонков, длительности, число попыток/оценённых звонков, время до 1-го касания.
2. **Игорь** `checkSLA` — просрочки: лид в работе <1 суток, следующий контакт не просрочен,
   <1 суток с даты ТЗ, сделка в статусе <5 дней.
3. **Анна** `runInsightAnalysisDetailed` — ЛПР / бюджет / срочность (используется Максимом как «земная истина»).
4. **Максим** `evaluateScript` — скрипт-критерии по всей истории звонков заказа (холистически:
   выполнено хоть в одном звонке = true). Состав и промпты берутся из **`okk_criteria`**
   (`is_active`, `eval_method='ai_script'`, промпт в `ai_prompt`, `scoring_basket='script'`,
   порядок `sort_order`). Хардкод `DEFAULT_SCRIPT_CRITERIA` в коде — только фолбэк при пустом реестре.

Реестр `okk_criteria` (миграция `20260616_okk_criteria_registry.sql`) — источник правды о составе,
отображении и промптах. `eval_method`: `native` (логика в коде по key) | `ai_script` (динамичный ИИ) |
`field_filled` (обобщённый «поле заполнено», ключи в `params`) | `info` (справочная колонка, в балл не входит).
Редактируется в `/okk/criteria`, API `/api/okk/criteria`.

### Правило трёх состояний
`null` = «нет данных» — ТОЛЬКО системное (звонков нет / не транскрибировано / не синхронизировано).
Если ИИ отработал и навык не проявлен — это `false` (нарушение), не `null`. В промпте Максима
`null` запрещён явно; причина «нет данных» формулируется системой (`noDataReason`).

### Гейт «Работа с возражениями» (ТОП3)
Критерии `script_offer_best_tech | _terms | _price` применяются только если заказ дошёл до статуса
`na-soglasovanii` (по `order_history_log`, фолбэк — текущий статус ≥ по `statuses.ordering`).
Проверяют всю цепочку: вопрос задан в звонке → возражение отработано → поле CRM ТОП3 заполнено
и не противоречит ответу клиента.

### Расчёт (`calcScores`, `lib/okk-evaluator.ts:1135`)
- `deal_score_pct` = доля пройденных из 13 фактов+SLA; `null`-критерии из знаменателя исключаются.
- `script_score_pct` — детерминированно системой по `result` каждого скрипт-критерия (не «на глаз» у ИИ);
  `script_score` = % × 14.
- `total_score = (deal_score_pct + script_score_pct) / 2`; если одна часть `null` — берётся вторая.
- Штрафы: `total_score -= Σ points` по `okk_violations` заказа (и пропорционально `deal_score_pct`).
  Сохраняется `total_score_before_penalty` + журнал штрафов.
- `score_breakdown` — обоснование по каждому критерию (что проверяли, шаги расчёта, цитата) —
  именно его показывает Семён в чате и раскрытие ячейки в таблице.

## 5. Таблицы

| Таблица | Роль |
|---|---|
| `okk_criteria` | реестр критериев: label, категория, agent, eval_method, ai_prompt, scoring_basket, sort_order, is_active |
| `okk_order_scores` | оценка заказа: все критерии + проценты + `score_breakdown` + мета ИИ-пайплайна |
| `okk_rules` | правила нарушений: logic (blocks), severity, points, semantic_prompt |
| `okk_violations` | лог нарушений (иммутабельный, идемпотентный) |
| `call_order_matches` | связь звонок ↔ заказ |
| `raw_telphin_calls` | звонки + транскрипты + состояние STT |
| `order_history_log` | история статусов (гейты «был ли когда-либо в статусе») |

## 6. Страницы и API

- `/okk` — таблица контроля качества (фильтры менеджер/статус, колонки, критерии, панель Семёна).
- `/okk/criteria` — админка реестра критериев.
- `/okk/audit` — «Аудит Семёна».
- `/settings/rules` — конструктор правил нарушений.
- `/violations` — журнал нарушений.
- API: `/api/okk/scores`, `/api/okk/scores/[id]`, `/api/okk/scores/[id]/calls`,
  `/api/okk/evaluate/[orderId]`, `/api/okk/run-all`, `/api/okk/criteria`, `/api/okk/managers`,
  `/api/okk/priority`, `/api/okk/transcribe`, `/api/okk/proxy-audio`, `/api/okk/consultant/*`.

## 7. Законы, которые здесь легко нарушить

- Никакого хардкода русских строк/статусов в логике — только из БД / справочников RetailCRM.
- Имена критериев и полей с источником в CRM — из `retailcrm_custom_fields` / `retailcrm_dictionaries`.
- Только активные сущности RetailCRM.
- Знания ИИ (Семён) — в РАГ `okk_consultant_knowledge`, не в коде.
- Перед изменением роутинга/промпта/каталога Семёна — `npm run okk:consultant-quality-gate`.
- Новый роут/страница — своя строка в `DEFAULT_ROUTE_RULES` (иначе падает `tests/rbac-coverage.test.ts`).
