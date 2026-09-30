-- Вид знания «schema»: снимок строения внешней базы.
--
-- Отдельным видом, а не в составе 'craft', по существу разницы: методичку и
-- ремесло пишет человек и они живут годами, а это снимок чужой базы, который
-- каждую ночь пересобирает крон /api/cron/tseh-schema-kb. По типу их надо уметь
-- различать — хотя бы чтобы видеть в админке, что рукописного тут ничего нет.
ALTER TABLE public.shtab_kb DROP CONSTRAINT IF EXISTS shtab_kb_type_check;
ALTER TABLE public.shtab_kb ADD CONSTRAINT shtab_kb_type_check
    CHECK (type IN ('methodology', 'framework', 'glossary', 'craft', 'schema'));
