-- Чья задача: поставил человек или сама система.
--
-- Елена Парфёнова 28.10.2026: «Просим добавить сюда задачи СВОИ, которые создал
-- менеджер». Во вкладке «Задачи» нужен отбор «мои / системные», а в общем списке
-- свою задачу видно цветом.
--
-- Отличить их по полю «кто поставил» было нельзя: системную задачу про ИНН
-- система подписывала именем того, кто в этот момент менял статус заказа —
-- в базе такие задачи числятся за Екатериной, Ириной, Еленой и Евгенией.
-- Поэтому источник пишем отдельной колонкой, а кто поставил — ещё и
-- идентификатором пользователя, а не только текстом имени: имя у одного
-- человека успело смениться с почты на фамилию.

ALTER TABLE public.order_tasks
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manager',
    ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;

ALTER TABLE public.order_tasks DROP CONSTRAINT IF EXISTS order_tasks_source_check;
ALTER TABLE public.order_tasks ADD CONSTRAINT order_tasks_source_check
    CHECK (source IN ('manager', 'system'));

-- Восемь задач про ИНН, поставленных системой до появления колонки.
UPDATE public.order_tasks
   SET source = 'system'
 WHERE title = 'Уточнить у клиента ИНН и внести в карточку'
   AND source <> 'system';

COMMENT ON COLUMN public.order_tasks.source IS 'Кто поставил задачу: manager — человек, system — сама система';
COMMENT ON COLUMN public.order_tasks.created_by_user_id IS 'Пользователь, поставивший задачу; у задач до 01.11.2026 пусто';
