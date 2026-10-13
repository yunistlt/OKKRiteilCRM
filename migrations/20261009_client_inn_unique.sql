-- ============================================================================
-- Одно юрлицо — одна карточка клиента.
--
-- Закон владельца 09.10.2026: ссылаемся на `clients.id` (он есть у всех, в том
-- числе у иностранцев и физлиц без ИНН), а ИНН делаем уникальным там, где он
-- заполнен, — вторую карточку с тем же ИНН база просто не примет.
--
-- Откуда брались дубли: автоприём заводил карточку, когда ИНН в письме ещё не
-- был известен, позже ИНН проставлялся из реквизитов и совпадал с давней
-- карточкой RetailCRM. Слияние делает scripts/merge-client-duplicates-by-inn.mjs.
-- ============================================================================

-- Слитая карточка не удаляется: на неё ссылаются старые документы и выгрузки.
-- Здесь написано, во что её слили.
ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS merged_into BIGINT REFERENCES public.clients(id);

COMMENT ON COLUMN public.clients.merged_into IS
    'Карточка слита в другую (дубль по ИНН). Заказы и реквизиты перенесены туда, ИНН снят.';

CREATE INDEX IF NOT EXISTS clients_merged_into_idx
    ON public.clients (merged_into) WHERE merged_into IS NOT NULL;

-- Уникальность ИНН — только у живых карточек с заполненным ИНН.
-- Индекс создаём ПОСЛЕ слияния дублей, иначе он не встанет.
CREATE UNIQUE INDEX IF NOT EXISTS clients_inn_unique
    ON public.clients (inn)
 WHERE inn IS NOT NULL AND inn <> '' AND merged_into IS NULL;
