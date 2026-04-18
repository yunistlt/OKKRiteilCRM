# OKK Realtime As-Is Pipeline

Дата фиксации: 2026-04-18

## Краткий вывод

- Боевой канонический контур для звонков и транскрибации уже смещён в `raw_telphin_calls` + `system_jobs`.
- Legacy-записи в `incoming_calls` и `outgoing_calls` ещё существуют, но сведены к best-effort compatibility helper и могут быть отключены runtime override без деплоя.
- Основной незавершённый rollout-шаг плана: после периода стабилизации выключить legacy compat layer и убедиться, что ни один операторский сценарий больше не зависит от старых таблиц.

## Текущие cron-маршруты

Источник расписания: `vercel.json`.

| Route | Schedule | Роль |
| --- | --- | --- |
| `/api/cron/system-jobs/retailcrm-order-delta` | `*/1 * * * *` | Near realtime delta pull заказов RetailCRM |
| `/api/cron/system-jobs/retailcrm-order-upsert` | `*/1 * * * *` | Upsert заказа в канонический контур |
| `/api/cron/system-jobs/order-context-refresh` | `*/1 * * * *` | Lightweight refresh `order_metrics.full_order_context` |
| `/api/cron/system-jobs/retailcrm-history-delta` | `*/2 * * * *` | Near realtime history delta |
| `/api/cron/system-jobs/call-match` | `*/1 * * * *` | Event-driven matching звонков |
| `/api/cron/system-jobs/transcription` | `*/1 * * * *` | Очередь транскрибации |
| `/api/cron/system-jobs/call-semantic-rules` | `*/1 * * * *` | Semantic rules после transcript |
| `/api/cron/system-jobs/score-refresh` | `*/1 * * * *` | Single-order recalculation |
| `/api/cron/system-jobs/manager-aggregate-refresh` | `*/1 * * * *` | Инкрементальный manager refresh |
| `/api/cron/system-jobs/order-insight-refresh` | `*/2 * * * *` | Deep AI insight path |
| `/api/cron/system-jobs/watchdog` | `*/5 * * * *` | Возврат зависших jobs |
| `/api/cron/system-jobs/nightly-reconciliation` | `30 3 * * *` | Ночной reconciliation |
| `/api/sync/telphin` | `*/2 * * * *` | Fallback poller Telphin |
| `/api/sync/telphin/recovery` | `*/30 * * * *` | Backlog recovery Telphin |
| `/api/okk/run-all` | `15 4 * * *` | Ночной full rebuild |

Следующие legacy routes сохранены для manual force / emergency fallback, но больше не висят на штатном Vercel cron расписании:

- `/api/sync/retailcrm`
- `/api/sync/retailcrm/history`
- `/api/matching/process`
- `/api/rules/execute`
- `/api/analysis/priorities/refresh`
- `/api/cron/transcribe`

## Карта событий pipeline

| Событие / источник | Куда пишет | Кто читает дальше | Следующий шаг |
| --- | --- | --- | --- |
| RetailCRM delta pull | `system_jobs.retailcrm_order_upsert` | worker `retailcrm-order-upsert` | fetch order, upsert в `orders` / `raw_order_events` |
| RetailCRM order upsert | `orders`, `raw_order_events` через `upsertRetailCrmOrders` | worker `order-context-refresh` | refresh `order_metrics.full_order_context` |
| RetailCRM history delta | history log + `system_jobs.retailcrm_order_upsert` / refresh jobs | score / insight workers | локальный refresh по затронутому `order_id` |
| Telphin incoming webhook | `raw_telphin_calls`, best-effort `incoming_calls` | `call_match`, UI ОКК | match и дальнейший score refresh |
| Telphin status-update webhook | `raw_telphin_calls`, best-effort legacy status update | `call_match`, `call_transcription` | event-driven continuation без ожидания batch cron |
| Telphin recording webhook | `raw_telphin_calls`, best-effort legacy recording update | `call_match`, `call_transcription` | перевод в `ready_for_transcription` и enqueue |
| Telphin fallback poller | `raw_telphin_calls` | `call_match`, `call_transcription` | recovery-path для пропущенных webhook |
| Manual outgoing call initiate | `raw_telphin_calls`, best-effort `outgoing_calls` | webhook/status path | canonical-first tracking исходящего звонка |
| Call match | `call_order_matches` | transcription / score / semantic | match order to call |
| Transcription | `raw_telphin_calls.transcript`, `transcription_status` | semantic rules, score, insight | `transcript_ready` continuation |
| Semantic rules | rule results + score enqueue | score worker | пересчёт ОКК по затронутому заказу |
| Score refresh | `okk_order_scores`, priority storage | aggregate worker, UI ОКК | manager aggregate refresh |
| Manager aggregate refresh | manager-level витрины | dashboards / analytics UI | incremental manager-level update |

