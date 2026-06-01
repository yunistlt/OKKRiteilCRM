# OKK Realtime As-Is Pipeline

Дата фиксации: 2026-04-18

## Краткий вывод

- Боевой канонический контур для звонков и транскрибации уже смещён в `raw_telphin_calls` + `system_jobs`.
- Legacy-записи в `incoming_calls` и `outgoing_calls` ещё существуют, но сведены к best-effort compatibility helper и могут быть отключены runtime override без деплоя.
- Основной незавершённый rollout-шаг плана: после периода стабилизации выключить legacy compat layer и убедиться, что ни один операторский сценарий больше не зависит от старых таблиц.

(Detailed current pipeline status - see archive for full content)
