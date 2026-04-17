# План актуализации ОКК в near realtime

Статус: план в исполнении, часть near realtime pipeline уже реализована в коде.

Цель: убрать заметное расхождение между RetailCRM, Telphin и ОКК, чтобы:
- данные по заказам в ОКК обновлялись почти сразу после изменений в RetailCRM;
- транскрибация работала непрерывно без ручных прогонов;
- аналитика и score ОКК пересчитывались по событию, а не пакетами раз в 30 минут;
- система не упиралась в таймауты Vercel и не перегружала API RetailCRM и Telphin.

## 1. Нагрузочная модель, от которой строим решение

- [x] Зафиксировать рабочую нагрузку как baseline: 20-30 новых заказов в день из RetailCRM.
- [x] Зафиксировать важное уточнение baseline: одновременно в рабочих статусах остаются около 500 заказов, а не только новые лиды текущего дня.
- [x] Зафиксировать рабочую нагрузку как baseline: 4 менеджера.
- [x] Зафиксировать важное уточнение baseline: каждый менеджер в среднем обрабатывает порядка 10 заказов в день, при этом общий активный пул заметно больше дневного потока.
- [x] Зафиксировать рабочую нагрузку как baseline: около 40 звонков в день на менеджера.
- [x] Принять расчётную нагрузку для проектирования: до 160 звонков в день суммарно.
- [x] Принять расчётный средний поток заказов: новые лиды дают только 2-3 заказа в час, но реальная нагрузка для pipeline определяется не ими, а потоком изменений по активному пулу.
- [x] Принять расчётный активный рабочий набор для production-проектирования: около 500 заказов в рабочих статусах, которые нельзя full-scan-ить каждые несколько минут.
- [x] Зафиксировать по базе за последние 60 дней фактический поток изменений: в среднем 1059.46 изменений в день, p50 = 1082, p95 = 2050.5, максимум = 2142.
- [x] Зафиксировать по базе рабочую часть потока изменений: в среднем 644.98 изменений в день по заказам, которые сейчас находятся в рабочих статусах, p50 = 749.5, p95 = 1156.4, максимум = 1303.
- [x] Принять расчётный средний поток звонков: до 20 звонков в час в среднем и до 15-20 звонков за 10 минут в коротком всплеске.
- [ ] Зафиксировать целевой SLA по свежести заказа в ОКК: до 1-2 минут при штатной работе.
- [ ] Зафиксировать целевой SLA по появлению транскрипции после готовности записи: до 3-7 минут при штатной работе.
- [ ] Зафиксировать целевой SLA по пересчёту score после нового события по заказу: до 1-3 минут.

## 2. Архитектурный принцип исправления

- [x] Перевести критичный контур с модели batch cron на модель событий + очередь + worker.
- [x] Оставить Vercel Cron только как резервный механизм догоняющей синхронизации и health-check, а не как основной runtime для живой обработки.
- [x] Сделать единый канонический контур данных для звонков: raw_telphin_calls + call_order_matches + raw_order_events + orders + order_metrics + okk_order_scores.
- [x] Вывести из боевого контура устаревшие параллельные таблицы incoming_calls, outgoing_calls, transcription_queue или оставить их только как legacy-слой до миграции.
- [x] Сделать пересчёт ОКК по одному заказу на событие, а не полным прогоном всех активных заказов.
- [x] Разделить pipeline на независимые очереди: order_updates, order_history_updates, call_ingest, call_match, transcription, insights, scoring, aggregates.
- [x] Ввести явный idempotency-ключ для каждого job, чтобы повторные события не создавали дублей и гонок.

## 3. Ограничения и безопасные лимиты по интеграциям

### RetailCRM

- [ ] Зафиксировать ограничение API RetailCRM v5: использовать limit только 20, 50 или 100.
- [ ] Для штатного дельта-поллинга использовать limit=50 как основной режим.
- [ ] Использовать limit=100 только в catch-up режиме, если backlog уже накопился.
- [ ] Не делать бесконечный цикл страниц в одном запуске; ограничить штатный прогон 1-2 страницами за итерацию.
- [ ] Для catch-up режима ограничить прогон 5-10 страницами за итерацию с явным time budget.
- [ ] Поставить базовую частоту дельта-поллинга заказов: 1 раз в 60 секунд в рабочее время.
- [ ] Поставить пониженную частоту дельта-поллинга заказов: 1 раз в 180 секунд в ночные часы.
- [ ] Поставить отдельный slow-path для полной проверки пропусков: 1 раз в 15 минут с lookback-окном.
- [ ] Использовать cursor по updatedAt или эквивалентному признаку обновления, а не по createdAt.
- [ ] Сохранять overlap-окно 2-5 минут для защиты от рассинхрона часов и задержек CRM.
- [ ] Ограничить одновременный запуск RetailCRM sync worker до 1 экземпляра через distributed lock.
- [ ] Ввести exponential backoff при 429 и 5xx от RetailCRM.
- [ ] Ввести circuit breaker: при серии ошибок временно снизить частоту запросов, а не продолжать долбить API.

### Telphin

- [x] Принять webhook-first модель как основной источник событий по звонкам и готовности записи.
- [x] Оставить fallback poller Telphin как страховку на случай потери webhook.
- [x] Поставить fallback poller истории звонков Telphin не чаще 1 раза в 120 секунд.
- [x] Ограничить fallback poller окном последних 10-15 минут, а не перечитыванием больших диапазонов.
- [ ] Использовать count=100 только для catch-up и backfill; в штатном режиме не перегружать обработку лишними страницами.
- [x] Ограничить одновременный запуск Telphin poll worker до 1 экземпляра через distributed lock.
- [x] Ввести дедупликацию по telphin_call_id и событийному типу webhook.
- [ ] Ввести отдельный backlog-recovery job, который медленно дочищает пропуски без давления на основной поток.

### AI и транскрибация

