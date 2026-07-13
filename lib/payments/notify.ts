import type { PointPaymentRow } from './service';
import { kopecksToRubles } from './types';

// Уведомление об оплате в Telegram через отдельного бота (@okkzmk_bot).
// Не пересекается с алертами Игоря (TELEGRAM_BOT_TOKEN).
// ENV:
//   TELEGRAM_PAYMENTS_BOT_TOKEN — токен бота уведомлений об оплатах
//   TELEGRAM_PAYMENTS_CHAT_ID   — чат по умолчанию (ЗМК, напр. -1001154166806)
//   TELEGRAM_PAYMENTS_THREAD_ID — (опц.) топик форума для чата по умолчанию
//   TELEGRAM_PAYMENTS_ROUTES    — (опц.) маршруты по ИНН получателя → свой чат,
//       JSON: {"6321277326":"-4019652337"}. Платёж с таким получателем уходит в
//       указанный чат и уведомляется НЕЗАВИСИМО от матча (другой проект, не ЗМК).

const SOURCE_LABELS: Record<string, string> = { tochka: 'Точка', tbank: 'Т-Банк' };

// Карта «ИНН получателя → chat_id» из env (маршруты чужих проектов, напр. столярка/ПОБТ).
function parseRoutes(): Record<string, string> {
  try {
    const raw = process.env.TELEGRAM_PAYMENTS_ROUTES;
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

/** Есть ли для получателя (по ИНН) отдельный маршрут-чат. */
export function isRoutedRecipient(recipientInn: string | null | undefined): boolean {
  if (!recipientInn) return false;
  return Boolean(parseRoutes()[recipientInn]);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatRub(kopecks: number): string {
  return `${kopecksToRubles(kopecks).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
}

function crmOrderLink(orderId: number | null, orderNumber: string | null): string | null {
  const base = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  if (orderId) return `${base}/orders/${orderId}/edit`;
  if (orderNumber) return `${base}/orders/${encodeURIComponent(orderNumber)}/edit?by=number`;
  return null;
}

function paymentsPageLink(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://okk.zmksoft.com').replace(/\/+$/, '');
  return `${base}/payments`;
}

function buildMessage(row: PointPaymentRow, routed: boolean): string {
  const source = SOURCE_LABELS[row.source] || row.source;
  const lines: string[] = [];
  lines.push(`💰 <b>Оплата · ${esc(source)}</b>`);
  lines.push(`<b>${esc(formatRub(Number(row.amount_kopecks)))}</b>`);

  const payer = row.payer_name ? esc(row.payer_name) + (row.payer_inn ? ` (ИНН ${esc(row.payer_inn)})` : '') : '—';
  lines.push(`👤 Плательщик: ${payer}`);

  if (row.recipient_name) lines.push(`🏢 Получатель: ${esc(row.recipient_name)}`);
  if (row.payment_date) lines.push(`📅 ${esc(String(row.payment_date).slice(0, 10))}`);

  if (row.purpose) {
    const purpose = row.purpose.length > 220 ? row.purpose.slice(0, 217) + '…' : row.purpose;
    lines.push(`📝 ${esc(purpose)}`);
  }

  // Для маршрутизированных получателей (другой проект, не ЗМК) не показываем
  // терминологию разноса по заказам RetailCRM — просто факт поступления.
  if (routed) {
    lines.push(`ℹ️ Платёж в сервисе — <a href="${paymentsPageLink()}">открыть</a>`);
    return lines.join('\n');
  }

  // Итог разноса (ЗМК).
  if ((row.status === 'matched' || row.status === 'manual') && row.matched_order_number) {
    const link = crmOrderLink(row.matched_order_id, row.matched_order_number);
    const order = link
      ? `<a href="${link}">№${esc(row.matched_order_number)}</a>`
      : `№${esc(row.matched_order_number)}`;
    const synced = row.retailcrm_synced_at ? ' — проброшен в RetailCRM' : '';
    lines.push(`✅ Заказ ${order}${synced}`);
  } else {
    lines.push(`🟡 Требует ручного разбора — <a href="${paymentsPageLink()}">открыть</a>`);
  }

  return lines.join('\n');
}

/** Отправляет уведомление об оплате. No-op, если бот/чат не сконфигурированы. */
export async function notifyPaymentTelegram(row: PointPaymentRow): Promise<void> {
  const token = process.env.TELEGRAM_PAYMENTS_BOT_TOKEN;
  if (!token) return; // не сконфигурировано — тихо пропускаем

  // Выбор чата: по ИНН получателя (маршрут чужого проекта) или чат по умолчанию (ЗМК).
  const routes = parseRoutes();
  const routeChat = row.recipient_inn ? routes[row.recipient_inn] : undefined;
  const routed = Boolean(routeChat);
  const chatId = routeChat || process.env.TELEGRAM_PAYMENTS_CHAT_ID;
  if (!chatId) return;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: buildMessage(row, routed),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  // Топик форума — только для чата по умолчанию (у маршрутных чатов свой).
  const threadId = process.env.TELEGRAM_PAYMENTS_THREAD_ID;
  if (!routed && threadId) body.message_thread_id = Number(threadId);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Telegram payments notify → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
