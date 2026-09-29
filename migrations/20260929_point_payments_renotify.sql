-- Досылка уведомления по платежу: человек просит бота отправить сообщение заново
-- (уведомление ушло не в тот чат или не ушло вовсе — например, после ручной привязки).
-- Флаг снимает воркер после отправки, поэтому «отправить ещё раз» = поставить метку.
alter table point_payments
  add column if not exists renotify_requested_at timestamptz;

comment on column point_payments.renotify_requested_at is 'Просьба переотправить уведомление; воркер отправит и обнулит';
