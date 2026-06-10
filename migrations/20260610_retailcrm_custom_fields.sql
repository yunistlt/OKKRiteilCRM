-- ============================================================================
-- Полный справочник пользовательских ПОЛЕЙ RetailCRM (определения), в дополнение
-- к retailcrm_dictionaries (значения справочников). Синкается /api/sync/dictionaries
-- по всем сущностям (order, customer, customer_corporate), активные и неактивные.
-- Хранит, в т.ч., связь поле → справочник (dictionary) — например order.typ_castomer
-- ссылается на справочник kategoriya_klienta (категории товара).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.retailcrm_custom_fields (
    entity      TEXT NOT NULL,            -- order | customer | customer_corporate
    code        TEXT NOT NULL,            -- символьный код поля (напр. typ_castomer)
    name        TEXT,                     -- человекочитаемое название
    type        TEXT,                     -- тип поля (string | dictionary | integer | ...)
    dictionary  TEXT,                     -- код связанного справочника (для type=dictionary)
    ordering    INT,                      -- порядок отображения
    in_filter   BOOLEAN,                  -- участвует в фильтрах
    in_list     BOOLEAN,                  -- показывается в списках
    display_area TEXT,                    -- область отображения (customer/delivery/...)
    raw         JSONB,                    -- сырое определение поля из RetailCRM
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entity, code)
);

CREATE INDEX IF NOT EXISTS idx_retailcrm_custom_fields_dict
    ON public.retailcrm_custom_fields (dictionary);
