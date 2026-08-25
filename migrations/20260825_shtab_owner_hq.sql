-- «Штаб владельца» — рабочее место собственника по методологии «Альянс Стратег».
--
-- Реестр минусов, разборы ситуации, карты ресурсов, стратегии и цели. До сих пор
-- всё это жило в localStorage макета: инструмент был привязан к одному браузеру и
-- терялся при чистке кэша. Здесь появляется место хранения.
--
-- Штаб один на компанию: строки не привязаны к пользователю, раздел закрыт ролью
-- admin в lib/rbac.ts. Разрезать по владельцам, если понадобится, дешевле потом,
-- чем сейчас тащить лишний ключ через все запросы.
--
-- Коды технические, подписи в справочниках. В логике сравнивать можно только
-- code/source/status, русские строки берутся из таблиц (.agent/workflows/constraints.md).
--
-- Миграция аддитивная и идемпотентная: повторный прогон не падает и не плодит дубли.

-- ── справочник областей ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shtab_area (
    code    text PRIMARY KEY,
    title   text NOT NULL,
    ordinal int  NOT NULL DEFAULT 100
);

COMMENT ON TABLE public.shtab_area IS
    'Области компании для разложения минусов. Порядок ordinal — порядок вывода в реестре.';

INSERT INTO public.shtab_area (code, title, ordinal) VALUES
    ('production', 'Производство', 1),
    ('management', 'Управление', 2),
    ('finance', 'Финансы', 3),
    ('ai', 'Внедрение ИИ в бизнес-процессы', 4),
    ('sales', 'Продажи', 5),
    ('hr', 'HR', 6),
    ('procurement', 'Закупки', 7),
    ('engineering', 'Разработка КД', 8),
    ('marketing', 'Маркетинг', 9),
    ('legal', 'Юридический отдел', 10),
    ('accounting', 'Бухгалтерия', 11)
ON CONFLICT (code) DO NOTHING;

-- ── реестр минусов ─────────────────────────────────────────────────────────────
-- Минус — зафиксированное отклонение от желаемого. Область с наибольшим числом
-- открытых минусов становится приоритетной; счёт идёт по строкам, мнения в
-- расчёте не участвуют.
CREATE TABLE IF NOT EXISTS public.shtab_minus (
    id          bigserial PRIMARY KEY,
    text        text NOT NULL,
    area_code   text NOT NULL REFERENCES public.shtab_area(code),
    -- откуда пришёл: owner — владелец записал сам, data — посчитано по данным,
    -- telegram — одной строкой из бота
    source      text NOT NULL DEFAULT 'owner'
                CHECK (source IN ('owner', 'data', 'telegram')),
    occurred_on date NOT NULL DEFAULT CURRENT_DATE,
    done        boolean NOT NULL DEFAULT false,
    done_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_minus_area_open
    ON public.shtab_minus (area_code) WHERE NOT done;

COMMENT ON TABLE public.shtab_minus IS
    'Реестр минусов компании. Приоритетная область считается по числу строк с done = false.';

-- ── разборы ────────────────────────────────────────────────────────────────────
-- Разбор ведётся по методичке: ситуация → почему (с тремя проверками) →
-- краткосрочная цель из двух частей → карта ресурсов → стратегия повествованием.
-- Проверки трёхзначны: true — прошла, false — не прошла, NULL — ещё не отвечено.
CREATE TABLE IF NOT EXISTS public.shtab_razbor (
    id            bigserial PRIMARY KEY,
    area_code     text NOT NULL REFERENCES public.shtab_area(code),
    status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'done')),
    minus_id      bigint REFERENCES public.shtab_minus(id) ON DELETE SET NULL,
    situation     text NOT NULL DEFAULT '',
    why           text NOT NULL DEFAULT '',
    check_inside  boolean,   -- причина внутри организации
    check_res     boolean,   -- устранима имеющимися ресурсами
    check_relief  boolean,   -- её устранение даёт облегчение
    goal_fix      text NOT NULL DEFAULT '',   -- часть цели: устранить
    goal_grow     text NOT NULL DEFAULT '',   -- часть цели: нарастить
    strategy      text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_razbor_area ON public.shtab_razbor (area_code);
CREATE INDEX IF NOT EXISTS idx_shtab_razbor_status ON public.shtab_razbor (status);

COMMENT ON TABLE public.shtab_razbor IS
    'Разборы ситуации. check_* трёхзначны: NULL — владелец ещё не отвечал на проверку.';

