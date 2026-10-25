-- Перенос уцелевшего из raw_order_events_orphans_backup и удаление копии.
--
-- ЧТО ЭТО. Резервная копия «осиротевших» событий — записей истории по заказам,
-- которых в базе нет. Сделана при какой-то давней операции, в коде не
-- упоминается ни разу, занимает 57 МБ.
--
-- РАЗБОР 16.10.2026 (всего 53 543 записи):
--   34 577  уже есть в order_history_log — переносить нечего
--   18 768  заказа не существует вовсе: ни один экран их не покажет, карточка
--           открывается по заказу, а заказа нет — мусор
--      198  заказ СУЩЕСТВУЕТ, а событий в истории не хватает → переносим здесь
--
-- Эти 198 — по 111 живым заказам, все закрытые (отгружен, отменён), события
-- 2024 года. История по ним должна быть полной, поэтому забираем.
--
-- Правила перевода те же, что в 20261016_merge_raw_order_events.sql: номер
-- записи, поле (с поправкой трёх названий), «было»/«стало», автор, время.

INSERT INTO public.order_history_log
    (retailcrm_history_id, retailcrm_order_id, field, old_value, new_value, user_data, occurred_at, created_at)
SELECT
    (b.raw_payload->>'id')::integer,
    b.retailcrm_order_id,
    COALESCE(
        NULLIF(b.raw_payload->>'field', ''),
        CASE b.event_type
            WHEN 'manager_changed' THEN 'manager'
            WHEN 'product_changed' THEN 'order_product'
            WHEN 'order_created'   THEN 'created'
            ELSE b.event_type
        END
    ),
    CASE WHEN jsonb_typeof(b.raw_payload->'oldValue') = 'string'
         THEN b.raw_payload->>'oldValue'
         ELSE NULLIF((b.raw_payload->'oldValue')::text, 'null') END,
    CASE WHEN jsonb_typeof(b.raw_payload->'newValue') = 'string'
         THEN b.raw_payload->>'newValue'
         ELSE NULLIF((b.raw_payload->'newValue')::text, 'null') END,
    CASE WHEN b.manager_id IS NOT NULL
         THEN jsonb_build_object('id', b.manager_id)
         ELSE NULL END,
    b.occurred_at,
    b.ingested_at
FROM public.raw_order_events_orphans_backup b
JOIN public.orders o ON o.order_id = b.retailcrm_order_id   -- только живые заказы
WHERE b.raw_payload ? 'id'
  AND NOT EXISTS (
      SELECT 1 FROM public.order_history_log h
       WHERE h.retailcrm_history_id = (b.raw_payload->>'id')::integer
  );

ANALYZE public.order_history_log;

-- ============================================================================
-- ВЫПОЛНЕНО 16.10.2026: перенесено 198 записей, копия удалена за 88 мс.
-- Проверено на заказе №7477 — события встали в общую ленту по датам, дублей 0.
-- База: 2 814 МБ → 2 757 МБ.
-- ============================================================================
