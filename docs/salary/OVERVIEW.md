# Модуль ЗП ОП — как устроено (as-built)

> Канонический обзор реализованного модуля зарплаты. **Будущие чаты по зарплате начинают отсюда.**
> Дополняет [TZ.md](TZ.md), [PLAN.md](PLAN.md), [DECISIONS.md](DECISIONS.md). Дизайн/код — по [/golds](../../golds/).
> Если код разошёлся с этим документом — обнови документ.

## 1. Что это
Расчёт месячной зарплаты менеджеров отдела продаж в CRM на базе данных RetailCRM/ОКК.
Сейчас работает на **конструкторе бонус-блоков**: модель оплаты каждого менеджера = набор настраиваемых
блоков, собираемых из палитры. Доступ — роли `admin`/`rop`; менеджер видит только свою ЗП (`/salary/my`).

## 2. Главные принципы (инварианты — не нарушать)
1. **Ноль хардкода.** Все ставки/пороги/тиры/оклады — в БД, версионируются по дате (effective-dated).
   В коде — только метод расчёта, не числа. Отсутствующий runtime-параметр = явная ошибка.
2. **Только существующие данные.** Блок объявляет нужные метрики; требовать метрику вне
   `metrics-catalog` нельзя (структурный запрет «несуществующих показателей»).
3. **Реестр ОП = у кого есть назначенная схема** (`salary_manager_comp`). Никто лишний не считается
   (логисты/инженеры/уволенные — вне расчёта, пока им не назначена схема).
4. **Язык:** весь UI и пояснения — на русском. Технические коды (slug статусов и т.п.) — латиницей.
5. **Дизайн — по голдам** (Metro/High-Density: плоско, 0px радиус, без теней, плотно, edge-to-edge).
6. **Закрытый период неизменяем** — `recalc` бросает на закрытом периоде; правки только корректировками.
   Версии схем/конфига/планов с будущим `effective_from` не меняют прошлые периоды.

## 3. Поток данных
```
RetailCRM/ОКК (orders, order_history_log, okk_order_scores, salary_duty)
   │   ← RPC: salary_counted_orders / salary_incoming_counts / salary_client_deal_counts
   ▼
collectPeriodMetrics()  →  ManagerMetrics[] (заказы, типы, качество, конверсия, скидки, дежурства)
   +  resolveManagerComp(asOf)  → у кого какая схема (реестр) + блоки с параметрами
   +  getPlansForPeriod()       → личные/общий планы
   ▼
computePeriodSalary() → для каждого менеджера реестра compose(блоки) = формула
   ▼
salary_calc (legacy-колонки + breakdown.blockContributions)  →  GET /api/salary  →  UI
```
Файлы: `lib/salary/metrics.ts` (сбор), `lib/salary/schemes.ts` (резолв схем/планов),
`lib/salary/blocks/*` (каталог+compose), `lib/salary/engine.ts` (оркестрация+персист).

## 4. Бонус-блоки (каталог)
Блок = дескриптор в коде (`code, name, methodology, kind, group, multiplierScope?, requiredMetrics, paramSchema`)
+ чистая `compute(m, params, ctx) → {amount|multiplier, explain, dataFill}`. Параметры (числа) — из БД.

**Роли композиции:**
- `kind`: `base | premia | variable | multiplier | penalty`
- `group` (куда падает аддитив): `base | premia | variable | flat | duty`
- `multiplierScope` (для множителей): `premia` (множит премию) | `variableBracket` (множит скобку)

**Алгоритм сборки** (`lib/salary/blocks/compose.ts`):
```
total = base
      + (premia × Π(множители scope=premia) + variable) × Π(множители scope=variableBracket)
      + flat + duty + penalty
```
Под пресетом «Продавец» это тождественно прежней жёсткой формуле — закреплено golden-тестом
`tests/salary-compose.test.ts` (запускать в CI).

**Реализованные блоки** (`core-blocks.ts` + `extra-blocks.ts`, регистрируются в `registry.ts`):

