-- Живая Тамара: видеоролики по состояниям.
--
-- Картинка гардероба стоит неподвижно. Ролики — это та же Тамара во весь рост,
-- но она дышит, моргает и реагирует на разговор: ролик «покой» идёт по кругу,
-- ответ включает ролик своей ситуации, потом она возвращается в покой.
--
-- Ролик рисуется Kling под конкретный образ — одежда в видео впечатана, и
-- переодеть готовый ролик нельзя. Поэтому ролик привязан к образу гардероба.
-- Рисовать ролики под каждый образ дорого (40 кредитов штука), так что есть
-- «фирменный» образ для видео: если у образа дня своих роликов нет, Тамара
-- выходит в фирменном.
--
-- Фон с роликов снят заранее (scripts/tamara-clip-add.ts), в двух форматах:
-- WebM с прозрачностью — Chrome, Firefox, Edge; HEVC с прозрачностью — Safari.

CREATE TABLE IF NOT EXISTS public.tamara_clip (
    id            bigserial PRIMARY KEY,
    -- Образ гардероба, в котором снят ролик (tamara_wardrobe.slug).
    wardrobe_slug text NOT NULL,
    -- Состояние фигуры: idle | greet | explain | pleased — те же коды, что у
    -- фигуры в Штабе (app/shtab/Tamara.tsx, TamaraState).
    state         text NOT NULL,
    webm_url      text NOT NULL,
    hevc_url      text,
    poster_url    text NOT NULL,
    duration_ms   integer NOT NULL,
    -- Задание, по которому ролик нарисован, — чтобы перерисовать тем же.
    prompt        text NOT NULL DEFAULT '',
    active        boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (wardrobe_slug, state)
);

ALTER TABLE public.tamara_clip ENABLE ROW LEVEL SECURITY;

-- Рубильник и фирменный образ. Выключено — Тамара стоит картинкой, как раньше.
INSERT INTO public.shtab_settings (key, value, comment)
VALUES ('live_clips_enabled', 'true', 'Показывать ли живую Тамару роликами вместо картинки')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.shtab_settings (key, value, comment)
VALUES ('live_clips_outfit', 'terrakota-zhaket-sigarety',
        'Фирменный образ для роликов: в нём Тамара выходит, если у образа дня своих роликов нет')
ON CONFLICT (key) DO NOTHING;
