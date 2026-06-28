# 📑 Архив описательных файлов проекта OKKRiteilCRM

**Дата обновления:** 13 мая 2026  
**Статус:** Систематизированная структура документации

---

## 🎯 Быстрая навигация

### По модулям и функциям

| Модуль | Статус | Основные документы | Ответственный |
|--------|--------|-----------------|---------|
| **ОКК Консультант (Семён)** | 🟢 Production | [docs/okk-consultant/](okk-consultant/) | Team ОКК |
| **Юридические ИИ (Лев, Дарья, Борис, Григорий)** | 🟡 4 спринта | [docs/legal-ai/](legal-ai/) | Team Legal |
| **Корпоративный мессенджер** | 🟡 92% ready | [docs/messenger/](messenger/) | Team Messenger |
| **Lead Catcher (Елена)** | 🟢 Реализован | [docs/lead-catcher/](lead-catcher/) | Team Sales |
| **Зарплата ОП (конструктор)** | 🟢 Реализован | [docs/salary/](salary/README.md) ← начни отсюда | Team Sales |
| **Voice of Customer KB** | 🟡 В разработке | [docs/knowledge-base/](knowledge-base/) | Team KM |
| **Real-time pipeline** | 🟡 В исполнении | [docs/realtime-pipeline/](realtime-pipeline/) | Team Infrastructure |
| **Транскрибация** | 🟢 ✅ Закрыто | [docs/transcription/](transcription/) | Team Infrastructure |

| **ИИ-команда** | 📚 Справочник | [docs/ai-team/](ai-team/) | All |

---

## 📚 По типам документов

### 🎯 Планы реализации и дорожные карты
- [okk-consultant/PLAN.md](okk-consultant/PLAN.md) — Полный план консультанта ОКК
- [legal-ai/IMPLEMENTATION_PLAN.md](legal-ai/IMPLEMENTATION_PLAN.md) — План legal-агентов
- [messenger/READINESS_PLAN.md](messenger/READINESS_PLAN.md) — Готовность мессенджера
- [knowledge-base/PLAN.md](knowledge-base/PLAN.md) — План Voice of Customer KB
- [realtime-pipeline/ACTUALIZATION_PLAN.md](realtime-pipeline/ACTUALIZATION_PLAN.md) — Real-time синхронизация


### 🔧 Спецификации и чеклисты
- [lead-catcher/SPECS.md](lead-catcher/SPECS.md) — Спецификации Lead Catcher
- [legal-ai/CHECKLIST.md](legal-ai/CHECKLIST.md) — Чек-лист реализации legal
- [messenger/SMOKE_CHECK.md](messenger/SMOKE_CHECK.md) — Дымовое тестирование
- [transcription/CHECKLIST.md](transcription/CHECKLIST.md) — Транскрибация (✅ готово)

### 📖 Документация и справочники
- [knowledge-base/DOCS.md](knowledge-base/DOCS.md) — Документация VoC KB
- [messenger/ACCESS_MODEL.md](messenger/ACCESS_MODEL.md) — Модель доступа
- [ai-team/STAFF_ROLES.md](ai-team/STAFF_ROLES.md) — Штатное расписание ИИ-команды

### 🚀 Эволюция и развитие
- [okk-consultant/EVOLUTION.md](okk-consultant/EVOLUTION.md) — Gap-driven план развития Семёна
- [okk-consultant/UX_SIMPLIFICATION.md](okk-consultant/UX_SIMPLIFICATION.md) — Упрощение UX чата
- [okk-consultant/TRAINING.md](okk-consultant/TRAINING.md) — Обучение Семёна по ОКК

### 📋 Запуск и операции
- [messenger/RELEASE_RUNBOOK.md](messenger/RELEASE_RUNBOOK.md) — Runbook релиза мессенджера
- [realtime-pipeline/AS_IS_PIPELINE.md](realtime-pipeline/AS_IS_PIPELINE.md) — Текущее состояние pipeline

---

## 🟢 Готовые к production (✅)

- **ОКК Консультант** — основные функции реализованы, в развитии
- **Lead Catcher (Елена)** — полностью реализован
- **Транскрибация** — pipeline закрыто, мониторинг внедрён

---

## 🟡 В активной разработке

- **Юридические ИИ** — 4 спринта (Дарья, Лев, Борис, Григорий)
- **Корпоративный мессенджер** — 92% готов, финализация
- **Voice of Customer KB** — план + документация
- **Real-time pipeline** — перевод на event-driven архитектуру

---



---

## 📊 Метрики покрытия

| Компонент | Документировано | % |
|-----------|---------|---|
| Консультант ОКК | 21 раздел | ✅ 100% |
| Legal-агенты | 9 этапов | 🟡 ~70% |
| Мессенджер | 7 секций | 🟡 ~95% |
| Lead Catcher | 4 части | ✅ 100% |
| Real-time pipeline | 22 этапа | 🟡 ~85% |
| AI-команда | 6 ролей | ✅ 100% |

---

## 🔑 Ключевые источники истины (Source of Truth)

| Область | Master Source | Документ |
|---------|--------------|----------|
| **ОКК роли** | AI_STAFF_ROLES.md | [ai-team/STAFF_ROLES.md](ai-team/STAFF_ROLES.md) |
| **ОКК план** | PLAN.md | [okk-consultant/PLAN.md](okk-consultant/PLAN.md) |
| **Legal план** | IMPLEMENTATION_PLAN.md | [legal-ai/IMPLEMENTATION_PLAN.md](legal-ai/IMPLEMENTATION_PLAN.md) |
| **Real-time архитектура** | ACTUALIZATION_PLAN.md | [realtime-pipeline/ACTUALIZATION_PLAN.md](realtime-pipeline/ACTUALIZATION_PLAN.md) |

---

## 🎓 Для новых членов команды

Начните отсюда:
1. 📖 [ai-team/STAFF_ROLES.md](ai-team/STAFF_ROLES.md) — познакомьтесь с командой ИИ
2. 🎯 [okk-consultant/README.md](okk-consultant/README.md) — обзор консультанта
3. 📚 Выберите свой модуль из таблицы выше

---

## 📞 Быстрые ссылки на планы

- **Начать с ОКК?** → [okk-consultant/](okk-consultant/)
- **Работать с Legal?** → [legal-ai/](legal-ai/)
- **Развивать Мессенджер?** → [messenger/](messenger/)
- **Понять real-time?** → [realtime-pipeline/](realtime-pipeline/)
- **Изучить роли?** → [ai-team/STAFF_ROLES.md](ai-team/STAFF_ROLES.md)

---

## 🔄 История

Все файлы были перестроены из корня проекта в модульную иерархию `docs/` с целью:
- ✅ Четкая организация по модулям
- ✅ Навигация через README в каждом модуле
- ✅ Source of Truth для каждого компонента
- ✅ Лучший онбординг новых членов команды
- ✅ Сохранение 100% контента (ни одного слова не потеряно)
