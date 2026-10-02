-- Файлы, прицепленные к заказу руками.
--
-- Евгения Матвеева 02.10.2026: «добавьте возможность добавлять файлы в заказ
-- менеджерам вручную — выставила счёт из RetailCRM, хочу приложить его в ОКК».
-- До этого в файлах заказа были только вложения писем, и они не хранились у
-- нас: докачивались из ящика по требованию.
--
-- Проверено перед созданием (закон «ничего не создаём, не проверив»): таблиц
-- order_files / *attachment* / order_doc* в базе нет; бинарь кладём в уже
-- существующий бакет `okk-assets`, куда уже складываются докачанные вложения.

CREATE TABLE IF NOT EXISTS public.order_files (
    id bigserial PRIMARY KEY,
    -- Номер заказа, как его видит человек: у своих заказов он с буквой «А»,
    -- поэтому текст, а не число.
    order_number text NOT NULL,
    file_name text NOT NULL,
    content_type text,
    size_bytes bigint,
    storage_bucket text NOT NULL DEFAULT 'okk-assets',
    storage_path text NOT NULL,
    note text,
    uploaded_by text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS order_files_order_idx
    ON public.order_files (order_number)
    WHERE deleted_at IS NULL;

COMMENT ON TABLE public.order_files IS
    'Файлы заказа, приложенные менеджером вручную. Вложения писем сюда не пишутся — они докачиваются из ящика.';