- [x] Ограничить concurrency транскрибации до 2 параллельных задач на старте.
- [x] Ограничить concurrency AI insights до 1-2 параллельных задач на старте.
- [x] Ограничить concurrency scoring по заказам до 2 параллельных задач на старте.
- [x] Ввести отдельные retry-правила для сетевых ошибок, таймаутов скачивания записи и ошибок OpenAI.
- [x] Ограничить concurrency транскрибации до 2 параллельных задач на старте.
- [x] Ограничить concurrency AI insights до 1 параллельной задачи на старте.
- [x] Ограничить concurrency scoring по заказам до 2 параллельных задач на старте.
- [x] Ввести dead-letter очередь для задач, которые не прошли после N попыток.

## 4. Целевая схема near realtime pipeline

- [ ] Событие order_changed из RetailCRM должно сразу создавать job на upsert заказа в orders/raw_order_events.
- [ ] После успешного upsert заказа автоматически создавать job на lightweight enrichment контекста.
- [ ] После любого изменения заказа автоматически создавать job на recalculation нужных derived fields.
- [ ] Событие history_changed из RetailCRM должно сразу создавать job на запись order_history_log и возможный rescore связанного заказа.
- [ ] Событие call_created из Telphin должно сразу записываться в raw_telphin_calls.
- [ ] Событие call_created должно сразу создавать job на matching звонка к заказу.
- [ ] Событие recording_ready должно сразу создавать job на transcription.
- [ ] Событие transcript_ready должно сразу создавать job на semantic rules и на insight refresh для связанного заказа.
- [ ] После semantic rules должно автоматически запускаться scoring только по затронутому заказу.
- [ ] После scoring должен запускаться лёгкий aggregate refresh только для затронутого менеджера и связанных витрин.

## 5. Этап 1. Нормализация текущей схемы данных

- [ ] Провести аудит всех мест, где пишутся данные звонков и транскрибации.
- [x] Подтвердить один боевой источник правды для звонков: raw_telphin_calls.
- [x] Подтвердить один боевой источник правды для транскрибации: transcription_status и transcript в raw_telphin_calls или отдельная каноническая очередь job.
- [x] Убрать расхождение между webhook-обработчиками Telphin и боевым cron транскрибации.
- [x] Обеспечить, чтобы webhook recording_ready сразу обновлял именно тот контур, который потом читает ОКК.
- [x] Обеспечить, чтобы webhook status_update не писал только в legacy-таблицы без продолжения pipeline.
- [x] Убедиться, что order_metrics, insights и okk_order_scores могут пересчитываться по одному order_id без полного batch-run.
- [ ] Добавить миграционный план выключения legacy-таблиц после стабилизации.

## 6. Этап 2. Очереди и worker-процессы

- [x] Ввести таблицу jobs или полноценную очередь для фоновых задач.
- [x] Поддержать типы задач: retailcrm_order_sync, retailcrm_history_sync, telphin_call_ingest, call_match, transcription, insight_refresh, score_refresh, aggregate_refresh.
- [x] Добавить поля queued_at, started_at, finished_at, attempts, locked_by, lock_expires_at, idempotency_key, payload, error_message.
- [x] Сделать выборку задач маленькими батчами без длинных HTTP-цепочек.
- [x] Ввести distributed lock на задачу и на тип worker, чтобы не было двойной обработки.
- [x] Реализовать retries с backoff без бесконечных циклов.
- [ ] Реализовать отдельный watchdog, который возвращает зависшие задачи из processing в queued после timeout.
- [x] Реализовать отдельный watchdog, который возвращает зависшие задачи из processing в queued после timeout.
- [x] Реализовать dead-letter слой для ручного разбора.
- [x] Для `call_transcription`, `order_insight_refresh` и `order_score_refresh` concurrency теперь enforced в `claim_system_jobs` на уровне БД через advisory lock + global max processing cap, а не только локальным `limit` одного route-вызова.
- [x] Status dashboard и monitoring начали показывать cap utilization для queue stages с enforced concurrency (`processing 1/2`, `1/1`, `2/2`), чтобы было видно, очередь реально забита или просто работает на своём лимите.

## 7. Этап 3. RetailCRM near realtime sync

- [x] Перевести основной синк заказов на updatedAt-based delta polling.
- [x] Писать в sync_state не только last success, но и last cursor, lag_seconds, last_error.
- [x] Дробить синк на короткие проходы с time budget до 10-15 секунд вместо длинных прогонов под лимит Vercel.
- [x] После каждого найденного изменённого заказа ставить отдельную задачу на rescore этого order_id.
- [x] Перестать триггерить insight только для первого заказа в пачке.
- [x] Для history sync уйти от отдельного редкого массового прохода раз в 30 минут и перевести его в более частый дельта-режим.
- [x] Сделать частоту history poller 1 раз в 120 секунд в рабочее время.
- [x] Оставить редкий full reconciliation job 1 раз в сутки для защиты от пропусков.

## 8. Этап 4. Telphin near realtime ingest

- [x] Сделать webhook incoming/status_update/recording_ready первичным путём записи в raw_telphin_calls.
- [x] На webhook сразу обновлять или upsert-ить каноническую запись звонка.
- [x] На webhook recording_ready сразу переводить звонок в состояние ready_for_transcription.
- [ ] На webhook call_end сразу создавать matching job, если order ещё не найден.
- [x] Оставить Telphin fallback poller только как страховочный слой на пропущенные webhook.
- [x] В fallback poller проверять только последние 10-15 минут и только незавершённые или неукомплектованные звонки.
- [x] Ввести защиту от повторной транскрибации одной и той же записи.

## 9. Этап 5. Непрерывная транскрибация

- [x] Заменить cron-подход "раз в 10 минут по 10 звонков" на непрерывную очередь задач transcription.
- [x] Обрабатывать звонки по мере появления recording_ready, а не ждать следующего cron-слота.
- [ ] Оставить ограничение concurrency=2 на старте и поднимать только после замера реальной latency.
- [x] Ввести приоритет транскрибации для звонков по активным рабочим статусам.
- [x] Ввести приоритет транскрибации для самых свежих звонков, чтобы карточка заказа обновлялась быстро.
- [x] Для слишком коротких или заведомо нерелевантных звонков ставить skip без отправки в OpenAI.
- [x] После завершения транскрибации автоматически создавать scoring job по связанному заказу.
- [x] После завершения транскрибации автоматически запускать semantic rules только для этого звонка или связанного заказа.