| code | Название | kind/group | Метрики | Заметка |
|---|---|---|---|---|
| `oklad` | Оклад | base/base | worked_days | пропорция по отработанным дням |
| `premia_zayavki` | Премия за заявки | premia/premia | counted_orders, order_type | ставки new/permanent/pech_vto |
| `k_quality` | К_качества | multiplier/premia | okk_total_score | множит премию; нет оценок → ×1 |
| `conv_bonus` | Конв-бонус | variable/variable | conversion_incoming | gate по минимуму входящих |
| `discount_bonus` | Скидочная дисциплина | variable/variable | discount_pct | bonus если метрика ≤/≥ порога |
| `k_team` | К_команды | multiplier/variableBracket | team_revenue | множит всю переменную часть |
| `duty` | Дежурства | base/duty | duty_shifts | смены × ставка, не режется |
| `plan_attainment` | Выполнение личного плана | variable/**flat** | plan_personal, revenue_no_vat | факт/план ≥ порог → бонус |
| `plan_accelerator` | Ускоритель за перевыполнение | variable/flat | plan_personal | за каждый % сверх 100% |
| `plan_gate` | Гейт по плану | **multiplier/variableBracket** | plan_personal | <порога → ×0 переменной части |
| `volume_bonus` | Бонус за объём выручки | variable/flat | revenue_no_vat | выручка ≥ порог → бонус |
| `same_day_sale` | Продажа в день обращения | variable/flat | order_created_date | дата «передано в произв.» = дате создания → ×ставка |
| `script_bonus` | Соблюдение скрипта | variable/flat | okk_script_score | AVG(script_score_pct) ≥ порог |
| `fast_contact_bonus` | Скорость первого контакта | variable/flat | okk_first_contact | доля «в работе <1 дня» ≥ порог |
| `fields_bonus` | Заполнение ТЗ | variable/flat | okk_fields_filled | доля заполненных ≥ порог |

> `group: flat` = разовые/план-бонусы НЕ множатся К_команды (raw). Это осознанный дефолт; при правках
> модели держать в уме, где бонус должен/не должен умножаться.

**Доступность данных:** `metrics-catalog.ts` помечает метрики `full | partial | none`. Блок виден в
конструкторе только если все его метрики доступны. `margin` помечен `partial` (purchasePrice не у всех заказов).

## 5. Схемы (роли) и реестр
- **Схема** — именованный пресет блоков с параметрами, версионируется по дате
  (`salary_scheme` + `salary_scheme_block`).
- Менеджеру назначается схема (`salary_manager_comp`, effective-dated). **Есть назначение → в реестре ОП.**
- Сид (миграция `20260610_salary_schemes.sql`): «Продавец» (`seller`, полная мотивация, параметры = текущий
  `salary_config`) и «Оператор» (`operator`, только оклад 15 000). Назначения с 2026-05-01:
  Матвеева(98)/Парфёнова(10)/Гордеева(249) → seller; Хапилова(321) → operator.

## 6. Планы
`salary_plan` (помесячно): `manager_id NULL` = общий план отдела, иначе личный. Метрика — `revenue_no_vat`.
Личные и общий **независимы**. Редактируются в «Настройки мотивации → Планы».

## 7. База данных (таблицы модуля)
| Таблица | Назначение |
|---|---|
| `salary_period` | период (год/месяц/статус open\|closed) |
| `salary_calc` | строка расчёта по менеджеру: legacy-колонки (oklad/premia_zayavki/k_quality/conv_bonus/discount_bonus/duty_pay/k_team/total/margin_info) + `breakdown` (jsonb, free-form: детализация, `countedOrders[]`, `blockContributions[]`, `schemeCode`) |
| `salary_config` | базовый конфиг (effective-dated): closing_status, source_exclusions, nds_normalization, category_pech_vto_map, permanent_client_threshold, дефолтные ставки |
| `salary_scheme` / `salary_scheme_block` | схемы (роли) и их блоки с params |
| `salary_manager_comp` | назначение схемы менеджеру (= реестр) |
| `salary_plan` | планы по месяцам (отдел + менеджеры) |
| `salary_duty` | дежурства/табель (kind: duty\|worked_day) |
| `salary_adjustment` | корректировки для закрытых периодов (таблица есть, UI пока нет) |
| `salary_audit_log` | аудит изменений конфига/схем/планов/расчётов |

**RPC** (миграции `20260608_salary_rpc.sql`, `20260609_salary_counted_orders_robust.sql`):
`salary_counted_orders(start,end,closing)` — засчитанные заказы (статус «передано в произв.» = `send-assembling`;
устойчивый источник: история ИЛИ customField-дата ИЛИ текущий статус), `salary_incoming_counts`,
`salary_client_deal_counts`.

> Миграции применяются вручную (нет раннера). Применять к той же БД, что и у прода (project `lywtzgntmibdpgoijbty`).
> `.env.local` локально содержит только `DATABASE_URL` (нет SUPABASE-ключей → PostgREST-путь локально не воспроизводится;
> расчёт против БД гоняется raw-скриптами через `DATABASE_URL`).

## 8. API (`app/api/salary/*`, RBAC: admin/rop; `/my` и карточка заказа — ещё manager)
| Метод/маршрут | Назначение |
|---|---|
| `GET /api/salary?period=YYYY-MM` | сохранённый расчёт периода (+ статус). manager — только своя строка |
| `POST /api/salary/recalc {year,month}` | пересчёт из боевых данных + запись `salary_calc` (удаляет строки выбывших из реестра) |
| `POST /api/salary/close` | закрыть период |
| `GET /api/salary/export?period=` | Excel |
| `GET/POST/DELETE /api/salary/duty` | дежурства |
| `GET/PUT /api/salary/config` | базовый конфиг |
| `GET /api/salary/blocks` | каталог блоков + доступность данных (для конструктора) |
| `GET /api/salary/schemes` | схемы + менеджеры + назначения; `PUT` — сохранить версию схемы; `POST` — назначить/снять схему менеджеру |
| `GET/PUT /api/salary/plans?period=` | планы месяца |
| `GET /api/orders/[id]/details` | карточка заказа (RBAC `/api/orders`: admin/okk/rop/manager/demo) — открывается из отчёта |

## 9. UI (`app/salary/*`)
- **`/salary`** — дашборд: таблица по менеджерам; клик по строке → **модалка отчёта** (формула, детализация,
  список засчитанных заказов с кликабельными номерами → карточка заказа в ОКК). Кнопки: Дежурства, Настройки
  мотивации, Excel, Пересчитать, Закрыть период.
- **`/salary/my`** — менеджеру: своя ЗП + засчитанные заказы (кликабельны).
- **`/salary/settings`** — «Настройки мотивации», вкладки: **Схемы** (drag-drop конструктор: палитра блоков →
  карточка схемы, редактор параметров полями) · **Реестр ОП** (назначение схем) · **Планы** · **Базовые параметры**.

## 10. Обратная совместимость
Движок маппит вклады блоков обратно в legacy-колонки `salary_calc` (oklad/premia_zayavki/k_quality/...),
поэтому дашборд/экспорт работают без изменений. Новые блоки (план/объём/SPIFF) идут в `total` и
`breakdown.blockContributions[]`. Старые `breakdown` без `blockContributions` — отчёт читает legacy-поля (фолбэк).

## 11. Как сделать (рецепты)
- **Новый блок:** реализовать `BonusBlock` в `core-blocks.ts`/`extra-blocks.ts` (объявить `requiredMetrics`
  из `metrics-catalog`; если данных в каталоге нет — сперва добавить метрику и её сбор в `metrics.ts`),
  зарегистрировать в `registry.ts` (+ `DEFAULT_BLOCK_PARAMS`). Числа — только в params, не в коде.
- **Новая схема / правка:** UI «Схемы» (или `PUT /api/salary/schemes`). Версия с `effective_from`.
- **Удалить роль:** кнопка-корзина в шапке роли (или `DELETE /api/salary/schemes?code=…`). Если по роли уже
  считалась ЗП (есть `salary_calc` с `breakdown->>'schemeCode' = code`) — роль не удаляется, а **архивируется**
  (`salary_scheme.archived_at`): прячется из активного конструктора, история и пересчёт прошлых периодов
  сохраняются. Иначе — полное удаление (версии + блоки каскадом + назначения). Восстановление из «Архива ролей»
  (`POST /api/salary/schemes {action:'restore_scheme', schemeCode}`).
- **В/из реестра:** UI «Реестр ОП» (или `POST /api/salary/schemes` assign/unassign).
- **План:** UI «Планы» (или `PUT /api/salary/plans`).
- **Пересчёт месяца:** кнопка «Пересчитать» (или `POST /api/salary/recalc`). Закрытый период не пересчитывается.

## 12. Проверка
- `npm run test` → `tests/salary-compose.test.ts` (тождество формуле под «Продавец») + общий набор.
- `npx tsc --noEmit` (или `npm run build`) — типы/сборка.
- Пересчёт май/июнь raw-скриптом против БД и сверка состава/сумм.

## 13. Долг / TODO
- `salary_adjustment` — таблица есть, UI/логики корректировок нет.
- Полное соответствие `GOLD_UI_TABLES.md` для таблицы ЗП (sticky header, зебра, sticky первая колонка,
  zoom, шестерёнка колонок, фильтры-пресеты, bulk-actions, quick-view, пагинация, цветовая шкала, сокращение «к»).
- Конв-бонус: `eligible` в breakdown берётся из глобального конфига; если схема задаёт свой `minZayavki` —
  значение в отчёте может отличаться от факта блока (расчёт корректен, расходится только подпись).
- Блок `margin` — данные partial (purchasePrice не у всех).

## 14. Ключевые файлы
```
lib/salary/
  metrics.ts            сбор метрик из БД (+ агрегаты ОКК: скрипт/скорость/поля)
  schemes.ts            резолв схем/назначений/планов; save/list/assign
  engine.ts             computeManagerSalary/computePeriodSalary/calculatePeriod/recalcAndPersist
  config.ts             базовый конфиг (effective-dated, Zod)
  blocks/
    types.ts            модель блока (kind/group/multiplierScope, dataFill)
    compose.ts          алгоритм сборки → total + contributions
    core-blocks.ts      7 ядровых блоков (тождество формуле)
    extra-blocks.ts     план/объём/SPIFF/качество
    registry.ts         BLOCK_REGISTRY, listBlocks, DEFAULT_BLOCK_PARAMS
    metrics-catalog.ts  манифест доступных метрик (гейт «только существующее»)
app/api/salary/*        route handlers (см. §8)
app/salary/*            UI (см. §9)
migrations/2026060*_salary_*.sql, 2026061*_salary_*.sql
tests/salary-compose.test.ts   golden-тест
golds/                  дизайн/код-стандарты (сверять весь UI)
```
