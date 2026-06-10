# RetailCRM API v5 — справочник (сверено с офиц. докой)

Источники: [help.retailcrm.es/api_v5_en.html](https://help.retailcrm.es/api_v5_en.html),
офиц. доки docs.retailcrm.ru. Проверено 2026-06-10.

## Базовое обращение

```
GET  {RETAILCRM_URL}/api/v5/<path>?apiKey=<key>&<params>
POST {RETAILCRM_URL}/api/v5/<path>?apiKey=<key>
     Content-Type: application/x-www-form-urlencoded
     body: <entity>=<JSON-строка>     # напр. order={"status":"new",...}
```

`apiKey` передаётся **query-параметром** (не заголовком). Ответ всегда `{ "success": bool, ... }`;
при `success:false` — поле `errors`/`errorMsg`.

## Пагинация (во всех листинг-методах)

```
pagination: { limit, totalCount, currentPage, totalPageCount }
```
Перебирать страницы до `page > pagination.totalPageCount`.

## limit — допустимые значения (иначе 400)

- Заказы / история / клиенты: **`20 | 50 | 100`** (жёсткое ограничение проекта).
- `custom-fields`, `custom-fields/dictionaries`: `20 | 50 | 100 | 250`.
- По умолчанию используем **`100`**.

## GET /api/v5/custom-fields — список пользовательских полей

Параметры:
- `limit` (20|50|100|250), `page` (>=1) — обязательны.
- `filter[entity]`: `company | customer | customer_corporate | loyalty_account | order`
- `filter[type]`: `boolean | date | datetime | dictionary | email | integer | multiselect_dictionary | numeric | string | text`
- ещё: `filter[name]`, `filter[code]`, `filter[displayArea]`, `filter[inFilter]`, `filter[viewMode]`, `filter[viewModeMobile]`

Ответ: массив **`customFields[]`**. Поля элемента:
`code`, `name`, `type`, `entity`, `dictionary` (код связанного справочника, если type=dictionary),
`ordering`, `required`, `inFilter`, `inList`, `inGroupActions`, `displayArea`,
`viewMode`, `viewModeMobile`, `defaultTyped`.

> ВНИМАНИЕ: значения справочника здесь НЕ приходят — только `dictionary` (код). Значения — методом ниже.

## GET /api/v5/custom-fields/dictionaries — список справочников со значениями

> Путь именно такой. НЕ `/api/v5/custom-dictionaries`.

Параметры: `limit` (20|50|100|250), `page` (>=1) — обязательны; `filter[name]`, `filter[code]`.

Ответ: массив **`customDictionaries[]`**. Поля словаря: `name`, `code`, **`elements[]`**.
Поля элемента (`elements[]`): `name`, `code`, `ordering`.

Связь: поле заказа со `type=dictionary` имеет `dictionary=<код словаря>`; его значение в заказе
(`orders.raw_payload.customFields.<code>`) равно `code` одного из `elements` этого словаря.

## Прочие используемые методы (в `lib/retailcrm-orders.ts`)

- `GET /api/v5/orders` — `filter[createdAtFrom]`, `filter[startDate]`, `filter[sinceId]`, `limit`, `page`. Ответ: `orders[]`, `pagination`.
- `GET /api/v5/customers` — `filter[name]` (поиск по телефону/имени).
- `POST /api/v5/orders/create` — body `order=<JSON>`.

## Права API-ключа

Для чтения полей/справочников нужен доступ к методам `custom-fields` (право
`custom_fields_read`/`custom_fields_write` в настройках ключа RetailCRM).
