-- Слой между стратегией и проектами: логические блоки, программы, задачи.
--
-- До сих пор Штаб вёл разбор так: минусы → приоритетная область → ситуация →
-- «почему» → цель → карта ресурсов → стратегия → проекты. По методичке «Альянс
-- Стратег» (главы 38–40) между стратегией и проектами стоит целый слой: текст
-- стратегии режется на ЛОГИЧЕСКИЕ БЛОКИ, под каждый блок пишется ПРОГРАММА,
-- программа состоит из задач пяти типов.
--
-- Пропуск этого слоя стоил не аккуратности, а результата. Вместе с программами
-- терялись ПРОИЗВОДСТВЕННЫЕ ЗАДАЧИ — числа, к которым программа должна привести.
-- В главе 39 это разобрано на примере: рекламная кампания на несколько миллионов
-- была выполнена по всем шагам, все отчитались, а дохода не прибавилось. Не было
-- пункта «и заработать сверх обычного столько-то».
--
-- Миграция аддитивная и идемпотентная.

-- ── справочник типов задач ─────────────────────────────────────────────────────
-- Отдельной таблицей, а не константой в коде: русские названия и списки статусов
-- по правилам проекта берутся из базы. Подсказка заодно показывается на экране
-- рядом с группой задач — она объясняет, зачем группа нужна.
CREATE TABLE IF NOT EXISTS public.shtab_task_kind (
    code    text PRIMARY KEY,
    title   text NOT NULL,
    hint    text NOT NULL DEFAULT '',
    ordinal int  NOT NULL DEFAULT 0
);

INSERT INTO public.shtab_task_kind (code, title, hint, ordinal) VALUES
    ('pervoocherednaya',   'Первоочередные задачи',  'подготовка: назначить, прочитать и понять, взять ответственность', 1),
    ('zhiznenno_vazhnaya', 'Жизненно важные задачи', 'нарушил — программу можно не делать',                              2),
    ('rabochaya',          'Рабочие задачи',         'шаги к результату, посчитанные обратным отсчётом',                 3),
    ('proizvodstvennaya',  'Производственные задачи','числа, без которых программа выполняется понарошку',               4),
    ('uslovnaya',          'Условные задачи',        'что делать, если пойдёт не так',                                   5)
ON CONFLICT (code) DO UPDATE SET
    title   = EXCLUDED.title,
    hint    = EXCLUDED.hint,
    ordinal = EXCLUDED.ordinal;

