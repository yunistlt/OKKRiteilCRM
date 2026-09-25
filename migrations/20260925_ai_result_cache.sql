-- Кэш результатов LLM-вызовов по отпечатку входных данных.
--
-- Зачем: агенты переразбирают одни и те же неизменившиеся объекты (заказ, расшифровку
-- звонка) на каждом прогоне очереди. Сентябрь 2026: 203 119 вызовов gpt-4o-mini на
-- 30 835 заказов и 1 326 расшифровок — деньги за повторный разбор того же текста.
--
-- Ключ — sha256 от (purpose + системный промпт + пользовательский промпт), поэтому
-- правка промпта автоматически обесценивает старые записи: пересчёт произойдёт сам.
create table if not exists ai_result_cache (
    cache_key   text primary key,
    purpose     text not null,
    result      jsonb not null,
    hits        integer not null default 0,
    created_at  timestamptz not null default now(),
    last_hit_at timestamptz
);

create index if not exists ai_result_cache_purpose_idx on ai_result_cache (purpose, created_at desc);
