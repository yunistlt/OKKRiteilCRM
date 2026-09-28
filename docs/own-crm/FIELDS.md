# Карта полей заказа RetailCRM по факту базы (Z-1)

Снято 28.09.2026 по 30 878 заказам с `raw_payload`. Проценты — доля заказов,
где ключ присутствует. `null`-значений в ключах не встретилось ни разу:
отсутствующее поле RetailCRM просто не кладёт. Имена — как у них, менять не
будем.

## Верхний уровень (53 ключа)

Есть у всех 100% заказов:

| тип | ключи |
| --- | --- |
| строка | `markDatetime`, `orderType`, `countryIso`, `createdAt`, `currency`, `statusUpdatedAt`, `status`, `number`, `site` |
| число | `id`, `slug`, `totalSumm`, `summ`, `prepaySum`, `purchaseSumm`, `bonusesChargeTotal`, `bonusesCreditTotal` |
| да/нет | `call`, `expired`, `fromApi`, `shipped` |
| объект | `payments`, `contact`, `contragent`, `customer`, `customFields`, `delivery` |
| массив | `items` |

Есть не у всех:

| % | ключ | тип |
| --- | --- | --- |
| 100 | `managerId` | число |
| 99 | `firstName` | строка |
| 98 | `width`, `height`, `length` | число |
| 97 | `orderMethod` | строка |
| 94 | `managerComment` | строка |
| 93 | `phone` | строка |
| 92 | `statusComment` | строка |
| 91 | `email` | строка |
| 90 | `privilegeType`, `customerComment` | строка |
| 50 | `weight` | число |
| 48 | `lastName` | строка |
| 41 | `company` | объект |
| 31 | `additionalPhone` | строка |
| 17 | `patronymic` | строка |
| 16 | `fullPaidAt` | строка |
| 15 | `shipmentStore` | строка |
| 5 | `source` | объект |
| 1 | `externalId`, `shipmentDate` | строка |
| <1 | `personalDiscountPercent` (число), `links` (массив), `loyaltyLevel` (объект) | |

## `items` — позиции (43 521 строка, 19 ключей)

У всех: `id`, `offer` (объект), `productName` приходит внутри `offer`,
`quantity`, `initialPrice`, `purchasePrice`, `discountTotal`, `discounts`,
`prices`, `properties`, `status`, `ordering`, `createdAt`,
`bonusesChargeTotal`, `bonusesCreditTotal`.
Не у всех: `priceType` 99%, `vatRate` 55%, `markingObjects` 20%,
`isCanceled` 2%, `comment` <1%.

## `payments` — платежи (31 008 штук)

У всех: `id`, `amount`, `type`. Не у всех: `paidAt` 17%, `status` 17%,
`comment` 7%, `externalId` 1%.

## `delivery` (9 ключей)

`netCost`, `cost`, `address` (объект) — у всех; `vatRate` 100%, `code` 49%,
`integrationCode`/`data` <1%, `date`/`service` — единицы.

## `contragent` (15 ключей)

`contragentType` у всех. Дальше: `legalName` 37%, `INN` 36%,
`legalAddress` 35%, `bank` 31%, `bankAccount` 31%, `BIK` 31%,
`corrAccount` 31%, `KPP` 30%, `OGRN` 21%, `OKPO` 14%, `bankAddress` 4%,
`OGRNIP` 2%, `certificateNumber`/`certificateDate` — единицы.

Вывод: ИНН есть лишь у трети заказов — опираться на него как на единственный
ключ клиента нельзя, нужен фолбэк (см. `K-3`).

## `customer` (38 ключей) и `company` (14 ключей)

`customer` у всех: `id`, `type`, `createdAt`, `ordersCount`, `totalSumm`,
`averageSumm`, `marginSumm`, `costSumm`, `personalDiscount`, `vip`, `bad`,
`tags`, `customFields`. Не у всех: `nickName` 71%, `mainCustomerContact` 69%,
`mainCompany` 48%, `mainAddress` 34%, `phones`/`segments` 29%,
`contragent` 28%, `email` 22%, `externalId` 5%.

`company` (юрлицо покупателя) есть у 41% заказов: `id`, `name`, `active`,
`contragent`, `customer`, `ordersCount`, `totalSumm`, `averageSumm`,
`marginSumm`, `costSumm`, `customFields`, `createdAt`; `address` 11%.

## `customFields` — 72 своих поля

Массовые (>50% заказов): `prioriry_number`, `osnovanie_podpisi`, `control`,
`data_kontakta`, `srok_izgot`, `typ_castomer`, `change_name_manager`,
`dolzhnost`, `chasovoi_poias`, `sfera_deiatelnosti`,
`dokumentooborot_cherez_edo`, `typ_customer_margin`,
`schiot_deistvitelen_v_techenie_dnei`,
`vy_dlya_sebya_ili_dlya_zakazchika_priobretaete`,
`kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo`.

Рабочие (5–50%): `roistat`, `platnoe_khranenie`, `adres_fakt`,
`komment_diveleri`, `datacheta`, `lpr`, `position`,
`kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty`,
`warehouse_address`, `warehouse_email`, `data_pervoj_oplaty_po_zakazu`,
`poshta`, `sebestoimost2`, `data_peredachi_zakaza_v_proizvodstvo`,
`data_otmeny_zakaza`, `gorod_dostavki_menedzheram_op`, `fio`,
`dop_telefon2`, `otdat_botu`.

Редкие (<5%, 37 штук): от `kommentarii_proizvodstvu_logistu_snabzheniiu` и
`prichiny_otmeny` до полей под КП (`ssylka_na_kartinku1…4`,
`artikuly_tovarov_dlya_otobrazheniya_v_kp`), полей «для восстановления»
из Б24 и `inzhener_zakaza` (75 заказов).

Два поля причины отмены живут параллельно: `prichiny_otmeny` (1 337) и
`prichina_otmeny` (45). Разобрать при переносе, не выдумывая третье.

Имена для интерфейса — только из `retailcrm_custom_fields.name`, латиницу из
ключей человеку не показываем.
