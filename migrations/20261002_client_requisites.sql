-- Реквизиты — атрибут КЛИЕНТА, а не заказа (решение владельца 02.10.2026).
--
-- RetailCRM держит их на заказе (`contragent`), и у покупателя они почти всегда
-- пусты — так мы и читали их раньше, из последнего заказа. Но в своей CRM
-- правило другое: реквизиты принадлежат заказчику и в заказ ПОДТЯГИВАЮТСЯ из
-- его карточки. Иначе один и тот же клиент требует ввода реквизитов в каждом
-- новом заказе, а расхождение между заказами ловить нечем.
--
-- Отдельная таблица, а не колонки в `clients`: у клиента может быть несколько
-- юрлиц (ИП и ООО одного хозяина), и тогда сюда добавится второй ряд с
-- признаком основного, не трогая структуру карточки.

CREATE TABLE IF NOT EXISTS public.client_requisites (
    id             BIGSERIAL PRIMARY KEY,
    -- Номер клиента = clients.id (он же customer.id в заказе).
    client_id      BIGINT NOT NULL,
    contragent_type TEXT,
    legal_name     TEXT,
    inn            TEXT,
    kpp            TEXT,
    ogrn           TEXT,
    ogrnip         TEXT,
    legal_address  TEXT,
    bank           TEXT,
    bank_account   TEXT,
    bik            TEXT,
    corr_account   TEXT,
    bank_address   TEXT,
    -- Основные реквизиты клиента: их и подставляем в заказ.
    is_primary     BOOLEAN NOT NULL DEFAULT true,
    updated_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Одни основные реквизиты на клиента: второй набор заводится неосновным.
CREATE UNIQUE INDEX IF NOT EXISTS client_requisites_primary_key
    ON public.client_requisites (client_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS client_requisites_client_idx
    ON public.client_requisites (client_id);

CREATE INDEX IF NOT EXISTS client_requisites_inn_idx
    ON public.client_requisites (inn) WHERE inn IS NOT NULL;

COMMENT ON TABLE public.client_requisites IS
  'Реквизиты заказчика (ИНН, банк, юрадрес): принадлежат клиенту, в заказ подтягиваются';
