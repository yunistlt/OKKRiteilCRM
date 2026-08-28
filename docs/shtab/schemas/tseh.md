# ЦехУспех (ЗМК) — источник данных для Тамары

Файл готов к копированию в проект ОКК как `docs/shtab/schemas/tseh.md`.

Составлено в проекте ЦехУспех, все запросы сняты с боевой базы ЗМК и проверены на ней
(26.08.2026). Фазу «discover» по этой базе выполнять НЕ нужно — снимок здесь.

## Подключение

- **СУБД: MySQL 8.0.18**, не Postgres. Пакет `postgres`/`pg` тут не подойдёт — нужен `mysql2`.
  Read-only транзакция пишется как `START TRANSACTION READ ONLY` (не `SET TRANSACTION READ ONLY`).
- Хост `81.177.159.63:3306`, схема `zmk` (строчными), 214 таблиц, 53 хранимые функции.
- **`charset: 'utf8mb4'` в конфиге драйвера обязателен.** Без него русские значения приходят как
  `????`, а запросы фильтруют по именам статусов (`'В производстве'`, `'Отгружен'`) — молча вернётся
  пусто, без ошибки.
- Учётка: отдельный пользователь `tamara_ro`@`%` с правами только `SELECT, EXECUTE` на схему `zmk`,
  плюс лимиты `MAX_USER_CONNECTIONS 3`, `MAX_QUERIES_PER_HOUR 5000`. Заводит Андрей.

`EXECUTE` обязателен — без него не считается прибыль/маржа (см. ниже). Право на временные
таблицы не выдаётся. Хост `%`, а не конкретный IP, потому что у Vercel нет фиксированного
исходящего адреса. Доступ отзывается удалением этой учётки; веб ЦехУспеха ходит под другой
учёткой и не пострадает.

## Две ловушки схемы

1. **Внешних ключей в базе НЕТ вообще (0 FOREIGN KEY).** Связи логические, через поля `ID*`.
   Скрипт, снимающий FK, вернёт пусто — не делать из этого вывод, что таблицы не связаны.
   Рабочие связи перечислены в запросах ниже.
2. **Деньги нельзя считать наивным `SUM` по таблицам.** Себестоимость, зарплата заказа и материалы
   лежат в кэше и хранимых функциях ЦехУспеха (`SalaryOrder`, `CostOrderExt`,
   `CostMaterialsItemOrderNDS`, поля `ItemsOrders.RCalcMO/RCalcMONDS`). Самодельный `SELECT SUM(...)`
   даст число, которое не сойдётся с тем, что видит завод в своей программе. Ниже — запросы,
   перенесённые 1:1 из Delphi; каждый помечен исходной формой ЦехУспеха, чтобы цифру можно было
   сверить глазами.

## Ключевые таблицы

| Таблица | Что | Связь |
|---|---|---|
| `Orders` | заказы (шапка), 54 колонки | `IDStatus`→`StatusesOrders.ID`, `IDPurchaser`/`IDSeller`→`CounterParties.ID`, `IDWorkShop`→`WorkShops.ID` |
| `ItemsOrders` | позиции заказа, суммы | `IDOrder`→`Orders.ID` |
| `StatusesOrders` | статусы заказов | имена значимы для логики |
| `CounterParties` | контрагенты | `PercentNDS` — ставка НДС |
| `ItemsPaymentsOrders` | оплаты по заказу | `IDOrder`→`Orders.ID`, `IDPayment`→`Payments.ID` |
| `ListBalanses` | ежедневный снимок финпоказателей | `TypeData` 1..18, `DateUpdate` |
| `TexCards`, `ItemsTexCards` | техкарты и операции | производство |
| `Users`, `WorkShops` | сотрудники, цеха | |

Поля дат в `Orders`: `DateOrder` (создан), `DateReadyDelivery` (готов к отгрузке),
`DateDelivery` (отгружен). `Basket=0` — не в корзине, ставить всегда.

## Проверено с Мака под учёткой `tamara_ro` (28.08.2026)

Три утверждения этого файла на боевой не подтвердились. Ниже — как есть.

1. **Снимки `ListBalanses` не ежедневные.** 68 108 строк за 2007 дней — верно, но
   полный набор из 18 показателей за последние 60 дней записан лишь в **8 дней**;
   в остальные дни пишется один показатель — депозиты (`TypeData` 17). Снимок
   кладётся, когда человек открывает форму «Итоговый баланс», то есть примерно
   раз в неделю. Последний полный на момент проверки — 25.08.2026. «Брать снимок
   на последний день месяца» дало бы пусто или один случайный показатель.
2. **Функция `CostMaterialsItemOrderNDS` под read-only не работает** — внутри она
   создаёт временные таблицы, MySQL отвечает ошибкой 1792. Но первой же строкой
   она возвращает кэш `ItemsOrders.RCalcMONDS`, если он посчитан, — инструмент
   берёт этот кэш напрямую. Где кэша нет, заказ из прибыли исключается и его доля
   печатается отдельным полем. `SalaryOrder` и `CostOrderExt` под read-only
   работают.
