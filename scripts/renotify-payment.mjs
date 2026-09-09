// Разовая до-отправка Telegram-уведомления по платежу в ЗМКТЛ-чат.
// Нужна, когда платёж был переразобран/исправлен вручную и штатный крон
// уведомление уже не пошлёт (ретрай проброса делает ранний return).
// НЕ трогает RetailCRM — только шлёт сообщение (то же, что notify.ts для matched-ЗМКТЛ).
//
// Запуск (переменные — из прод-окружения Vercel):
//   TELEGRAM_PAYMENTS_BOT_TOKEN=xxx TELEGRAM_PAYMENTS_CHAT_ID=yyy \
//   [TELEGRAM_PAYMENTS_THREAD_ID=zzz] node scripts/renotify-payment.mjs 663
//
// DATABASE_URL и RETAILCRM_URL берутся из .env.local.

import fs from 'fs';
import postgres from 'postgres';

const id = process.argv[2];
if (!id) { console.error('Укажите id платежа: node scripts/renotify-payment.mjs <id>'); process.exit(1); }

const token = process.env.TELEGRAM_PAYMENTS_BOT_TOKEN;
const chatId = process.env.TELEGRAM_PAYMENTS_CHAT_ID;
const threadId = process.env.TELEGRAM_PAYMENTS_THREAD_ID;
if (!token || !chatId) {
  console.error('Нужны TELEGRAM_PAYMENTS_BOT_TOKEN и TELEGRAM_PAYMENTS_CHAT_ID (из Vercel env).');
  process.exit(1);
}

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = (env.match(/^(?:DATABASE_URL|POSTGRES_URL)=(.*)$/m) || [])[1].trim().replace(/^["']|["']$/g, '');
const crmBase = ((env.match(/^RETAILCRM_URL=(.*)$/m) || [])[1] || 'https://zmktlt.retailcrm.ru').trim().replace(/\/+$/, '');

const sql = postgres(dbUrl, { ssl: 'require' });
const [row] = await sql`select * from point_payments where id=${id}`;
if (!row) { console.error('Платёж не найден:', id); await sql.end(); process.exit(1); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const formatRub = (k) => `${(Number(k) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;

const SOURCE_LABELS = { tochka: 'Точка', tbank: 'Т-Банк' };
const lines = [];
lines.push(`💰 <b>Оплата · ${esc(SOURCE_LABELS[row.source] || row.source)}</b>`);
lines.push(`<b>${esc(formatRub(row.amount_kopecks))}</b>`);
const payer = row.payer_name ? esc(row.payer_name) + (row.payer_inn ? ` (ИНН ${esc(row.payer_inn)})` : '') : '—';
lines.push(`👤 Плательщик: ${payer}`);
if (row.recipient_name) lines.push(`🏢 Получатель: ${esc(row.recipient_name)}`);
if (row.payment_date) lines.push(`📅 ${esc(String(row.payment_date).slice(0, 10))}`);
if (row.purpose) {
  const p = row.purpose.length > 220 ? row.purpose.slice(0, 217) + '…' : row.purpose;
  lines.push(`📝 ${esc(p)}`);
}
if ((row.status === 'matched' || row.status === 'manual') && row.matched_order_number) {
  const link = row.matched_order_id
    ? `${crmBase}/orders/${row.matched_order_id}/edit`
    : `${crmBase}/orders/${encodeURIComponent(row.matched_order_number)}/edit?by=number`;
  const synced = row.retailcrm_synced_at ? ' — проброшен в RetailCRM' : '';
  lines.push(`✅ Заказ <a href="${link}">№${esc(row.matched_order_number)}</a>${synced}`);
} else {
  lines.push(`🟡 Требует ручного разбора`);
}

const body = { chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true };
if (threadId) body.message_thread_id = Number(threadId);

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) { console.error('Telegram error', res.status, text.slice(0, 400)); await sql.end(); process.exit(1); }

// Проставим notified_at, чтобы отметить факт отправки.
await sql`update point_payments set notified_at = now(), updated_at = now() where id=${id}`;
console.log('✅ Уведомление отправлено в ЗМКТЛ-чат по платежу', id);
await sql.end();