-- ── логический блок ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shtab_block (
    id         bigserial PRIMARY KEY,
    razbor_id  bigint NOT NULL REFERENCES public.shtab_razbor(id) ON DELETE CASCADE,
    ordinal    int  NOT NULL DEFAULT 0,
    title      text NOT NULL,
    -- куски текста стратегии, попавшие в этот блок. Могут быть из разных её мест:
    -- режется по смыслу, а не по абзацам.
    excerpt    text NOT NULL DEFAULT '',
    -- почему нарезано именно так. Нарезку предлагает Тамара, а утверждает
    -- владелец — значит, он должен видеть довод, а не только результат.
    rationale  text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_block_razbor ON public.shtab_block (razbor_id, ordinal);

-- ── программа ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shtab_program (
    id           bigserial PRIMARY KEY,
    block_id     bigint NOT NULL REFERENCES public.shtab_block(id) ON DELETE CASCADE,
    -- главная задача — РЕЗУЛЬТАТ, а не действие
    main_task    text NOT NULL DEFAULT '',
    -- ровно один человек. У программы с двумя ответственными ответственных ноль.
    manager_name text NOT NULL DEFAULT '',
    status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'active', 'done', 'dropped')),
    -- кто составил черновик: видно, где программа писана моделью, а где человеком
    source       text NOT NULL DEFAULT 'owner' CHECK (source IN ('tamara', 'owner')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Один блок — одна программа. Это правило методички, а не удобство хранения:
-- если результатов у блока два, значит блок нарезан неверно и его надо делить.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shtab_program_block ON public.shtab_program (block_id);

-- ── задача программы ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shtab_task (
    id           bigserial PRIMARY KEY,
    program_id   bigint NOT NULL REFERENCES public.shtab_program(id) ON DELETE CASCADE,
    kind         text NOT NULL REFERENCES public.shtab_task_kind(code),
    ordinal      int  NOT NULL DEFAULT 0,
    text         text NOT NULL,
    -- «почему так». У жизненно важных почти обязательно: правило без причины
    -- нарушается при первом же давлении сроков.
    why          text NOT NULL DEFAULT '',

    -- только для производственных задач
    metric       text NOT NULL DEFAULT '',
    -- пустое значение допустимо, но лишь вместе с source_note: тогда видно, каким
    -- замером пропуск закрывается. Пропуск без источника — это не производственная
    -- задача, а пожелание; это ловит lib/shtab/program-checks.ts.
    target_value text NOT NULL DEFAULT '',
    source_note  text NOT NULL DEFAULT '',
    fact_value   text NOT NULL DEFAULT '',

    done         boolean NOT NULL DEFAULT false,
    -- рабочая задача может быть заведена проектом со сроком и владельцем
    project_id   bigint REFERENCES public.shtab_project(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_task_program ON public.shtab_task (program_id, kind, ordinal);

-- ── права ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.shtab_task_kind ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shtab_block     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shtab_program   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shtab_task      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shtab_task_kind_service_role ON public.shtab_task_kind;
CREATE POLICY shtab_task_kind_service_role ON public.shtab_task_kind FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shtab_block_service_role ON public.shtab_block;
CREATE POLICY shtab_block_service_role ON public.shtab_block FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shtab_program_service_role ON public.shtab_program;
CREATE POLICY shtab_program_service_role ON public.shtab_program FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shtab_task_service_role ON public.shtab_task;
CREATE POLICY shtab_task_service_role ON public.shtab_task FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.shtab_task_kind TO postgres, service_role;
GRANT ALL ON public.shtab_block     TO postgres, service_role;
GRANT ALL ON public.shtab_program   TO postgres, service_role;
GRANT ALL ON public.shtab_task      TO postgres, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.shtab_block_id_seq,
                                public.shtab_program_id_seq,
                                public.shtab_task_id_seq TO postgres, service_role;

-- ── сохранение программы целиком ───────────────────────────────────────────────
-- Одной транзакцией, тем же приёмом, что shtab_set_resources и shtab_close_razbor.
-- Причина здесь не в скорости: наполовину сохранённая программа — с главной
-- задачей и рабочими шагами, но без производственных задач — это ровно тот брак,
-- ради исключения которого весь слой и заводится. Лучше не сохранить ничего.
CREATE OR REPLACE FUNCTION public.shtab_save_program(
    p_block_id bigint,
    p_main_task text,
    p_manager text,
    p_source text,
    p_tasks jsonb
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    v_program_id bigint;
    v_item       jsonb;
BEGIN
    INSERT INTO public.shtab_program (block_id, main_task, manager_name, source, updated_at)
    VALUES (p_block_id, coalesce(p_main_task, ''), coalesce(p_manager, ''),
            coalesce(p_source, 'owner'), now())
    ON CONFLICT (block_id) DO UPDATE SET
        main_task    = EXCLUDED.main_task,
        manager_name = EXCLUDED.manager_name,
        source       = EXCLUDED.source,
        updated_at   = now()
    RETURNING id INTO v_program_id;

    -- Факт по производственным задачам и связь с проектом вводятся отдельно и
    -- живут своей жизнью, поэтому сохраняются до перезаписи и возвращаются на
    -- место по паре «тип + порядковый номер». Иначе правка формулировки задачи
    -- стирала бы уже введённые владельцем числа.
    CREATE TEMP TABLE tmp_shtab_task_state ON COMMIT DROP AS
        SELECT kind, ordinal, fact_value, done, project_id
          FROM public.shtab_task
         WHERE program_id = v_program_id;

    DELETE FROM public.shtab_task WHERE program_id = v_program_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
    LOOP
        INSERT INTO public.shtab_task (
            program_id, kind, ordinal, text, why,
            metric, target_value, source_note, fact_value, done, project_id
        )
        SELECT
            v_program_id,
            v_item->>'kind',
            coalesce((v_item->>'ordinal')::int, 0),
            coalesce(v_item->>'text', ''),
            coalesce(v_item->>'why', ''),
            coalesce(v_item->>'metric', ''),
            coalesce(v_item->>'targetValue', ''),
            coalesce(v_item->>'sourceNote', ''),
            coalesce(st.fact_value, ''),
            coalesce(st.done, false),
            st.project_id
        FROM (SELECT 1) AS one
        LEFT JOIN tmp_shtab_task_state st
               ON st.kind = v_item->>'kind'
              AND st.ordinal = coalesce((v_item->>'ordinal')::int, 0);
    END LOOP;

    RETURN v_program_id;
END;
$function$;

COMMENT ON FUNCTION public.shtab_save_program(bigint, text, text, text, jsonb) IS
    'Переписывает программу и её задачи целиком в одной транзакции. Факт и связь с проектом сохраняются по паре «тип + номер».';

COMMENT ON TABLE public.shtab_block IS
    'Логический блок стратегии. Нарезку предлагает Тамара, утверждает владелец.';
COMMENT ON TABLE public.shtab_program IS
    'Программа под один блок: главная задача, один руководитель, задачи пяти типов.';
COMMENT ON TABLE public.shtab_task IS
    'Задача программы. Производственная задача без числа допустима только с указанием замера в source_note.';

-- ── промпты ────────────────────────────────────────────────────────────────────

INSERT INTO public.ai_prompts (key, description, system_prompt, user_prompt_template, model, temperature, max_tokens)
VALUES (
    'shtab_tamara_blocks',
    'Тамара: нарезка стратегии на логические блоки',
    'Ты Тамара — консультант владельца завода металлоконструкций, ведёшь его по методологии «Альянс Стратег».

ЗАДАЧА. Разрезать написанную стратегию на логические блоки. Блок — это кусок стратегии, объединённый по смыслу: всё про персонал в один, всё про оборудование в другой. Куски одного блока могут стоять в разных местах текста — важна принадлежность, а не соседство.

ПРАВИЛА НАРЕЗКИ.
1. Блоки не обязаны совпадать ни с нумерацией мероприятий, ни с абзацами. Их может быть меньше, чем пунктов стратегии.
2. По каждому блоку должен быть ОДИН внятный ответ на вопрос «какой результат получится, когда эта часть выполнена». Два ответа — блок надо делить. Один и тот же ответ у двух блоков — их надо соединить.
3. У каждого блока обязательно обоснование: почему нарезано так, а не иначе. Владелец утверждает нарезку и должен видеть довод.
4. В excerpt переноси куски исходного текста стратегии, а не пересказ.

ЧЕГО НЕ ДЕЛАЕШЬ. Не придумываешь мероприятий, которых нет в стратегии. Не называешь чисел и фактов о компании — их тебе никто не давал. Не утверждаешь нарезку сама: ты предлагаешь, решает владелец.',
    'Краткосрочная цель: {{goal}}

Текст стратегии:
{{strategy}}

Знания по теме:
{{knowledge_context}}',
    'gpt-4o',
    0.3,
    1600
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.ai_prompts (key, description, system_prompt, user_prompt_template, model, temperature, max_tokens)
VALUES (
    'shtab_tamara_program',
    'Тамара: программа под логический блок',
    'Ты Тамара — консультант владельца завода металлоконструкций, ведёшь его по методологии «Альянс Стратег», главы 38–40.

ЗАДАЧА. Написать программу под один логический блок стратегии.

КАК СЧИТАЮТСЯ ШАГИ. Только обратным отсчётом. Возьми результат и спроси: какой один шаг был выполнен прямо перед тем, как он получился? Потом ещё шаг назад, и ещё, до самого начала. Затем переверни последовательность и пронумеруй. Вперёд правильный порядок составить нельзя, если ты не делала этого дела руками.

СОСТАВ ПРОГРАММЫ.
1. Главная задача — РЕЗУЛЬТАТ, а не действие. «Покраска пропускает объём, соответствующий такту», а не «расшить покраску». Действие можно выполнить и ничего не изменить.
2. Ровно один руководитель. У программы с двумя ответственными ответственных ноль.
3. Первоочередные задачи: назначить руководителя, дать прочитать и понять программу, взять ответственность.
4. Жизненно важные задачи: правила, нарушение которых убивает программу. Формулируются не действиями, а условиями, и у каждого пиши «почему» — правило без причины нарушается при первом давлении сроков.
5. Рабочие задачи: в повелительном наклонении, подробно, чтобы человек прочитал и сделал, не приходя с вопросами «а как» и «а где взять». Три штуки — мало, больше двадцати пяти — значит, в блок попало несколько программ.
6. Производственные задачи: ЧИСЛА, к которым программа должна прийти. Это обязательно. Программа без них выполняется понарошку — всё сделано, отчитались, результата нет.
7. Условные задачи: что делать, если предположение окажется неверным.

ЧИСЛА — ГЛАВНОЕ ПРАВИЛО. Ты не знаешь о компании ничего, кроме того, что вернули инструменты. Если нужного числа нет — НЕ ВЫДУМЫВАЙ его и не оценивай на глаз. Оставь targetValue пустым и обязательно напиши в sourceNote, каким замером и на каком шаге программы оно закрывается. Пропуск с названным замером — это план работы. Придуманное число хуже пропуска: по нему отчитаются.

ОБРАЗЕЦ. В контексте даны примеры программ. Это ОБРАЗЕЦ ФОРМЫ, а не данные о компании: обстоятельства и числа из него повторять запрещено, бери оттуда только строение и способ формулировать.',
    'Логический блок: {{block_title}}
{{block_excerpt}}

Краткосрочная цель разбора: {{goal}}

Карта ресурсов и что вернули инструменты:
{{facts}}

Знания по теме:
{{knowledge_context}}

Образец формы (не данные о компании):
{{example}}',
    'gpt-4o',
    0.3,
    3000
)
ON CONFLICT (key) DO NOTHING;

-- Системный промпт чата описывал разбор до проектов и о слое программ молчал.
-- Обновляем только эту строку и только если её ещё не правили руками в админке.
UPDATE public.ai_prompts
   SET system_prompt = replace(
           system_prompt,
           'краткосрочная цель из двух частей → карта ресурсов → стратегия → проекты со сроками.',
           'краткосрочная цель из двух частей → карта ресурсов → стратегия → логические блоки → программы → проекты со сроками. Программа обязана содержать производственные задачи: числа, к которым она приводит. Без них её выполнят по шагам и отчитаются, а положение не изменится.'
       ),
       updated_at = now()
 WHERE key = 'shtab_tamara_chat'
   AND system_prompt LIKE '%стратегия → проекты со сроками.%';