3. **Нормы времени у операций не заполнены, но даты — заполнены.** За 12 месяцев
   182 168 операций: `TimeExecution` — **0 %**, зато `DateBegin`/`DateEnd` и
   исполнитель — **97,8 %**, расценка 97,4 %, `AvgTime` 54,9 %. Значит фактический
   такт, длительность операции и межоперационное пролёживание из ЦУ достаются;
   нормативная загрузка — нет. Средний разрыв между соседними операциями
   техкарты — 30,2 ч (850 тыс. пар).

Цифры за июль 2026 для сверки глазами с `erp.zmksoft.ru`: выручка без НДС
14 947 686, зарплата заказов 1 594 815, `CostOrderExt` 5 689, материалы
4 240 096, прибыль 8 660 538, маржа 57,9 %. `CostOrderExt` почти нулевой не из-за
прав: функция считает счета поставщиков с `TypeCost=4`, их у ЗМК почти нет.

## Глубина истории

- `ListBalanses` — с 29.11.2020, 2007 дней, ~68 тыс. строк (о регулярности см. выше).
- `Orders` — заказы с 2019 года, порядка 700–1100 в год.
- Отгруженных заказов (с `DateDelivery`) — около 5,8 тыс.

## Инструмент 1 — история финансов (`tseh_balance_history`)

Самый ценный источник: это те же цифры, что завод видит на своём дашборде «Итоговый баланс».
Ничего пересчитывать не надо — снимок уже посчитан программой цеха.

```sql
SELECT DATE(b.DateUpdate) AS d, b.TypeData, b.ValueData
FROM ListBalanses b
JOIN (SELECT DATE(DateUpdate) dd, TypeData, MAX(DateUpdate) mx
      FROM ListBalanses
      WHERE DateUpdate >= ? AND DateUpdate < ?
      GROUP BY dd, TypeData) t
  ON t.mx = b.DateUpdate AND t.TypeData = b.TypeData
ORDER BY d, b.TypeData;
```

Расшифровка `TypeData` (1:1 с Analytics.pas):

| Код | Показатель |
|---|---|
| 1 | Итоговый баланс |
| 2 | Итого остатки на счетах |
| 3 | Долг по заказам в производстве |
| 4 | Долг по счетам (по отгруженным заказам) |
| 5 | Долг по постоянным платежам |
| 6 | Долг по зарплате |
| 7 | Долг покупателей по неотгруженным заказам |
| 8 | Взаиморасчёты с поставщиками (знаковый: «+» нам должны) |
| 9 | Налог по зарплате |
| 10 | Налог на прибыль |
| 11 | НДС к уплате |
| 12 | Кредиторская задолженность по полученным авансам |
| 13 | Дебиторская задолженность по клиентам |
| 14 | Кредиторская задолженность перед поставщиками |
| 15 | Дебиторская задолженность по выданным авансам |
| 16 | Незавершённое производство |
| 17 | Баланс по депозитам |
| 18 | Долг покупателей по отгруженным заказам |

Для месячной динамики брать снимок на последний день месяца.

## Инструмент 2 — выручка по месяцам (`tseh_revenue_history`)

Источник: ListSales.pas (панель KPI списка заказов), строки 247–261. В оригинале запрос жёстко
привязан к текущему месяцу — здесь период вынесен в параметры. Сумма без НДС.

```sql
SELECT DATE_FORMAT(O.DateDelivery, '%Y-%m') AS m,
       COUNT(DISTINCT O.ID) AS orders_cnt,
       ROUND(SUM(IO.TotalPriceFact - ROUND(IF(CPS.PercentNDS > 0 AND IO.PercentNDS > 0,
             (IO.TotalPriceFact * IO.PercentNDS) / (100 + IO.PercentNDS), 0), 2)), 2) AS revenue_no_vat
FROM Orders O
JOIN ItemsOrders IO ON IO.IDOrder = O.ID
LEFT JOIN CounterParties CPS ON O.IDSeller = CPS.ID
WHERE O.Basket = 0 AND O.DateDelivery >= ? AND O.DateDelivery < ?
GROUP BY m ORDER BY m;
```

Заменив `DateDelivery` на `DateReadyDelivery`, получаем выпуск по готовности, а не по отгрузке —
в ЦехУспехе это две разные плитки, не путать.

## Инструмент 3 — прибыль и маржа по месяцам (`tseh_profit_history`)

Источник: ListSales.pas, строки 325–340. Требует `EXECUTE` — считает функциями ЦехУспеха.
Формула: выручка без НДС − зарплата заказа − 28 % с неё (взносы) − себестоимость − материалы с НДС.

