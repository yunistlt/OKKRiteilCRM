-- ============================================================================
-- Хранилище разбора дня.
--
-- Разбор формирует бот-РОП (lib/sales-rop/call-review.ts), но до сих пор он
-- жил только в сообщении Telegram: открыть его на экране было нельзя, а шлюзу
-- чтения нужен документ со ссылкой, по которой он узнаётся.
--
-- Заполнение разбора — задача отдельного ТЗ (docs/sales-rop/TZ_MORNING_CALL_REVIEW.md).
-- Здесь только место, куда он ляжет: пока таблица пуста, шлюз не срабатывает,
-- и это правильно — нет документа, нет блокировки.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sales_rop_day_review (
    id bigserial PRIMARY KEY,
    manager_id bigint NOT NULL,
    review_date date NOT NULL,
    title text,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (manager_id, review_date)
);

COMMENT ON TABLE public.sales_rop_day_review IS
    'Разбор дня менеджера как документ: его показывает шлюз чтения перед началом работы.';
