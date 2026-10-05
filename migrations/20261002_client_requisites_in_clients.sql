-- Реквизиты клиента живут в таблице клиентов, и синхронизация их не стирает.
--
-- Решение владельца 02.10.2026: реквизиты — атрибут заказчика, а не заказа. У
-- нас уже есть таблица клиентов (`clients`, зеркало покупателей RetailCRM), и
-- часть реквизитов в ней есть: `company_name`, `inn`, `kpp`,
-- `contragent_type`. Недостающие (банк, счёт, БИК, юрадрес, ОГРН) добавляем
-- здесь же — именами RetailCRM, как во всём переезде.
--
-- Вторая половина миграции важнее первой: `upsert_clients` затирал реквизиты
-- пустыми значениями из RetailCRM (у покупателя `contragent` там почти всегда
-- пуст). Теперь синхронизация ДОПОЛНЯЕТ: пришло значение — записали, пришла
-- пустота — оставили своё. Иначе внесённый менеджером ИНН исчезал при
-- следующем синке клиентов.

ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS "legalName"     TEXT,
    ADD COLUMN IF NOT EXISTS "legalAddress"  TEXT,
    ADD COLUMN IF NOT EXISTS "bank"          TEXT,
    ADD COLUMN IF NOT EXISTS "bankAccount"   TEXT,
    ADD COLUMN IF NOT EXISTS "BIK"           TEXT,
    ADD COLUMN IF NOT EXISTS "corrAccount"   TEXT,
    ADD COLUMN IF NOT EXISTS "bankAddress"   TEXT,
    ADD COLUMN IF NOT EXISTS "OGRN"          TEXT,
    ADD COLUMN IF NOT EXISTS "OGRNIP"        TEXT,
    ADD COLUMN IF NOT EXISTS requisites_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS requisites_updated_by TEXT;

COMMENT ON COLUMN public.clients."legalName" IS 'Реквизиты: юридическое название (как contragent.legalName в RetailCRM)';
COMMENT ON COLUMN public.clients."bankAccount" IS 'Реквизиты: расчётный счёт';
COMMENT ON COLUMN public.clients.requisites_updated_at IS 'Когда менеджер последний раз правил реквизиты в карточке клиента';

-- Таблица из первой попытки (реквизиты отдельной сущностью) не нужна: данные
-- живут в карточке клиента.
DROP TABLE IF EXISTS public.client_requisites;

CREATE OR REPLACE FUNCTION public.upsert_clients(clients_data jsonb[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    client_record JSONB;
BEGIN
    FOREACH client_record IN ARRAY clients_data
    LOOP
        INSERT INTO clients (
            id, external_id, first_name, last_name, patronymic,
            phones, email, created_at, updated_at, address,
            custom_fields, manager_id, site, vip, bad,
            personal_discount, cumulative_discount, source,
            company_name, inn, kpp, contragent_type,
            contact_name, contact_email, orders_count,
            total_summ, average_check, main_contact_id,
            is_corporate -- NEW
        )
        VALUES (
            (client_record->>'id')::BIGINT,
            client_record->>'external_id',
            client_record->>'first_name',
            client_record->>'last_name',
            client_record->>'patronymic',
            ARRAY(SELECT jsonb_array_elements_text(client_record->'phones')),
            client_record->>'email',
            (client_record->>'created_at')::TIMESTAMPTZ,
            (client_record->>'updated_at')::TIMESTAMPTZ,
            client_record->'address',
            client_record->'custom_fields',
            client_record->>'manager_id',
            client_record->>'site',
            COALESCE((client_record->>'vip')::BOOLEAN, FALSE),
            COALESCE((client_record->>'bad')::BOOLEAN, FALSE),
            (client_record->>'personal_discount')::NUMERIC,
            (client_record->>'cumulative_discount')::NUMERIC,
            client_record->>'source',
            client_record->>'company_name',
            client_record->>'inn',
            client_record->>'kpp',
            client_record->>'contragent_type',
            client_record->>'contact_name',
            client_record->>'contact_email',
            COALESCE((client_record->>'orders_count')::INTEGER, 0),
            COALESCE((client_record->>'total_summ')::NUMERIC, 0),
            COALESCE((client_record->>'average_check')::NUMERIC, 0),
            (client_record->>'main_contact_id')::BIGINT,
            COALESCE((client_record->>'is_corporate')::BOOLEAN, FALSE) -- NEW
        )
        ON CONFLICT (id) DO UPDATE SET
            external_id = EXCLUDED.external_id,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            patronymic = EXCLUDED.patronymic,
            phones = EXCLUDED.phones,
            email = EXCLUDED.email,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            address = EXCLUDED.address,
            custom_fields = EXCLUDED.custom_fields,
            manager_id = EXCLUDED.manager_id,
            site = EXCLUDED.site,
            vip = EXCLUDED.vip,
            bad = EXCLUDED.bad,
            personal_discount = EXCLUDED.personal_discount,
            cumulative_discount = EXCLUDED.cumulative_discount,
            source = EXCLUDED.source,
            company_name = COALESCE(NULLIF(EXCLUDED.company_name, ''), clients.company_name),
            inn = COALESCE(NULLIF(EXCLUDED.inn, ''), clients.inn),
            kpp = COALESCE(NULLIF(EXCLUDED.kpp, ''), clients.kpp),
            contragent_type = COALESCE(NULLIF(EXCLUDED.contragent_type, ''), clients.contragent_type),
            contact_name = EXCLUDED.contact_name,
            contact_email = EXCLUDED.contact_email,
            orders_count = EXCLUDED.orders_count,
            total_summ = EXCLUDED.total_summ,
            average_check = EXCLUDED.average_check,
            main_contact_id = EXCLUDED.main_contact_id,
            is_corporate = EXCLUDED.is_corporate; -- NEW
    END LOOP;
END;
$function$
;
