-- Пояснение к выполненной доработке: что именно исправлено и в какой сборке.
--
-- Задание владельца 15.10.2026: «то что сделал ставь отметку и пояснения что
-- было исправлено, пиши чётко, без лирики — менеджеры должны иметь
-- возможность читать твои пояснения».
--
-- Своё поле каждому значению: текст пояснения и номер сборки — разные вещи,
-- в одну строку их не склеиваем.
alter table improvements add column if not exists done_note text;
alter table improvements add column if not exists done_build text;

comment on column improvements.done_note is 'Что исправлено — человеческим языком, для менеджера';
comment on column improvements.done_build is 'Короткий хеш сборки, в которой правка уехала на прод';
