# Transcription Pipeline (Транскрибация звонков)

**Статус:** ✅ Закрыто (Production-ready)

## Описание

Полнофункциональный pipeline для транскрибации звонков из Telphin:

### Возможности
- **Автоматическая транскрибация** всех входящих и исходящих звонков
- **Обработка различных форматов** аудиозаписей
- **OCR для сканов** с fallback на manual review
- **Asynchronous processing** без блокировки основного потока
- **Retry-логика** с exponential backoff для сетевых ошибок
- **Dead-letter очередь** для ручного разбора проблемных случаев
- **Real-time monitoring** с dashboard и alerting

### Архитектура

| Компонент | Описание | Статус |
|-----------|---------|--------|
| Call ingest | Прием звонков из Telphin webhook | ✅ Готово |
| Queue model | Job-based очередь с lease mechanics | ✅ Готово |
| Transcription worker | Асинхронная обработка через system_jobs | ✅ Готово |
| Error handling | Terminal/retryable error classification | ✅ Готово |
| Observability | Dashboard и health checks | ✅ Готово |
| SLA monitoring | Tracking lag и throughput | ✅ Готово |

## Статус реализации

- ✅ **Фаза 0:** Stabilization (root cause fixed, pipeline healthy)
- ✅ **Фаза 1:** Queue ownership (single source of truth)
- ✅ **Фаза 3:** Idempotency (no duplicate transcription)
- ✅ **Фаза 4:** Pipeline decoupling (downstream failures don't block)
- ✅ **Фаза 5:** Retry strategy (terminal vs soft errors)
- ✅ **Фаза 6:** Observability (monitoring endpoint + health checks)

## Мониторинг

- **Dashboard:** `/api/monitoring/transcription-pipeline`
- **Health checks:** `/api/monitoring/health`
  - `stale_processing_calls` — calls stuck in processing > TTL
  - `transcription_worker_throughput` — completed calls/min
  
- **Alerts:** Telegram notifications при:
  - Очередь растёт без компленшена
  - Стоят вызовы > TTL в processing
  - Много retry errors за сутки

## Документация

- [CHECKLIST.md](CHECKLIST.md) — полный execution log и фазы реализации

## Контакты

- **Владелец:** Team Infrastructure
- **Slack:** #transcription-pipeline
