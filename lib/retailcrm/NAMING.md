# RetailCRM — имена (env, БД, коды полей и справочников)

Чтобы не искать каждый раз. Проверено по коду и боевой БД 2026-06-10.

## ENV-переменные

| Переменная | Назначение | Фолбэк |
|------------|------------|--------|
| `RETAILCRM_URL` | базовый URL инстанса (`https://zmktlt.retailcrm.ru`) | `RETAILCRM_BASE_URL` |
| `RETAILCRM_API_KEY` | API-ключ | `RETAILCRM_KEY` |
| `RETAILCRM_SITE` | код магазина (для site-scoped запросов) | — |

Читаются в `getCrmConfig()` (`lib/retailcrm/leads.ts`). На проде заданы в Vercel;
в локальном `.env.local` отсутствуют.

## Таблицы БД

### `retailcrm_dictionaries` — значения справочников/перечислений
`entity_type`, `dictionary_code`, `item_code`, `item_name`, `updated_at`
— PK `(entity_type, dictionary_code, item_code)`.
- `entity_type='customField'` — значения пользовательских справочников (конвенция проекта; так читает `lib/retailcrm/mapping.ts`).
- `entity_type='orderMethod' | 'status'` — системные перечисления (`dictionary_code` = null).

### `retailcrm_custom_fields` — определения пользовательских полей
`entity`, `code`, `name`, `type`, `dictionary` (код связанного справочника),
`ordering`, `in_filter`, `in_list`, `display_area`, `raw` (jsonb), `updated_at`
— PK `(entity, code)`. Заполняется полным синком.

### `retailcrm_calls` — инвентарь звонков из RetailCRM (`lib/retailcrm/calls.ts`)
`rc_call_id` (PK, id звонка в RC), `external_id` (uniq, `<extId>-<record_uuid>`), `record_uuid`
(ключ стыковки с аудио `raw_telphin_calls`, см. `raw_payload.cdr[].record_uuid`), `call_type`,
`call_date`, `ext_code` (добавочный), `manager_rc_id`, `manager_name`, `phone`, `phone_normalized`,
`order_number` (= `orders.number`, м.б. NULL), `customer_rc_id`, `is_missed`, `duration_sec`,
`result`, `raw_payload`, `ingested_at`, `updated_at`. Источник истины для связки звонок→заказ
(надёжнее `lib/call-matching.ts`) и полноты. Курсор инкремента — `sync_state.retailcrm_calls_max_date`.
**Стыковка с аудио:** `lower(retailcrm_calls.external_id) = ANY(raw_telphin_calls.record_uuids)`
— `record_uuids` это «вторая наклейка» (массив всех `cdr[].record_uuid` плеч звонка, нижний регистр),
а НЕ `telphin_call_id` (он = `call_uuid`). Заполняется ингестом Telphin + бэкафиллом миграции.

### Значения полей в заказе
`orders.raw_payload -> 'customFields' ->> '<code>'` — значение кастом-поля заказа.

## Коды справочников (`dictionary_code`), которые реально есть в БД

| Код справочника | Что | ~значений |
|-----------------|-----|-----------|
| `kategoriya_klienta` | **Категории товара** (на него ссылается поле `typ_castomer`) | 52 |
| `sfera_deiatelnosti` | Сфера деятельности | 43 |
| `type_customer` | Тип клиента | 12 |
| `prichiny_otmeny_zakazov` | Причины отмены заказа | 9 |
| `deystviya` | Действия | 15 |
| `chasovoi_poias` | Часовой пояс | 17 |
| `month` | Месяц | 13 |
| `dolgnost_litsa_podpisivayushchego_dogovor` | Должность подписанта | 15 |
| `partnerstvo`, `mehaniki_prodag`, `konecny_perekup`, `osnovanie_dlya_podpisi`, `da_net` | прочие | — |

## Коды кастом-полей заказа (`customFields.<code>`), используемые в коде

| Код поля | Смысл | Связанный справочник |
|----------|-------|----------------------|
| **`typ_castomer`** | **Категория товара** (НЕ тип клиента, несмотря на имя!) | `kategoriya_klienta` |
| `sfera_deiatelnosti` (`sphere_of_activity`, `sfera_deyatelnosti`) | Сфера деятельности | `sfera_deiatelnosti` |
| `expected_amount` (`ozhidaemaya_summa`) | Ожидаемая сумма | — |
| `typ_customer_margin`, `vy_dlya_sebya_ili_dlya_zakazchika_priobretaete`, `purchase_form`, `forma_zakupki` | Форма закупки (себе/заказчику) | — |
| `next_contact_date` (`data_kontakta`) | Дата следующего контакта | — |
| `prichiny_otmeny` / `prichiny_otmeny_zakazov` | Причина отмены | `prichiny_otmeny_zakazov` |
| `top3_prokhodim_li_po_tsene2`, `top3_prokhodim_po_srokam1`, `top3_prokhodim_po_tekh_kharakteristikam` | Квалификация ТОП-3 (цена/сроки/ТХ) | — |

> Альтернативные коды категории, которые `lib/payload-validator.ts` проверяет как фолбэк:
> `tovarnaya_kategoriya`, `product_category`, `category`.

## Ключевая ловушка имён

- Поле заказа **`typ_castomer`** = категория товара; его значения — `code` элементов
  справочника **`kategoriya_klienta`**. Имена обоих сбивают с толку: `typ_castomer`
  звучит как «тип клиента», `kategoriya_klienta` — как «категория клиента», но по факту
  оба про **категорию товара**.
- Отдельное поле заказа `kategoriya_klienta` существует, но в заказах **пустое** (0 значений).

## Категории товара в ЗП

Категория заказа = `customFields.typ_castomer` (справочник `kategoriya_klienta`, имена из CRM).
Премия за категории — добавочный блок `premia_categorii` / `coef_categorii` в схеме мотивации
(админ выбирает категории из справочника). Категории — обычные товарные, без спецслучаев.
См. `docs/salary/category-premium-block.md`.
