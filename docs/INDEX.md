# 📑 Архив описательных файлов проекта OKKRiteilCRM

**Дата обновления:** 1 октября 2026  
**Статус:** Систематизированная структура документации

> Главная тема сейчас — **своя CRM**: [own-crm/OVERVIEW.md](own-crm/OVERVIEW.md)
> (as-built) и [own-crm/ROADMAP.md](own-crm/ROADMAP.md) (задачи). Начинать с них.

---

## 🎯 Быстрая навигация

### По модулям и функциям

| Модуль | Статус | Основные документы | Ответственный |
|--------|--------|-----------------|---------|
| **Своя CRM (переезд с RetailCRM)** | 🟡 В работе | [docs/own-crm/OVERVIEW.md](own-crm/OVERVIEW.md) ← начни отсюда, [ROADMAP.md](own-crm/ROADMAP.md), [FIELDS.md](own-crm/FIELDS.md) | Владелец |
| **Телефон в интерфейсе (софтфон)** | 🟢 Production | [docs/softphone/OVERVIEW.md](softphone/OVERVIEW.md) | Team Sales |
| **Автоприём писем (Катерина)** | 🟢 Production | [docs/email-secretary/OVERVIEW.md](email-secretary/OVERVIEW.md) | Team Sales |
| **Секретарь Телфина (входящие звонки)** | 🟢 Production | [docs/secretary/OVERVIEW.md](secretary/OVERVIEW.md) | Team Sales |
| **Бот-РОП (план дня, разбор вечера)** | 🟢 Production | [docs/sales-rop/](sales-rop/) | Team Sales |
| **Претензионно-исковая работа (реестр дел)** | 🟡 В работе | [docs/legal-matters/OVERVIEW.md](legal-matters/OVERVIEW.md) | Team Legal |
| **Суды по подписке («Страж»)** | 🟢 Production | [docs/court-watch/OVERVIEW.md](court-watch/OVERVIEW.md) | Team Legal |
| **Адресация уведомлений** | 🟢 Production | [docs/notifications/OVERVIEW.md](notifications/OVERVIEW.md) | All |
| **ОКК (контроль качества)** | 🟢 Production | [docs/okk/OVERVIEW.md](okk/OVERVIEW.md) | Team ОКК |
| **ОКК Консультант (Семён)** | 🟢 Production | [docs/okk-consultant/](okk-consultant/) | Team ОКК |
| **Юридические ИИ (Лев, Дарья, Борис, Григорий)** | 🟡 4 спринта | [docs/legal-ai/](legal-ai/) | Team Legal |
| **Исполнительные производства (ФССП)** | 🟡 не влито | [docs/legal-enforcement/OVERVIEW.md](legal-enforcement/OVERVIEW.md) | Team Legal |
| **Корпоративный мессенджер** | 🟡 92% ready | [docs/messenger/](messenger/) | Team Messenger |
| **Lead Catcher (Елена)** | 🟢 Реализован | [docs/lead-catcher/](lead-catcher/) | Team Sales |
| **Штаб владельца («Альянс Стратег»)** | 🟢 Реализован | [docs/shtab/](shtab/OVERVIEW.md) | Владелец |
| **Тамара — консультант Штаба** | 🟢 Реализован | [docs/shtab/TAMARA.md](shtab/TAMARA.md) | Владелец |
| **Служебный API для консультанта ЦехУспеха** | 🟢 Реализован | [docs/shtab/DUTY_API.md](shtab/DUTY_API.md) | Владелец |
| **Штаб: передача дел на локальную машину** | 🔵 Передача | [docs/shtab/HANDOFF.md](shtab/HANDOFF.md) | Владелец |
| **Зарплата ОП (конструктор)** | 🟢 Реализован | [docs/salary/](salary/README.md) ← начни отсюда | Team Sales |
| **Платежи «с точки» (Точка → заказы)** | 🟢 Реализован | [docs/payments/](payments/OVERVIEW.md) | Team Finance |
| **Режим тестировщика / проверка вёрстки по голдам** | 🟢 Реализован | [docs/ui-audit/OVERVIEW.md](ui-audit/OVERVIEW.md) | Frontend |
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
- [lead-catcher/QUALIFICATION.md](lead-catcher/QUALIFICATION.md) — Интеграция квалификации РОП-бот + Елена
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
| **Роли ИИ-команды** | `docs/ai-team/STAFF_ROLES.md` | [ai-team/STAFF_ROLES.md](ai-team/STAFF_ROLES.md) |
| **Своя CRM (as-built)** | `docs/own-crm/OVERVIEW.md` | [own-crm/OVERVIEW.md](own-crm/OVERVIEW.md) |
| **Интеграция RetailCRM** | `lib/retailcrm/` | `lib/retailcrm/README.md`, `API.md`, `NAMING.md` |
| **Границы ОКК ↔ ЛВЖ** | `docs/BOUNDARY_OKK_LVZ.md` | [BOUNDARY_OKK_LVZ.md](BOUNDARY_OKK_LVZ.md) |
| **ОКК план** | PLAN.md | [okk-consultant/PLAN.md](okk-consultant/PLAN.md) |
| **Legal план** | IMPLEMENTATION_PLAN.md | [legal-ai/IMPLEMENTATION_PLAN.md](legal-ai/IMPLEMENTATION_PLAN.md) |
| **Real-time архитектура** | ACTUALIZATION_PLAN.md | [realtime-pipeline/ACTUALIZATION_PLAN.md](realtime-pipeline/ACTUALIZATION_PLAN.md) |

---

## 🎓 Для новых членов команды

Начните отсюда:
1. 📖 [own-crm/OVERVIEW.md](own-crm/OVERVIEW.md) — куда движется сервис (своя CRM)
2. 📖 [ai-team/STAFF_ROLES.md](ai-team/STAFF_ROLES.md) — познакомьтесь с командой ИИ
3. 🎯 [okk-consultant/README.md](okk-consultant/README.md) — обзор консультанта
4. 📚 Выберите свой модуль из таблицы выше

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
