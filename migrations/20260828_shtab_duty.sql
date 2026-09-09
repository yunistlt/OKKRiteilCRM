-- Ответственные по программам и служебный доступ для консультанта ЦехУспеха.
--
-- Программы написаны, по ним назначаются ответственные, и человеку нужно
-- помогать их выполнять. Помогает консультант, который уже живёт в ЦехУспехе —
-- там, где начальник цеха работает каждый день. Штаб отдаёт ему данные, а голос
-- и характер остаются его.
--
-- Главное решение здесь: ответственный — это ПОСТ, а не строка с фамилией.
-- «Пост — не человек» прямо из методички: пока работа описана через людей,
-- организация держится на Сергее, и с его уходом функция исчезает вместе со
-- знанием о том, что она была. Программа закрепляется за постом, у поста есть
-- занимающий, у занимающего — учётка в ЦехУспехе. Уволился человек — программа
-- осталась на посту.
--
-- Миграция аддитивная и идемпотентная.

-- ── кто занимает пост в ЦехУспехе ─────────────────────────────────────────────
-- Идентификатор внешней системы, по которому консультант опознаёт вошедшего.
-- Чем именно он окажется — учётной записью, табельным номером или почтой, —
-- решает ЦехУспех; здесь это просто строка, и сравнивается она как есть.
ALTER TABLE public.shtab_post ADD COLUMN IF NOT EXISTS external_uid text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shtab_post_external_uid
    ON public.shtab_post (external_uid) WHERE external_uid IS NOT NULL;

COMMENT ON COLUMN public.shtab_post.external_uid IS
    'Идентификатор занимающего пост в ЦехУспехе. По нему консультант находит, чьи это задачи.';

-- ── программа закрепляется за постом ──────────────────────────────────────────
-- manager_name остаётся: он заполняется при написании программы, когда постов
-- ещё может не быть, и служит подсказкой при выборе поста. Но адресат помощи —
-- пост.
ALTER TABLE public.shtab_program ADD COLUMN IF NOT EXISTS post_id bigint
    REFERENCES public.shtab_post(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shtab_program_post ON public.shtab_program (post_id);

COMMENT ON COLUMN public.shtab_program.post_id IS
    'Пост, ведущий программу. Уволился человек — программа осталась на посту.';

-- ── что ответил исполнитель ───────────────────────────────────────────────────
-- Журналом, а не полем в задаче. Причина: «застрял на том-то» — это не состояние
-- задачи, а событие с текстом и временем, и таких событий по одной задаче бывает
-- несколько. Из них же собирается ответ на вопрос ежедневной планёрки «что
-- застряло» — по журналу видно, сколько дней оно уже стоит.
CREATE TABLE IF NOT EXISTS public.shtab_task_report (
    id         bigserial PRIMARY KEY,
    task_id    bigint NOT NULL REFERENCES public.shtab_task(id) ON DELETE CASCADE,
    -- done  — сделал; stuck — застрял; note — просто сказал что-то по задаче
    kind       text NOT NULL CHECK (kind IN ('done', 'stuck', 'note')),
    text       text NOT NULL DEFAULT '',
    -- кто отчитался: внешний идентификатор из ЦехУспеха, как есть
    reported_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_task_report_task ON public.shtab_task_report (task_id, created_at DESC);

COMMENT ON TABLE public.shtab_task_report IS
    'Что ответил исполнитель по задаче: сделал, застрял, сказал. Журнал, а не состояние.';

ALTER TABLE public.shtab_task_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shtab_task_report_service_role ON public.shtab_task_report;
CREATE POLICY shtab_task_report_service_role
    ON public.shtab_task_report FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.shtab_task_report TO postgres, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.shtab_task_report_id_seq TO postgres, service_role;

-- ── отметка о выполнении вместе с записью в журнал ────────────────────────────
-- Одной транзакцией: отметка без записи в журнал теряет объяснение, а запись без
-- отметки оставляет задачу висеть просроченной. Порознь они рано или поздно
-- разъедутся.
CREATE OR REPLACE FUNCTION public.shtab_task_report(
    p_task_id bigint,
    p_kind text,
    p_text text,
    p_by text
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    v_id bigint;
BEGIN
    INSERT INTO public.shtab_task_report (task_id, kind, text, reported_by)
    VALUES (p_task_id, p_kind, coalesce(p_text, ''), coalesce(p_by, ''))
    RETURNING id INTO v_id;

    -- Снимаем отметку при «застрял»: человек сказал, что задача не закрыта, и
    -- держать её выполненной значит врать сводке.
    UPDATE public.shtab_task
       SET done = (p_kind = 'done'),
           updated_at = now()
     WHERE id = p_task_id
       AND p_kind IN ('done', 'stuck');

    RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.shtab_task_report(bigint, text, text, text) IS
    'Записывает ответ исполнителя и приводит отметку о выполнении в соответствие. Одной транзакцией.';

-- ── знания по ремеслу ─────────────────────────────────────────────────────────
-- Консультант ЦехУспеха помогает не только напоминанием, но и по существу: как
-- замерить пропускную способность, как составить график ТО, что писать в
-- регламенте. Это отдельный вид знания: не методика управления, а как делается
-- конкретная работа. Отсюда новое значение в справочнике типов.
ALTER TABLE public.shtab_kb DROP CONSTRAINT IF EXISTS shtab_kb_type_check;
ALTER TABLE public.shtab_kb ADD CONSTRAINT shtab_kb_type_check
    CHECK (type IN ('methodology', 'framework', 'glossary', 'craft'));