## Места записи по каноническим таблицам

| Таблица | Основные writers | Примечание |
| --- | --- | --- |
| `orders` | `upsertRetailCrmOrders`, backup sync routes, тестовые/debug routes | Production path идёт через `retailcrm_order_upsert` |
| `raw_order_events` | `upsertRetailCrmOrders`, history sync routes, тестовые/debug routes | Канонический order event contour |
| `raw_telphin_calls` | `syncCanonicalTelphinCallFromWebhook`, `upsertCanonicalTelphinCall`, `runTelphinSync`, transcription/storage helpers | Основной source of truth для звонка и transcript |
| `call_order_matches` | `saveMatches` из call-match path | Канонический contour матчинга |
| `order_metrics` | `order-context-refresh`, insight/analysis path, часть legacy DB-side enrichment | В production fast-path явно обновляет lightweight context |
| `okk_order_scores` | `evaluateOrder` через `order_score_refresh`, ночной rebuild | Production path single-order event-driven |

## Места записи по legacy-контуру

| Таблица | Текущий статус | Где ещё пишется |
| --- | --- | --- |
| `incoming_calls` | Legacy compat only | `bestEffortInsertIncomingLegacyCall`, `bestEffortUpdateLegacyCallStatus`, `bestEffortUpdateLegacyCallRecording` |
| `outgoing_calls` | Legacy compat only | `bestEffortInsertOutgoingLegacyCall`, `bestEffortUpdateLegacyCallStatus`, `bestEffortUpdateLegacyCallRecording` |
| `transcription_queue` | Не является боевым source of truth | Основной production flow уже использует `system_jobs.call_transcription` |

Все legacy writes централизованы в `lib/telphin-legacy-compat.ts` и управляются:

- env default: `ENABLE_TELPHIN_LEGACY_COMPAT`
- runtime override: `sync_state.telphin_legacy_compat_override`
- операторский контроль: status dashboard

## Call/transcription audit summary

### Write-path звонка

1. Webhook или fallback poller сначала обновляет `raw_telphin_calls`.
2. Затем ставится `call_match`.
3. При наличии записи ставится `call_transcription`.
4. После transcript запускаются `call_semantic_rules`, `order_score_refresh`, `order_insight_refresh`.

### Write-path транскрибации

1. Статус `ready_for_transcription` хранится в `raw_telphin_calls`.
2. Очередь обработки живёт в `system_jobs` с `job_type = call_transcription`.
3. Результат транскрибации записывается обратно в `raw_telphin_calls`.
4. UI и downstream analytics читают уже каноническую запись звонка, а не legacy queue.

## Что ещё осталось

1. Зафиксировать baseline реальных lag-метрик на live/staging данных по нескольким заказам и звонкам.
2. После периода стабилизации перевести `telphin_legacy_compat_override` в `disabled` и проверить, что `incoming_calls`/`outgoing_calls` больше никем не требуются.
3. После этого выключить compat layer и решить, какие из оставшихся manual-only legacy routes можно удалить полностью, а какие оставить как emergency fallback.