-- ============================================================================
-- Группы компаний: несколько юрлиц одного покупателя — один клиент.
--
-- Решение владельца 06.10.2026: «у одного покупателя несколько юридических
-- лиц — ЗМК, ИП, УБТ, — но по сути это один клиент. Нужна сущность группы
-- компаний: продав любому лицу, засчитываем как один покупатель».
--
-- Чем это вызвано. Карточки клиента склеиваются по ИНН, и этого не хватает:
--   • у белорусов ИНН нет вовсе (у них УНП), поэтому «КлинПрофи» разошлась на
--     четыре карточки с 13 сделками, и заказ 54532 засчитался как вторая
--     покупка вместо тринадцатой (жалоба Евгении Матвеевой 06.10.2026);
--   • разные юрлица одного владельца по ИНН не склеить в принципе.
-- По всей базе 170 покупателей разложены на 392 карточки.
--
-- Группы ведут менеджеры руками: автоматического подбора нет — решение
-- владельца, «менеджеры сами постепенно создадут».
--
-- Карточки живут в двух таблицах (`customers` — из RetailCRM, `clients` —
-- наши), поэтому внешнего ключа на участника нет: храним номер карточки.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.company_groups (
    id          bigserial PRIMARY KEY,
    name        text NOT NULL,
    note        text,
    created_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_groups IS
    'Группа компаний: несколько юрлиц одного покупателя (решение владельца 06.10.2026).';

CREATE TABLE IF NOT EXISTS public.company_group_members (
    group_id   bigint NOT NULL REFERENCES public.company_groups(id) ON DELETE CASCADE,
    -- Номер карточки клиента: customers.id (из RetailCRM) или clients.id (наши).
    client_id  bigint NOT NULL,
    added_by   text,
    added_at   timestamptz NOT NULL DEFAULT now(),
    -- Карточка входит максимум в одну группу: иначе «кто покупатель» перестаёт
    -- быть однозначным и расчёты разъедутся.
    PRIMARY KEY (client_id)
);

CREATE INDEX IF NOT EXISTS company_group_members_group ON public.company_group_members(group_id);

COMMENT ON TABLE public.company_group_members IS
    'Карточки клиентов, входящие в группу компаний. Одна карточка — максимум в одной группе.';

-- ============================================================================
-- Кто покупатель: группа компаний сильнее склейки по ИНН.
--
-- Возвращаем наименьший номер карточки в группе — «главную». Так все, кто уже
-- ходит через эту функцию (зарплата, счётчик «новый/постоянный», отчёты),
-- продолжают работать без переделки.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.salary_canon_client(p_cust_id bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$
    SELECT COALESCE(
        (SELECT min(m2.client_id)
           FROM public.company_group_members m1
           JOIN public.company_group_members m2 ON m2.group_id = m1.group_id
          WHERE m1.client_id = p_cust_id),
        (SELECT c.canon_id FROM public.salary_client_canon c WHERE c.cust_id = p_cust_id),
        p_cust_id
    );
$function$;

COMMENT ON FUNCTION public.salary_canon_client(bigint) IS
    'Покупатель карточки: группа компаний (если заведена), иначе склейка по ИНН, иначе сама карточка.';