-- ── карта ресурсов ─────────────────────────────────────────────────────────────
-- Колонка карты: один отсутствующий ресурс (розовая карточка) и доступные,
-- которыми его добывают (голубые). Порядок колонок — это последовательность шагов.
CREATE TABLE IF NOT EXISTS public.shtab_resource (
    id        bigserial PRIMARY KEY,
    razbor_id bigint NOT NULL REFERENCES public.shtab_razbor(id) ON DELETE CASCADE,
    ordinal   int  NOT NULL DEFAULT 0,
    missing   text NOT NULL DEFAULT '',
    available text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_shtab_resource_razbor
    ON public.shtab_resource (razbor_id, ordinal);

COMMENT ON TABLE public.shtab_resource IS
    'Колонки карты ресурсов: missing — отсутствующий ресурс, available — чем его добывают.';

-- ── цели ───────────────────────────────────────────────────────────────────────
-- Три долгосрочные цели верхнего уровня. Строк ровно три, kind — ключ.
CREATE TABLE IF NOT EXISTS public.shtab_goal (
    kind       text PRIMARY KEY CHECK (kind IN ('company', 'owner', 'product')),
    text       text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.shtab_goal (kind, text) VALUES
    ('company', ''),
    ('owner',   ''),
    ('product', '')
ON CONFLICT (kind) DO NOTHING;

COMMENT ON TABLE public.shtab_goal IS
    'Долгосрочные цели: company — куда идёт компания, owner — чего хочет владелец, product — ЦКП.';

-- ── сид реестра минусов ────────────────────────────────────────────────────────
-- 42 минуса, снятые с Андрея на разборе. Заливаются один раз: если в таблице уже
-- что-то есть, блок не выполняется — иначе закрытые минусы воскресали бы при
-- каждом повторном прогоне.
DO $shtab_seed$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.shtab_minus) THEN
        INSERT INTO public.shtab_minus (text, area_code, source) VALUES
    ('Много рекламаций', 'production', 'data'),
    ('Срыв сроков отгрузки', 'production', 'data'),
    ('Высокая дебиторская задолженность', 'production', 'data'),
    ('Низкая дисциплина в цеху', 'production', 'owner'),
    ('Беспорядок в цеху', 'production', 'owner'),
    ('Мало постоянных клиентов', 'production', 'data'),
    ('Нет видеоконтроля за производственным помещением', 'production', 'owner'),
    ('Нет журналов проведения инструктажей по ТБ', 'production', 'owner'),
    ('Нет плана проведения ТО для каждого станка', 'production', 'owner'),
    ('Долгие сроки решения рекламаций', 'production', 'data'),
    ('Сломан гибочный станок', 'production', 'telegram'),
    ('Не запущен второй лазерный станок', 'production', 'owner'),
    ('Низкая скорость прохождения заказов через окрасочный участок', 'production', 'data'),
    ('Персонал в цеху обедает на рабочих местах', 'production', 'telegram'),
    ('Просроченная кредиторская задолженность', 'management', 'data'),
    ('Заблокированный счёт в банке', 'management', 'data'),
    ('Низкая чистая прибыль', 'management', 'data'),
    ('Неполноценная система планёрок', 'management', 'owner'),
    ('Нет службы безопасности', 'management', 'owner'),
    ('Команда не поставлена на цель', 'management', 'owner'),
    ('Неправильная мотивация начальника цеха', 'management', 'owner'),
    ('Нет устоявшегося коллектива в конструкторском бюро', 'management', 'owner'),
    ('Кассовые разрывы', 'finance', 'data'),
    ('Отсутствие резервов', 'finance', 'data'),
    ('Нет регулярной финансовой отчётности', 'finance', 'owner'),
    ('Не утверждается бюджет на месяц', 'finance', 'owner'),
    ('Некорректно работает бот расчёта стоимости продукции', 'ai', 'data'),
    ('Некорректно работает бот ОКК отдела продаж', 'ai', 'data'),
    ('Не работает бот активации старых клиентов', 'ai', 'owner'),
    ('Не работает бот согласования договоров', 'ai', 'owner'),
    ('Не используются механики повышения среднего чека и допродаж', 'sales', 'data'),
    ('Несоблюдение скриптов продаж', 'sales', 'data'),
    ('Низкая конверсия в продажу', 'sales', 'data'),
    ('Неукомплектованный штат', 'hr', 'owner'),
    ('Нет подписанных договоров и должностных инструкций', 'hr', 'owner'),
    ('Отсутствует график отпусков', 'hr', 'owner'),
    ('Отсутствие складского учёта', 'procurement', 'owner'),
    ('Закупка неиспользуемых комплектующих', 'procurement', 'data'),
    ('Низкое качество КД', 'engineering', 'data'),
    ('Низкое качество конструкторских решений', 'engineering', 'owner'),
    ('Мало заказов', 'marketing', 'data'),
    ('Отсутствие реестра договоров', 'legal', 'owner');
    END IF;
END
$shtab_seed$;

-- ── замена карты ресурсов одной транзакцией ────────────────────────────────────
-- Колонки карты приходят с клиента целиком и перезаписываются: их переставляют и
-- удаляют, диффать построчно дороже и ошибочнее. Но «удалить, потом вставить»
-- двумя отдельными запросами означает, что сбой между ними стирает работу
-- владельца. Тело функции выполняется в одной транзакции, поэтому либо встанет
-- новый набор, либо останется старый.
CREATE OR REPLACE FUNCTION public.shtab_set_resources(p_razbor_id bigint, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    DELETE FROM public.shtab_resource WHERE razbor_id = p_razbor_id;

    INSERT INTO public.shtab_resource (razbor_id, ordinal, missing, available)
    SELECT p_razbor_id,
           (ord - 1)::int,
           COALESCE(item->>'missing', ''),
           COALESCE(
               ARRAY(SELECT jsonb_array_elements_text(item->'available')),
               ARRAY[]::text[]
           )
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) WITH ORDINALITY AS t(item, ord);
END
$function$;

COMMENT ON FUNCTION public.shtab_set_resources(bigint, jsonb) IS
    'Перезаписывает карту ресурсов разбора целиком. Порядок колонок — порядок элементов массива.';
