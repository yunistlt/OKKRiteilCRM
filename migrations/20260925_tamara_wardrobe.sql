-- Гардероб Тамары и наряд дня.
--
-- Образы хранятся готовыми картинками, а не заданиями на рисование. Причина
-- простая: один и тот же человек каждый день получается только при привязке к
-- постоянному субъекту Kling, а его ключ живёт не на проде. Поэтому образы
-- шьются заранее и вручную принимаются владельцем, а сервис лишь выбирает из
-- принятого — так на экран никогда не попадёт образ, который никто не видел.
--
-- Условия хранятся рядом с образом: пуховик не должен выпасть в июле, а
-- велокостюм — во вторник.

CREATE TABLE IF NOT EXISTS public.tamara_wardrobe (
    id          bigserial PRIMARY KEY,
    slug        text NOT NULL UNIQUE,
    title       text NOT NULL,
    image_url   text NOT NULL,
    -- Сезон: any | zima | vesna | leto | osen
    season      text NOT NULL DEFAULT 'any',
    -- День недели: any | budni | pyatnitsa | vyhodnoy
    weekday     text NOT NULL DEFAULT 'any',
    -- Границы температуры, при которых образ уместен. NULL — без границы.
    temp_min    integer,
    temp_max    integer,
    -- Дождь: NULL — всё равно, true — только в дождь, false — только без дождя.
    rain        boolean,
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Наряд дня. Дата — ключ: за один день образ один, сколько бы раз ни сработал
-- крон.
CREATE TABLE IF NOT EXISTS public.tamara_outfit_day (
    on_date      date PRIMARY KEY,
    wardrobe_id  bigint NOT NULL REFERENCES public.tamara_wardrobe(id) ON DELETE CASCADE,
    -- Почему выбран именно он — чтобы на вопрос «почему она сегодня такая»
    -- был ответ, а не догадка.
    reason       text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tamara_wardrobe_active_idx ON public.tamara_wardrobe (active);
CREATE INDEX IF NOT EXISTS tamara_outfit_day_wardrobe_idx ON public.tamara_outfit_day (wardrobe_id);

-- Рубильник. Выключенный гардероб возвращает Тамару к прежнему виду.
INSERT INTO public.shtab_settings (key, value, comment)
VALUES ('outfit_enabled', 'true', 'Менять ли Тамаре одежду каждый день')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.tamara_wardrobe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tamara_outfit_day ENABLE ROW LEVEL SECURITY;

-- Приветствие дня.
--
-- Хранится, а не сочиняется при каждом заходе: анекдот, меняющийся при каждом
-- обновлении страницы, перестаёт быть встречей и становится лентой. Один день
-- — одно приветствие, как у живого человека.
CREATE TABLE IF NOT EXISTS public.tamara_greeting (
    on_date     date PRIMARY KEY,
    text        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tamara_greeting ENABLE ROW LEVEL SECURITY;

INSERT INTO public.shtab_settings (key, value, comment)
VALUES ('greeting_enabled', 'true', 'Здороваться ли при первом заходе в разговор за день')
ON CONFLICT (key) DO NOTHING;

-- Задание, по которому образ был сшит.
--
-- Хранится рядом с картинкой, чтобы владелец мог поправить формулировку сам, не
-- обращаясь к разработчику: «слишком мешковато» лечится строкой в промпте, а не
-- выкаткой кода.
ALTER TABLE public.tamara_wardrobe ADD COLUMN IF NOT EXISTS prompt text NOT NULL DEFAULT '';

-- Неизменная часть задания: она одна на все образы и отвечает не за одежду, а
-- за то, что на кадре та же женщина, стоящая так же. Вынесена отдельно, чтобы
-- не повторять её в каждом образе и не разъехаться по мелочи.
INSERT INTO public.shtab_settings (key, value, comment) VALUES
    ('outfit_base_prompt',
     'Женщина <<<ЭЛЕМЕНТ>>> в полный рост, строго фронтально, руки спокойно опущены вдоль тела. Фигура подтянутая. Силуэт чёткий и подогнанный по фигуре, ничего мешковатого и оверсайз. Лицо, причёска и телосложение — в точности как на 图片1, без изменений. Ровный студийный свет, однотонный светло-серый фон, фотореалистично.',
     'Общая часть задания на отрисовку: кто на кадре и как снят. Одежда задаётся отдельно в каждом образе'),
    ('outfit_element_id', '322314495682213', 'Постоянный субъект Kling: им держится одно и то же лицо и фигура')
ON CONFLICT (key) DO NOTHING;

-- Кадр, нарисованный этой ночью.
--
-- Отдельно от картинки образа: задание одно, а кадр каждый раз новый — так
-- утро не повторяется, даже когда образ тот же. Пусто — значит отрисовка не
-- сработала, и показывается принятый кадр из гардероба.
ALTER TABLE public.tamara_outfit_day ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.tamara_outfit_day ADD COLUMN IF NOT EXISTS draw_error text;

INSERT INTO public.shtab_settings (key, value, comment)
VALUES ('outfit_reference_url', '', 'Эталонный кадр: с него берутся лицо и телосложение при ночной отрисовке')
ON CONFLICT (key) DO NOTHING;

-- Образ может жить одним заданием, без принятого кадра.
--
-- Так заводится новая вещь, когда ночная отрисовка работает: владелец пишет
-- «дирндль, праздничный», и утром это уже надето. Пока отрисовки нет, такие
-- образы просто не выпадают — показывать нечего.
ALTER TABLE public.tamara_wardrobe ALTER COLUMN image_url DROP NOT NULL;
