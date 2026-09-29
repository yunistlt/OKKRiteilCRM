-- Маршруты уведомлений: тип сообщения → адресат.
-- Пустая таблица = дефолты из каталога (lib/notify/catalog.ts); строка появляется,
-- только когда человек поменял адресата в интерфейсе.
create table if not exists notification_routes (
  code        text primary key,
  target      text,
  chat_id     text,
  thread_id   text,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

comment on table notification_routes is 'Куда слать уведомления по типам сообщений (см. lib/notify/catalog.ts)';
comment on column notification_routes.target is 'Роль адресата: group_sales | owner_dm | manager_dm | accounting | project_stolyarka | project_consulting';
comment on column notification_routes.chat_id is 'Явный chat_id вместо адреса роли (необязательно)';