```sql
SELECT DATE_FORMAT(DateDelivery, '%Y-%m') AS m,
       ROUND(SUM(PriceFactNDS), 2) AS revenue_no_vat,
       ROUND(SUM(PriceFactNDS) - SUM(SalaryOrder) - (SUM(SalaryOrder) * 0.28) - SUM(CostOrderExt)
             - IFNULL(SUM(MatNDS), 0), 2) AS profit,
       ROUND((SUM(PriceFactNDS) - SUM(SalaryOrder) - (SUM(SalaryOrder) * 0.28) - SUM(CostOrderExt)
             - IFNULL(SUM(MatNDS), 0)) * 100 / NULLIF(SUM(PriceFactNDS), 0), 2) AS margin_pct
FROM (
  SELECT O.ID AS TIDOrder, O.DateDelivery,
         SalaryOrder(O.ID) AS SalaryOrder,
         CostOrderExt(O.ID) AS CostOrderExt,
         IFNULL((SELECT SUM(IF(IO.PercentNDS = 0, IO.TotalPriceFact,
                    IO.TotalPriceFact * 100 / (100 + IO.PercentNDS)))
                 FROM ItemsOrders IO WHERE IO.IDOrder = O.ID), 0) AS PriceFactNDS,
         IFNULL((SELECT SUM(CostMaterialsItemOrderNDS(O.ID, IO.ID, O.DateDelivery, 0))
                 FROM ItemsOrders IO WHERE IO.IDOrder = O.ID), 0) AS MatNDS
  FROM Orders O
  WHERE O.Basket = 0 AND O.DateDelivery >= ? AND O.DateDelivery < ?
) t
GROUP BY m ORDER BY m;
```

Запрос тяжёлый: функции вызываются на каждый заказ. Не запускать на всю историю разом —
максимум год за вызов, лучше кэшировать помесячно на стороне ОКК.

## Инструмент 4 — дебиторка (`tseh_debt`)

Источник: ListSales.pas, строки 297–304. Обязательная деталь (BUG-18): у ЗМК включена настройка
«привязка оплат к заказам», поэтому оплатой считается только строка с платёжным документом.
Без условия `AND IPO.IDPayment IS NOT NULL` долг занижается в разы.

```sql
SELECT SUM(IF(PriceFact >= Payed, PriceFact - Payed, 0)) AS debt
FROM (
  SELECT ROUND(IFNULL((SELECT SUM(IPO.Amount) FROM ItemsPaymentsOrders IPO
                       WHERE IPO.IDOrder = O.ID AND IPO.IDPayment IS NOT NULL), 0), 2) AS Payed,
         ROUND(IFNULL((SELECT SUM(IO.TotalPriceFact) FROM ItemsOrders IO
                       WHERE IO.IDOrder = O.ID), 0), 2) AS PriceFact
  FROM Orders O
  LEFT JOIN StatusesOrders SO ON O.IDStatus = SO.ID
  WHERE O.Basket = 0 AND O.IDSeller <> O.IDPurchaser AND O.DateOrder >= '2020-01-01'
    AND SO.NameStatus IN ('В производстве','Новый','Выполнен','Готов к отгрузке',
                          'Рекламация','Перепродажа мебели','Отгружен')
) t;
```

Историю дебиторки лучше брать не этим запросом (он даёт «на сейчас»), а из `ListBalanses`,
коды 13 и 18 — там она уже посчитана на каждый день.

## Инструмент 5 — клиенты (`tseh_customers`)

```sql
SELECT CP.ID, CP.NameCounterParty,
       COUNT(DISTINCT O.ID) AS orders_cnt,
       MIN(O.DateOrder) AS first_order,
       MAX(O.DateOrder) AS last_order,
       ROUND(SUM(IO.TotalPriceFact), 2) AS total_amount
FROM Orders O
JOIN ItemsOrders IO ON IO.IDOrder = O.ID
JOIN CounterParties CP ON O.IDPurchaser = CP.ID
WHERE O.Basket = 0 AND O.DateOrder >= ?
GROUP BY CP.ID, CP.NameCounterParty
ORDER BY total_amount DESC;
```

Даёт постоянных клиентов, отвал и концентрацию выручки — то, чего в ОКК не хватало заглушкой.

## Чего в этой базе нет

- Рекламации отдельной таблицей не ведутся — есть статус заказа `'Рекламация'`. Считать по нему.
- Нормы времени операций (`TimeExecution`) не заполнены — это подтвердилось. А вот про даты
  утверждение было неверным: `DateBegin`/`DateEnd` стоят у 97,8 % операций. Считать по ним
  фактический такт и пролёживание можно, но каждое такое число перед выпуском сверяется с
  ручным замером по одному участку за смену: заполненность поля не доказывает, что отметку
  ставят вовремя.

## Проверка перед тем, как верить цифрам

Любой новый срез сверять с тем, что показывает сам ЦехУспех на `erp.zmksoft.ru` за тот же период.
Если не сходится — виноват запрос, а не программа цеха: там 30 заводов считают по ней деньги.
