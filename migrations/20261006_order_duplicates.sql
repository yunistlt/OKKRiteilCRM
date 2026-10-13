-- ============================================================================
-- Поиск возможных дублей заказов.
--
-- Жалоба Ирины Гордеевой 06.10.2026: «тут не найти дубли заказов». Клиент
-- присылает одну и ту же заявку дважды — через сайт и почтой, или звонит
-- второй раз, — и над ней начинают работать двое. В RetailCRM дубль было
-- видно, у нас — нет.
--
-- Дублем СЧИТАЕМ: у заказа есть другой НЕЗАКРЫТЫЙ заказ того же клиента,
-- заведённый рядом по времени. Это кандидат на проверку, а не приговор:
-- решение за менеджером, поэтому автоматически ничего не помечаем и не
-- отменяем.
--
-- Почему только незакрытые: отменённый или выполненный заказ работу не
-- задваивает, а у постоянного клиента таких за годы десятки — список стал бы
-- бесполезным. Группы «Отменен» и «Выполнен» берём из справочника статусов, а
-- не списком кодов в тексте.
--
-- Почему не сверяем состав: у половины свежих заявок его ещё нет (679 из 1219
-- за 90 дней), и настоящий дубль по нему не ловится.
--
-- Окно близости и глубина поиска — параметры, а не числа внутри запроса.
-- По умолчанию 14 дней и 90 дней: за 90 дней это 213 заказов из 1219, обозримо
-- для ручной проверки.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.orders_duplicate_ids(
    p_window_days int DEFAULT 14,
    p_depth_days  int DEFAULT 90
)
 RETURNS TABLE(order_id bigint)
 LANGUAGE sql
 STABLE
AS $function$
    WITH closed AS (
        SELECT s.external_code
          FROM public.crm_statuses s
          JOIN public.crm_status_groups g ON g.id = s.group_id
         WHERE g.name IN ('Отменен', 'Выполнен')
    ),
    open_orders AS (
        SELECT o.order_id,
               o.raw_payload->'customer'->>'id' AS client_id,
               o.created_at
          FROM public.orders o
         WHERE o.crm_deleted_at IS NULL
           AND o.raw_payload->'customer'->>'id' IS NOT NULL
           AND (o.status IS NULL OR o.status NOT IN (SELECT external_code FROM closed))
    )
    SELECT DISTINCT a.order_id
      FROM open_orders a
      JOIN open_orders b
        ON b.client_id = a.client_id
       AND b.order_id <> a.order_id
       AND abs(extract(epoch FROM (b.created_at - a.created_at))) <= p_window_days * 86400
     WHERE a.created_at > now() - make_interval(days => p_depth_days);
$function$;

COMMENT ON FUNCTION public.orders_duplicate_ids(int, int) IS
    'Возможные дубли: незакрытые заказы одного клиента, заведённые рядом по времени (жалоба Ирины Гордеевой 06.10.2026). Кандидаты на проверку человеком.';
