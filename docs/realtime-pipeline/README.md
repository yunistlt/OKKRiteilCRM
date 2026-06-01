# Real-time Pipeline для ОКК

**Статус:** 🟡 В исполнении (Event-driven архитектура внедряется)

## Описание

Real-time pipeline обеспечивает:
- **Near realtime синхронизацию** данных между RetailCRM, Telphin и ОКК (~1-2 минуты)
- **Непрерывную транскрибацию** звонков без ручных cron-запусков
- **Event-driven пересчёт** аналитики и score вместо batch-операций каждые 30 минут
- **Graceful degradation** при сбоях внешних API

## Ключевые компоненты

| Компонент | Статус | Описание |
|-----------|--------|---------|
| RetailCRM delta polling | ✅ Готово | Синхронизация заказов по updatedAt cursor |
| Telphin webhook-first | ✅ Готово | Основной источник звонков + fallback poller |
| System jobs queue | ✅ Готово | Job queue для call_match, transcription, scoring |
| Order score refresh | ✅ Готово | Single-order event-driven пересчёт |
| Manager aggregates | ✅ Готово | Инкрементальный refresh витрин по manager_id |
| Monitoring & lag tracking | ✅ Готово | Dashboard с SLA метриками |

## Как начать разработку

1. **Понимание текущего состояния:**
   - Читай [AS_IS_PIPELINE.md](AS_IS_PIPELINE.md) для карты текущего контура
   
2. **Реализованные фазы:**
   - ✅ Фаза 0-9: Основной контур канонизирован
   - ✅ Фаза 10: Monitoring и alerting в Telegram
   - 🔄 Фаза 11-14: Финальный shutdown legacy режимов

3. **Тестирование pipeline:**
   - Check lag metrics: `/api/settings/system-status`
   - Monitor queue: `/api/monitoring/transcription-pipeline`
   - Manual order sync: POST `/api/okk/evaluate/{orderId}`

## Критерии готовности production

- ✅ Новый заказ из RetailCRM попадает в ОКК за 1-2 минуты
- ✅ Звонок матчится к заказу за ~1 минуту
- ✅ Транскрипция стартует автоматически после recording_ready
- ✅ Score пересчитывается без ручного run-all
- ✅ SLA lag < 2 минут для 95-го перцентиля

## Документация

- [ACTUALIZATION_PLAN.md](ACTUALIZATION_PLAN.md) — полный план с 22 этапами
- [AS_IS_PIPELINE.md](AS_IS_PIPELINE.md) — текущее состояние и карта событий
- `/api/settings/system-status` — operational dashboard
- Telegram alerts — auto-notification по SLA violations

## Контакты

- **Владелец:** Team Infrastructure
- **Slack:** #okk-realtime-pipeline
