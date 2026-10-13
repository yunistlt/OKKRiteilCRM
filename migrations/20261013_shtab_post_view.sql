-- Схема постов: цвет, уровень и сворачивание ветки задаются руками.
--
-- Цвет и уровень до сих пор вычислялись по дереву. Этого мало: владелец хочет
-- выделять посты по своему смыслу (например, вакансии или проблемные участки),
-- а не только по глубине подчинения. NULL в обоих полях означает «как раньше,
-- по дереву» — поэтому поля добавляются пустыми и ничего не ломают.
--
-- collapsed хранится в базе, а не в браузере: свёрнутая ветка — это способ
-- смотреть на структуру, он должен быть один на всех устройствах владельца.

ALTER TABLE public.shtab_post
    ADD COLUMN IF NOT EXISTS color text,
    ADD COLUMN IF NOT EXISTS level_override smallint,
    ADD COLUMN IF NOT EXISTS collapsed boolean NOT NULL DEFAULT false;

ALTER TABLE public.shtab_post
    DROP CONSTRAINT IF EXISTS shtab_post_color_check;
ALTER TABLE public.shtab_post
    ADD CONSTRAINT shtab_post_color_check
    CHECK (color IS NULL OR color IN ('blue', 'green', 'clay', 'sand', 'grey', 'white'));

ALTER TABLE public.shtab_post
    DROP CONSTRAINT IF EXISTS shtab_post_level_check;
ALTER TABLE public.shtab_post
    ADD CONSTRAINT shtab_post_level_check
    CHECK (level_override IS NULL OR level_override BETWEEN 0 AND 3);

COMMENT ON COLUMN public.shtab_post.color IS 'Цвет блока на схеме; NULL — по уровню подчинения';
COMMENT ON COLUMN public.shtab_post.level_override IS 'Уровень для окраски вручную; NULL — считать по дереву';
COMMENT ON COLUMN public.shtab_post.collapsed IS 'Ветка свёрнута: подчинённые на схеме не показываются';
