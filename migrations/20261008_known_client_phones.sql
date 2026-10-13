-- ============================================================================
-- Какие из номеров записаны в карточках клиентов.
--
-- Требование владельца 08.10.2026: звонить из реестра звонков можно только на
-- номера, внесённые в карточку. В реестре попадаются автоответчики,
-- переадресации и чужие номера — набирать их кнопкой нельзя.
--
-- Почему функцией, а не запросом из кода: телефоны лежат массивами в двух
-- таблицах (`clients.phones` — телефоны компании, `customers.phones` —
-- контактные лица), а сравнивать их надо по ПОСЛЕДНИМ ДЕСЯТИ ЦИФРАМ: один и
-- тот же номер записан и как «+7 (995) 344-68-62», и как «89953446862».
-- Вытаскивать 31 тысячу карточек в приложение ради этого нельзя.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.known_client_phones(p_tails text[])
 RETURNS TABLE(tail text, client_id bigint, source text)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT DISTINCT ON (t.tail)
           t.tail,
           c.id AS client_id,
           'company'::text AS source
      FROM unnest(p_tails) AS t(tail)
      JOIN public.clients c ON TRUE
      JOIN LATERAL unnest(coalesce(c.phones, ARRAY[]::text[])) AS p(phone) ON TRUE
     WHERE right(regexp_replace(p.phone, '\D', '', 'g'), 10) = t.tail

    UNION ALL

    SELECT DISTINCT ON (t.tail)
           t.tail,
           cu.id AS client_id,
           'contact'::text AS source
      FROM unnest(p_tails) AS t(tail)
      JOIN public.customers cu ON TRUE
      JOIN LATERAL unnest(coalesce(cu.phones, ARRAY[]::text[])) AS p(phone) ON TRUE
     WHERE right(regexp_replace(p.phone, '\D', '', 'g'), 10) = t.tail;
$function$;

COMMENT ON FUNCTION public.known_client_phones(text[]) IS
    'Номера из карточек клиентов: сверка по последним десяти цифрам. Нужна кнопке «позвонить» в реестре звонков.';