## 10. Этап 6. Непрерывная аналитика и пересчёт ОКК

- [x] Разделить full evaluation и single-order evaluation как разные режимы.
- [x] Сделать single-order evaluation основным режимом production.
- [x] Оставить full evaluation только как ночной backfill и аварийный rebuild.
- [x] Запускать score_refresh по событию order_changed.
- [x] Запускать score_refresh по событию history_changed.
- [x] Запускать score_refresh по событию call_matched.
- [x] Запускать score_refresh по событию transcript_ready.
- [x] Запускать score_refresh по событию semantic_rule_result_changed.
- [x] Ввести coalescing: если по одному order_id пришло 5 событий за минуту, объединять их в один пересчёт.
- [x] Ввести debounce 15-30 секунд для burst-событий по одному заказу, чтобы не гонять одинаковый score несколько раз подряд.

## 11. Этап 7. Агрегаты и витрины без тяжёлых полных refresh

- [ ] Убрать зависимость пользовательских экранов от ручного refresh quality analytics.
- [x] Перевести dialogue_stats и похожие витрины на инкрементальное обновление по событию.
- [x] Пересчитывать manager-level aggregates только для затронутого manager_id.
- [x] Пересчитывать order_priorities только для затронутого order_id или для маленького набора изменившихся заказов.
- [x] Оставить редкий полный reconciliation витрин 1 раз ночью.
- [x] `analysis/quality/refresh` переведён в backup-only режим для bulk rebuild: при realtime pipeline без `force=true` route больше не пересобирает витрину по всем менеджерам и допускает targeted refresh через `managerId`.

## 12. Этап 8. Наблюдаемость и контроль лагов

- [x] Добавить технический dashboard по lag на каждом этапе pipeline.
- [x] Показывать lag RetailCRM cursor до текущего времени.
- [x] Показывать oldest queued transcription job.
- [x] Показывать oldest queued score_refresh job.
- [x] Показывать p50 и p95 времени от order_changed до обновлённого score.
- [x] Показывать p50 и p95 времени от recording_ready до transcript_ready.
- [x] Показывать backlog по каждому типу задач.
- [x] Показывать количество retry и dead-letter задач за сутки.
- [x] Переделать health-check так, чтобы он смотрел не только на raw_order_events, но и на все критичные очереди.
- [x] Сделать алертинг в Telegram при превышении SLA по lag, а не только при полном падении cron.

## 13. Этап 9. Защита от таймаутов и деградации

- [ ] Исключить длинные HTTP-цепочки, где один endpoint последовательно делает sync, matching, rules, scoring и aggregates.
- [ ] Ограничить каждый worker короткой задачей с понятным time budget.
- [ ] Все тяжёлые батчи выполнять вне пользовательского HTTP-запроса.
- [ ] Ввести graceful degradation: при недоступности OpenAI не блокировать ingest заказа и звонка.
- [x] Ввести graceful degradation: при отставании analytics не блокировать запись фактов и базовых score.
- [ ] Сохранять причину последней ошибки по каждому типу worker в sync_state или в monitoring-таблице.

## 14. Этап 10. Пошаговый rollout без риска для продакшна

- [ ] Сначала внедрить только канонический ingest и очередь без отключения старых cron.
- [ ] Потом перевести транскрибацию на новую очередь и оставить старый cron как backup-readonly режим.
- [ ] Потом перевести single-order scoring на события и снизить частоту /api/okk/run-all.
- [ ] Потом перевести aggregates на инкрементальный пересчёт.
- [ ] Только после стабилизации выключить legacy-пути и старые параллельные таблицы.
- [ ] На каждом этапе иметь флаг feature toggle для быстрого возврата на старый поток.

Промежуточно реализовано в коде:
- [x] Добавлены отдельные cron-маршруты для `call-match`, `transcription`, `score-refresh` и `watchdog` через system-jobs worker endpoints.
- [x] Вынесен общий RetailCRM helper-слой для fetch/upsert snapshot-заказов без дублирования логики между batch и queue path.
- [x] Добавлен `retailcrm-order-delta` worker, который ставит отдельные `retailcrm_order_upsert` jobs по найденным изменениям.
- [x] Добавлен `retailcrm-history-delta` worker с частым дельта-проходом по `orders/history` и постановкой `retailcrm_order_upsert` jobs.
- [x] Добавлен `retailcrm-order-upsert` worker, который после upsert заказа запускает `order_score_refresh` и `order_insight_refresh`.
- [x] Добавлен `order-insight-refresh` worker и cron-расписание для CRM near realtime цепочки.
- [x] Добавлен coalescing `order_score_refresh` и `order_insight_refresh` по `order_id` с 30-секундным debounce-окном.
- [x] Monitoring endpoints обогащены lag/backlog метриками по `system_jobs`, RetailCRM cursors и oldest queued refresh/transcription jobs.
- [x] `system-audit` расширен Telegram-alerting по SLA lag/backlog для realtime pipeline с дедупликацией через `sync_state` и recovery-уведомлением.
- [x] Критичные system-jobs workers начали писать `last_success_at`, `last_error_at` и `last_error` в `sync_state` для диагностики и rollback-контроля.
- [x] `evaluateOrder` переведён на graceful degradation для AI-ветки: сбои `insight`/`script` больше не валят `score_refresh`, а базовый deal score сохраняется без искусственного обнуления script score.
- [x] `order_insight_refresh` перестал маскировать сбои AI под `skipped_no_metrics`: insight worker теперь различает отсутствие данных и реальный `failed`, чтобы очередь корректно ретраилась и отражала деградацию аналитики.
- [x] Для `call_transcription`, `call_semantic_rules` и `order_insight_refresh` введён общий adaptive retry classifier: зависимости `not ready` ретраятся коротко, network/download ошибки мягче, а 429/OpenAI ошибки получают более длинный backoff.
- [x] RetailCRM ingest усилен graceful degradation: API-запросы получили явный timeout, `retailcrm_order_delta` и `retailcrm_history_delta` переведены на adaptive retry, а `retailcrm_order_upsert` перестал падать на отсутствующем заказе и завершает такие кейсы как `skipped_not_found`.
- [x] Monitoring snapshot и status dashboard начали показывать active retry backlog по причинам (`dependency_wait`, `rate_limit`, `network`, `ai`, `generic`), чтобы было видно, что именно тормозит realtime pipeline.
- [x] Status dashboard начал отдельно выделять pipeline hotspot-очередь и dominant retry cause, чтобы оператор сразу видел главный bottleneck без чтения полного списка queue cards.
- [x] Hotspot summary realtime pipeline вынесен в общий monitoring snapshot, чтобы Telegram alerting, health endpoint и status dashboard использовали один и тот же расчёт bottleneck без расхождения логики.
- [x] Hotspot summary начал добавлять human-readable dependency hint (`RetailCRM`, `OpenAI`, media/download, upstream dependency wait`), чтобы оператор видел не только симптом очереди, но и вероятный внешний источник деградации.
- [x] Hotspot summary начал поднимать `last_error` проблемной очереди из `sync_state`, чтобы Telegram alerting, health signal и status dashboard показывали последнюю причину сбоя без ручного поиска по worker state.
- [x] Telphin ingest и storage path усилены controlled timeout/degradation: общий helper теперь ограничивает token lookup, `user`, `call_history` и download записи по времени и возвращает нормализованные network/timeout ошибки вместо зависаний.
- [x] `system-audit` и health-check начали включать в сигнал dominant retry causes, чтобы Telegram/monitoring показывали не только факт backlog, но и его источник (`dependency_wait`, `rate_limit`, `network`, `ai`, `generic`).
- [x] `system-audit` и health-check начали выделять конкретную hotspot-очередь (`transcription`, `score`, `insight` и т.д.), чтобы Telegram и health endpoint показывали не только общую деградацию, но и самый проблемный stage pipeline.
- [x] Webhook-side Telphin canonical ingest отвязан от legacy-слоя: ошибки чтения/обновления `incoming_calls`/`outgoing_calls` теперь не должны блокировать upsert в `raw_telphin_calls` и постановку realtime jobs.
- [x] Status dashboard начал показывать health workers по `sync_state`, включая последние ошибки, последние успехи и отдельную `Call Match Queue`.
- [x] `score-refresh` теперь точечно пересчитывает `order_priorities` по одному `order_id` и ставит `manager_aggregate_refresh` job для `dialogue_stats`.
- [x] Добавлен `manager-aggregate-refresh` worker, cron и мониторинг очереди агрегатов менеджеров.
- [x] Добавлен nightly reconciliation маршрут для `dialogue_stats` и `order_priorities` как fallback-backfill раз в сутки.
- [x] Legacy `/api/cron` перестал делать full refresh priorities при включенном realtime pipeline и остался backup-контуром.
- [x] Monitoring snapshot и status dashboard начали показывать p50/p95 latency по `transcription`, `score_refresh`, `manager_aggregate_refresh` и цепочке `score -> aggregate`.
- [x] Legacy `/api/cron` перестал делать batch matching при включенном realtime pipeline, а monitoring начал показывать recovery-метрики по completed/retry/dead-letter jobs за 24 часа.
- [x] Legacy `/api/matching/process` переведён в backup-only режим: при включенном realtime pipeline route по умолчанию `skip` и выполняется только через `force=true` для аварийного fallback sweep.
- [x] Monitoring snapshot, status dashboard и system-audit начали считать end-to-end p50/p95 для цепочки `call_match -> score_refresh -> manager_aggregate_refresh`.
- [x] Monitoring snapshot, status dashboard и system-audit начали считать SLA p50/p95 для доменных цепочек `recording_ready -> transcript_ready` и `order event -> score_refresh`, используя event timestamps в payload jobs с fallback на queue time.
- [x] Status backend начал поднимать operator-facing service cards для доменных SLA `Transcription SLA` и `Order Score SLA`, чтобы деградация была видна в общем списке сервисов, а не только в latency grid.
- [x] Legacy service cards `Matching Service` и `Transcription Cron` переведены в fallback-only semantics: status page больше не трактует их idle как primary incident при включённом realtime pipeline.
- [x] Rule Engine вынесен в отдельный cron-safe realtime маршрут, а legacy `/api/cron` перестал запускать rules при включенном realtime pipeline.
- [x] Семантические call-rules вынесены из direct transcription-trigger в отдельную `call_semantic_rules` очередь с dedicated worker, cron и latency/backlog monitoring.
- [x] Manual `rules/execute` и `priorities/refresh` перестали быть обходом legacy broad-scan path: теперь они используют общий realtime-safe runner или пропускают Rule Engine, когда ownership у realtime pipeline.
- [x] Legacy `/api/rules/execute` переведён в backup-only режим: при включенном realtime pipeline route по умолчанию `skip` и выполняется только через `force=true` для аварийного fallback rule sweep.
- [x] `analysis/priorities/refresh` переведён в backup-only режим для bulk path: при включённом realtime pipeline без `force=true` он больше не делает широкий пересчёт и допускает только targeted refresh через `orderId`.
- [x] Periodic Rule Engine fallback перестал каждые 5 минут сканировать 24 часа по умолчанию: cron/analysis routes теперь используют короткое настраиваемое fallback-окно `RULE_ENGINE_FALLBACK_HOURS` (по умолчанию 2 часа).
- [x] Legacy `/api/analysis/rules/cron` перестал выглядеть как основной контур: добавлен явный `/api/analysis/rules/reconcile`, а старый endpoint оставлен только как deprecated wrapper для обратной совместимости.
- [x] `analysis/rules/reconcile` и deprecated `analysis/rules/cron` больше не запускают default fallback window по умолчанию при включенном realtime pipeline: для широкого reconcile теперь нужен `force=true` или явный `start/end/rule`.
- [x] Webhook routes перестали писать в write-only legacy `transcription_queue`: боевой контур транскрибации теперь идёт только через канонический `raw_telphin_calls` и `system_jobs`.
- [x] RetailCRM delta/history workers начали писать в `sync_state` не только cursor/success, но и явные `lag_seconds` и `last_error` ключи для операционного контроля.
- [x] Incoming webhook перестал дублировать downstream `order_score_refresh`: ownership пересчёта после звонка оставлен за `call_match` worker и queue pipeline.
- [x] Telphin fallback poller переведён в near-realtime safe режим: cron раз в 2 минуты, bounded lookback `TELPHIN_FALLBACK_MINUTES` (по умолчанию 15 минут) и постановка `call_match`/`call_transcription` jobs после fallback ingest.
- [x] Telphin fallback sync начал писать в `sync_state` явные `telphin_fallback_lag_seconds` и `telphin_fallback_last_error`, а status backend начал показывать их в блоке Telphin Main Sync.
- [x] Legacy `/api/sync/retailcrm` и `/api/sync/retailcrm/history` переведены в backup-only режим: при включенном realtime pipeline они по умолчанию `skip` и выполняются только через `force=true`.
- [x] Legacy `/api/sync/history` переведён в backup-only режим: при включенном realtime pipeline route по умолчанию `skip` и выполняется только через `force=true` для аварийного fallback history sync.
- [x] Нагрузочная модель уточнена: помимо 20-30 новых заказов в день учитывается живой пул около 500 заказов в рабочих статусах; это закрепляет запрет на частые full-scan операции по активному массиву.
- [x] Нагрузочная модель подтверждена по реальной базе: поток history-изменений составляет около 1000+ событий в день и около 600+ событий в день по текущим рабочим заказам, поэтому bulk evaluation нельзя держать как частый cron.

## 15. Конкретные безопасные параметры запуска для вашего масштаба

- [ ] RetailCRM orders delta poll: каждые 60 секунд в рабочее время, каждые 180 секунд ночью.
- [ ] RetailCRM orders poll batch: limit=50, максимум 2 страницы за штатный проход.
- [ ] RetailCRM catch-up batch: limit=100, максимум 5-10 страниц за проход при backlog.
- [ ] RetailCRM history delta poll: каждые 120 секунд.
- [ ] Telphin fallback poll: каждые 120 секунд, окно проверки последних 10-15 минут.
- [ ] Matching worker: запуск по событию + fallback sweep каждые 5 минут.
- [ ] Transcription worker concurrency: 2.
- [ ] Insight worker concurrency: 1-2.
- [ ] Score worker concurrency: 2.
- [ ] Aggregate worker concurrency: 1.
- [x] Transcription worker concurrency: 2.
- [x] Insight worker concurrency: 1.
- [x] Score worker concurrency: 2.
- [x] Aggregate worker concurrency: 1.
- [ ] При потоке около 1000 history-изменений в день считать нормальным короткий event-driven rescore/coalescing, а не массовый `run-all` в рабочее время.
- [ ] Любые full-scan операции по пулу ~500 активных заказов выполнять только ночью или вручную, но не как штатный cron каждые 1-10 минут.
- [ ] Full rebuild ОКК: 1 раз ночью или вручную по кнопке администратора.
- [ ] Full reconciliation RetailCRM/Telphin пропусков: 1 раз ночью вне рабочего окна.

## 16. Критерии готовности

- [ ] Новый заказ из RetailCRM попадает в orders и виден в ОКК не дольше чем через 1-2 минуты.
- [ ] Изменение статуса или полей заказа отражается в карточке ОКК не дольше чем через 2 минуты.
- [ ] Новый звонок из Telphin появляется в raw_telphin_calls почти сразу после webhook или fallback poll.
- [ ] Матчинг звонка к заказу происходит не дольше чем через 1 минуту после появления звонка.
- [ ] Транскрипция стартует автоматически без ручной кнопки.
- [ ] Пересчёт score запускается автоматически после появления новой транскрипции.
- [ ] UI ОКК перестаёт зависеть от таймера "до следующей проверки" как от основного механизма обновления.
- [ ] При кратковременном падении внешнего API система догоняет backlog без ручного вмешательства.
- [ ] Нет второго скрытого контура данных, который пишет в legacy-таблицы и не попадает в боевой pipeline.

## 17. Минимальный порядок реализации

- [ ] Шаг 1: унифицировать канонический контур звонков и транскрибации.
- [ ] Шаг 2: внедрить job queue и worker-модель.
- [ ] Шаг 3: перевести RetailCRM sync на частый delta polling по updatedAt.
- [ ] Шаг 4: перевести Telphin на webhook-first с fallback poller.
- [ ] Шаг 5: перевести scoring на single-order recalculation по событию.
- [ ] Шаг 6: перевести analytics aggregates на инкрементальный refresh.
- [ ] Шаг 7: переделать monitoring и alerting по lag.
- [ ] Шаг 8: отключить старые batch-only пути после стабилизации.

## 18. Что не делать

- [ ] Не уменьшать RetailCRM limit до 10 или других недопустимых значений.
- [ ] Не пытаться лечить проблему только повышением частоты существующих тяжёлых Vercel cron.
- [ ] Не оставлять два параллельных источника правды по звонкам и транскрибации.
- [ ] Не запускать полный run-all каждые 1-5 минут.
- [ ] Не увеличивать concurrency AI-задач до замера фактической latency и стоимости.
- [ ] Не строить мониторинг только на признаке "cron когда-то запускался".

## 19. Подробный порядок исполнения

Ниже не просто целевые блоки, а последовательность работ, по которой можно идти шаг за шагом.

### Фаза 0. Зафиксировать текущее состояние

- [ ] Снять снимок текущих cron-маршрутов, их расписания и фактических зависимостей между ними.
- [ ] Составить таблицу: источник события, куда пишет, кто читает, какой следующий шаг pipeline.
- [ ] Отдельно выписать все места записи в orders, raw_order_events, raw_telphin_calls, call_order_matches, order_metrics, okk_order_scores.
- [ ] Отдельно выписать все места записи в incoming_calls, outgoing_calls, transcription_queue.
- [ ] Зафиксировать текущее поведение по заказу: RetailCRM update -> когда это появляется в UI ОКК.
- [ ] Зафиксировать текущее поведение по звонку: Telphin event -> когда звонок виден в карточке заказа.
- [ ] Зафиксировать текущее поведение по транскрипции: recording ready -> когда transcript попадает в ОКК.
- [ ] Зафиксировать текущее поведение по score: новое событие -> когда перерасчёт отражается в таблице ОКК.
- [ ] Подготовить один короткий markdown-отчёт "as-is pipeline".
- [ ] Подготовить один короткий markdown-отчёт "as-is lag measurements".

Результат фазы:
- [ ] Есть карта текущего pipeline.
- [ ] Есть список старых и новых контуров данных.
- [ ] Есть baseline по реальным задержкам.

Критерий перехода дальше:
- [ ] Для каждого критичного события понятно: где оно рождается, где хранится, кто его обрабатывает дальше.

### Фаза 1. Определить канонический источник правды

- [ ] Зафиксировать, что для телефонии каноническая таблица в production: raw_telphin_calls.
- [ ] Зафиксировать, что для матчинга каноническая таблица: call_order_matches.
- [ ] Зафиксировать, что для заказа канонические таблицы: orders и raw_order_events.
- [ ] Зафиксировать, что для транскрибации канонический статус должен жить либо в raw_telphin_calls, либо в job queue, но не в двух параллельных местах.
- [ ] Зафиксировать, что incoming_calls, outgoing_calls и transcription_queue являются legacy-контуром до миграции.
- [ ] Принять решение: удаляем legacy-контур полностью или временно держим как адаптер совместимости.
- [ ] Зафиксировать это отдельным блоком в плане и использовать как правило для всех следующих изменений.

Результат фазы:
- [ ] Есть одно решение по source of truth для каждого доменного объекта.

Критерий перехода дальше:
- [ ] Нет неопределённости, куда должен писать каждый новый webhook и каждый worker.

### Фаза 2. Подготовить целевую job queue модель

- [x] Описать схему таблицы jobs: id, job_type, payload, status, priority, idempotency_key, attempts, queued_at, started_at, finished_at, locked_by, lock_expires_at, error_message.
- [x] Описать статусную модель jobs: queued, processing, completed, failed, dead_letter.
- [ ] Описать правила идемпотентности по каждому типу задач.
- [ ] Описать правила retry по каждому типу задач.
- [ ] Описать правила dead-letter по каждому типу задач.
- [ ] Описать поля payload для каждого job_type.
- [x] Подготовить список job_type с назначением.
- [ ] Для каждого job_type описать: триггер, обработчик, входные данные, выходные данные.

Подробный перечень job_type:
- [ ] retailcrm_order_delta_pull
- [ ] retailcrm_history_delta_pull
- [ ] retailcrm_order_upsert
- [ ] telphin_call_upsert
- [ ] call_match
- [ ] call_transcription
- [ ] call_semantic_rules
- [ ] order_insight_refresh
- [ ] order_score_refresh
- [ ] manager_aggregate_refresh
- [ ] nightly_reconciliation

Результат фазы:
- [ ] Есть спецификация очереди и задач.

Критерий перехода дальше:
- [ ] Любое событие из внешней системы можно отобразить в конкретный job_type.

### Фаза 3. Спроектировать worker-процессы

- [ ] Описать отдельный worker для RetailCRM delta pull.
- [ ] Описать отдельный worker для RetailCRM history pull.
- [ ] Описать отдельный worker для Telphin fallback polling.
- [ ] Описать отдельный worker для call matching.
- [ ] Описать отдельный worker для transcription.
- [ ] Описать отдельный worker для insights.
- [ ] Описать отдельный worker для scoring.
- [ ] Описать отдельный worker для aggregates.
- [ ] Для каждого worker зафиксировать concurrency.
- [ ] Для каждого worker зафиксировать batch size.
- [ ] Для каждого worker зафиксировать max execution time.
- [ ] Для каждого worker зафиксировать lock strategy.

Подробные параметры старта:
- [ ] RetailCRM delta worker: concurrency 1.
- [ ] RetailCRM history worker: concurrency 1.
- [ ] Telphin fallback worker: concurrency 1.
- [x] Telphin fallback worker: concurrency 1.
- [x] Telphin fallback lock state (`running` / `contended` / `idle`) начал писаться в `sync_state`, чтобы status dashboard различал реальный fallback run, lock contention и простой route.
- [ ] Matching worker: concurrency 1.
- [ ] Transcription worker: concurrency 2.
- [ ] Insight worker: concurrency 1.
- [ ] Scoring worker: concurrency 2.
- [ ] Aggregate worker: concurrency 1.
- [x] RetailCRM delta worker: concurrency 1.
- [x] RetailCRM history worker: concurrency 1.
- [ ] Telphin fallback worker: concurrency 1.
- [x] Telphin fallback worker: concurrency 1.
- [x] Matching worker: concurrency 1.
- [x] Transcription worker: concurrency 2.
- [x] Insight worker: concurrency 1.
- [x] Scoring worker: concurrency 2.
- [x] Aggregate worker: concurrency 1.

Результат фазы:
- [ ] Есть схема процессов, которую можно реализовывать без споров по рантайму.

Критерий перехода дальше:
- [ ] Для каждого worker понятны: лимит, тайм-бюджет, частота, источник задач.

### Фаза 4. Разобрать и закрыть legacy-разрыв по Telphin

- [ ] Проверить все текущие webhook-обработчики Telphin и выписать, в какие таблицы они пишут.
- [ ] Подготовить список полей, которых не хватает raw_telphin_calls для прямого webhook upsert.
- [x] Подготовить mapping webhook payload -> raw_telphin_calls.
- [ ] Подготовить mapping webhook payload -> call_match job.
- [ ] Подготовить mapping webhook payload -> call_transcription job.
- [ ] Принять решение, как переводить существующие legacy записи в канонический контур.
- [ ] Подготовить обратную совместимость на период миграции.
- [ ] Зафиксировать момент, после которого legacy-таблицы перестают быть обязательными для основного потока.

Результат фазы:
- [ ] Есть понятный план миграции webhook-потока в канонический контур.

Критерий перехода дальше:
- [ ] Любой Telphin webhook можно обработать без записи в legacy-only таблицы.

### Фаза 5. Подробный план по RetailCRM delta sync

- [ ] Переписать логическую схему синка с createdAtFrom на updatedAt-based cursor.
- [ ] Описать структуру sync_state для RetailCRM: cursor, last_success_at, last_error_at, lag_seconds, pages_processed.
- [ ] Описать штатный прогон: каждые 60 секунд, limit=50, до 2 страниц.
- [ ] Описать catch-up прогон: limit=100, до 5-10 страниц, отдельный job.
- [ ] Описать nightly reconciliation прогон: широкое окно + защита от дублей.
- [ ] Описать time budget одного штатного job: не более 10-15 секунд.
- [ ] Описать, как выставляется overlap окно 2-5 минут.
- [ ] Описать, как обрабатываются 429 и 5xx.
- [ ] Описать, как система снижает частоту при деградации API.

Подробный исполнимый порядок:
- [ ] Сначала перевести cursor-логику в документации и модели данных.
- [ ] Потом ввести новый job retailcrm_order_delta_pull рядом со старым cron.
- [ ] Потом сделать запись результатов pull не напрямую в scoring, а в retailcrm_order_upsert jobs.
- [ ] Потом после каждого upsert заказа ставить order_score_refresh.
- [ ] Потом отключить прямую batch-цепочку из старого cron.

Результат фазы:
- [ ] Синк заказов дробится на короткие безопасные job.

Критерий перехода дальше:
- [ ] Изменённый заказ reliably доходит до orders без полного batch-run.

### Фаза 6. Подробный план по RetailCRM history sync

- [ ] Выделить отдельный cursor для history событий.
- [ ] Описать штатную частоту history pull: 120 секунд.
- [ ] Описать payload для job retailcrm_history_delta_pull.
- [ ] Описать upsert в order_history_log с защитой от дублей.
- [ ] После каждого history upsert ставить order_score_refresh для затронутых order_id.
- [ ] Если history событие влияет на derived context, ставить order_insight_refresh.
- [ ] Подготовить nightly reconciliation для пропущенных history событий.

Результат фазы:
- [ ] История заказа перестаёт ждать редкого 30-минутного окна.

Критерий перехода дальше:
- [ ] Изменения статуса и комментариев доходят до ОКК в пределах целевого SLA.

### Фаза 7. Подробный план по matching

- [ ] Убрать зависимость matching от периодического перепрожёвывания последних 5 дней как основного режима.
- [ ] Оставить event-driven matching на каждый новый или обновлённый звонок.
- [ ] Оставить fallback sweep каждые 5 минут только для доочистки пропусков.
- [ ] Для каждого звонка ставить idempotent job call_match.
- [ ] После успешного match сразу ставить order_score_refresh.
- [ ] Если звонок не сматчился, помечать его как unmatched и отправлять в recheck queue.
- [ ] Ограничить число автоматических повторов для unmatched звонка.

Результат фазы:
- [ ] Совпадение звонка с заказом не ждёт тяжёлого общего cron.

Критерий перехода дальше:
- [ ] Новый звонок матчит заказ в течение примерно минуты или переводится в контролируемый backlog.

### Фаза 8. Подробный план по транскрибации

- [ ] Перевести критерий старта транскрибации с cron-slot на событие recording_ready.
- [ ] Ввести статусную модель звонка: new, matched, ready_for_transcription, transcribing, transcribed, skipped, failed.
- [ ] Подготовить idempotent job call_transcription.
- [ ] Подготовить скачивание записи с retry и backoff.
- [ ] Подготовить логику skip для коротких и нерелевантных звонков.
- [ ] Подготовить повторную попытку при временной сетевой ошибке.
- [ ] После завершения транскрибации запускать call_semantic_rules.
- [ ] После завершения semantic rules запускать order_score_refresh.
- [ ] Оставить fallback cron только как recovery-проход по oldest pending задачам.

Результат фазы:
- [ ] Транскрибация стартует автоматически по событию.

Критерий перехода дальше:
- [ ] Большинство звонков не ждёт 10-минутный cron и проходит через очередь почти сразу.

### Фаза 9. Подробный план по insights и scoring

- [ ] Разделить расчёт на fast path и deep path.
- [ ] Fast path: обновить базовые факты и score по заказу сразу после события.
- [ ] Deep path: обновить тяжелые AI insights отдельно, не блокируя fast path.
- [ ] Определить, какие критерии ОКК можно пересчитать без глубокого AI-анализа.
- [ ] Определить, какие критерии требуют transcript и/или order_metrics.
- [ ] Ввести order_score_refresh как основную job для production.
- [ ] Ввести order_insight_refresh как вспомогательную job с меньшим приоритетом.
- [ ] Реализовать coalescing по order_id.
- [ ] Реализовать debounce 15-30 секунд на burst-события.

Подробный исполнимый порядок:
- [ ] Сначала научить scoring пересчитывать 1 заказ независимо от run-all.
- [ ] Потом завязать scoring на события order_changed, history_changed, call_matched, transcript_ready.
- [ ] Потом уменьшить роль /api/okk/run-all до nightly и manual fallback.

Результат фазы:
- [ ] Score ОКК обновляется на событиях, а не по таймеру каждые 30 минут.

Критерий перехода дальше:
- [ ] Новый факт по заказу вызывает локальный пересчёт без массового прогона.

### Фаза 10. Подробный план по агрегатам

- [ ] Выписать все пользовательские витрины, которые сейчас зависят от batch refresh.
- [ ] Разделить витрины на order-level, manager-level и system-level.
- [ ] Для manager-level витрин сделать инкрементальное обновление только по manager_id.
- [ ] Для quality analytics убрать обязательный ручной refresh.
- [ ] Оставить nightly rebuild для сверки итогов и устранения накопленных расхождений.

Результат фазы:
- [ ] Пользовательские экраны обновляются постоянно, без ручных кнопок пересчёта.

Критерий перехода дальше:
- [ ] После изменения заказа пересчитываются только нужные витрины, а не весь объём данных.

### Фаза 11. Подробный план по мониторингу

- [ ] Подготовить список обязательных метрик lag.
- [ ] Подготовить список обязательных метрик backlog.
- [ ] Подготовить список обязательных метрик ошибок.
- [ ] Подготовить список обязательных метрик SLA.
- [ ] Описать, где эти метрики будут храниться и как отображаться.
- [ ] Описать правила Telegram-alerting.
- [ ] Описать правила предупреждения и критического алерта.

Минимальный набор метрик:
- [ ] retailcrm_cursor_lag_seconds
- [ ] retailcrm_history_cursor_lag_seconds
- [ ] telphin_fallback_lag_seconds
- [ ] oldest_transcription_job_seconds
- [ ] oldest_score_refresh_job_seconds
- [ ] jobs_dead_letter_count
- [ ] score_refresh_p95_seconds
- [ ] transcription_p95_seconds

Результат фазы:
- [ ] Любая деградация pipeline видна до того, как её заметит пользователь.

Критерий перехода дальше:
- [ ] По каждому критичному этапу есть цифра lag, а не только признак "сервис жив".

### Фаза 12. Rollout по итерациям

- [ ] Итерация 1: включить job queue и мониторинг без выключения старых cron.
- [ ] Итерация 2: перевести webhook Telphin в канонический контур.
- [ ] Итерация 3: перевести транскрибацию на job queue.
- [ ] Итерация 4: перевести RetailCRM delta sync на updatedAt jobs.
- [ ] Итерация 5: перевести scoring на single-order refresh.
- [ ] Итерация 6: перевести aggregates на инкрементальную модель.
- [ ] Итерация 7: выключить legacy-цепочки и сократить старые cron до backup-режима.

Для каждой итерации выполнить одинаковый шаблон:
- [ ] Подготовить feature flag.
- [ ] Подготовить миграцию схемы.
- [ ] Подготовить обратную совместимость.
- [ ] Включить на небольшую долю потока или в shadow-режиме.
- [ ] Снять метрики lag и ошибок.
- [ ] Сравнить результат со старым контуром.
- [ ] Только после этого сделать новый контур основным.

## 20. Исполнимый чеклист первой очереди

Это набор задач, с которого реально стоит начинать исполнение.

### Блок A. Аудит и спецификация

- [ ] Подготовить документ с картой текущего pipeline.
- [ ] Подготовить документ с картой всех таблиц и источников записи.
- [ ] Подготовить документ с реальными лагами по 5-10 тестовым заказам и звонкам.
- [ ] Подготовить документ с целевой job queue схемой.
- [ ] Подготовить документ с новой state-моделью звонка и транскрибации.

### Блок B. Канонизация телефонии

- [ ] Описать окончательный формат raw_telphin_calls для webhook-first режима.
- [x] Описать адаптер из текущих webhook payload в raw_telphin_calls.
- [ ] Описать стратегию отказа от incoming_calls, outgoing_calls, transcription_queue.
- [ ] Описать fallback-поллер Telphin как backup-only механизм.

### Блок C. Очередь и фоновые задачи

- [x] Описать DDL новой jobs-таблицы.
- [x] Описать job_type и payload contracts.
- [ ] Описать idempotency strategy.
- [ ] Описать retry/backoff policy.
- [ ] Описать lock strategy.

Промежуточно реализовано в коде:
- [x] Добавлен transcription worker endpoint для `call_transcription` jobs.
- [x] Добавлен watchdog endpoint для возврата зависших `processing` jobs в `queued`.

### Блок D. Order-level recalculation

- [ ] Описать точку входа single-order scoring.
- [ ] Описать список событий, которые ставят order_score_refresh.
- [ ] Описать coalescing и debounce по order_id.
- [ ] Описать separation fast path / deep path.

Промежуточно реализовано в коде:
- [x] Добавлен score-refresh worker endpoint для `order_score_refresh` jobs.
- [x] Score-refresh worker переведён на прямой `evaluateOrder(orderId)` без вызова общего `runFullEvaluation`.
- [x] После успешного match из incoming webhook ставится `order_score_refresh` для затронутого заказа.
- [x] Добавлен отдельный `call_match` worker endpoint для обработки `call_match` jobs из очереди.

### Блок E. Monitoring

- [ ] Описать 8-10 ключевых lag-метрик.
- [ ] Описать таблицу или источник хранения техметрик.
- [ ] Описать Telegram-alerting по превышению SLA.

## 21. Определение готовности каждого шага

Чтобы потом можно было исполнять план без споров, у каждого крупного шага должен быть свой done-definition.

### Шаг считается завершённым только если:

- [ ] Изменение описано в документе или ADR.
- [ ] Есть схема данных или контракт payload, если шаг затрагивает обмен данными.
- [ ] Есть feature flag или безопасный способ rollout, если шаг влияет на production pipeline.
- [ ] Есть метрика, по которой можно проверить, что шаг реально дал эффект.
- [ ] Есть rollback-путь на случай деградации.
- [ ] Есть критерий приёмки на реальном заказе или звонке.

## 22. Порядок, в котором будем исполнять этот файл

- [ ] Сначала пройти полностью Фазу 0 и Фазу 1.
- [ ] Потом закрыть Блок A, B и C из первой очереди.
- [ ] Потом перейти к реализации канонизации телефонии и job queue.
- [ ] Потом перейти к RetailCRM delta sync и single-order scoring.
- [ ] Потом перейти к analytics и monitoring.
- [ ] Только после этого сокращать роль старых cron и убирать legacy-контуры.
