import type { PointPaymentRow } from './service';
import { kopecksToRubles } from './types';
import { detectForeignProject, projectChatId } from './projects';

// Уведомление об оплате в Telegram через отдельного бота (@okkzmk_bot).
// Не пересекается с алертами Игоря (TELEGRAM_BOT_TOKEN). Чат выбирается по ПРОЕКТУ
// платежа (см. projects.ts): ЗМКТЛ → чат ЗМК, столярка/консалтинг → свои чаты.
// ENV:
//   TELEGRAM_PAYMENTS_BOT_TOKEN     — токен бота уведомлений
//   TELEGRAM_PAYMENTS_CHAT_ID       — чат ЗМКТЛ (по умолчанию)
//   TELEGRAM_PAYMENTS_THREAD_ID     — (опц.) топик форума для чата ЗМКТЛ
//   TELEGRAM_PROJECT_STOLYARKA_CHAT — чат столярки
//   TELEGRAM_PROJECT_CONSULTING_CHAT— чат консалтинга

const SOURCE_LABELS: Record<string, string> = { tochka: 'Точка', tbank: 'Т-Банк' };

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

export interface NotifyOptions {
  movedToProduction?: boolean;
  productionStatusName?: string;
  productionNotMovedReason?: string;
}

function buildMessage(row: PointPaymentRow, routed: boolean, opts: NotifyOptions): string {
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
    const num = esc(String(row.matched_order_number));
    if (opts.movedToProduction) {
      const name = opts.productionStatusName || 'Передано в производство';
      lines.push(`🏭 Заказ №${num} переведён в статус «${esc(name)}»`);
    } else if (opts.productionNotMovedReason) {
      lines.push(`❗ Заказ №${num} НЕ переведён в производство — ${esc(opts.productionNotMovedReason)}`);
    }
  } else {
    lines.push(`🟡 Требует ручного разбора — <a href="${paymentsPageLink()}">открыть</a>`);
  }

  return lines.join('\n');
}

/** Отправляет уведомление об оплате. No-op, если бот/чат не сконфигурированы. */
export async function notifyPaymentTelegram(row: PointPaymentRow, opts: NotifyOptions = {}): Promise<void> {
  const token = process.env.TELEGRAM_PAYMENTS_BOT_TOKEN;
  if (!token) return; // не сконфигурировано — тихо пропускаем

  // Выбор чата: сматченный на заказ RetailCRM → всегда ЗМКТЛ (заказ реальный); иначе —
  // по проекту из назначения (столярка/консалтинг → свой чат).
  const matched = row.status === 'matched' || row.status === 'manual';
  const foreign = matched ? null : detectForeignProject(row.purpose);
  const routed = Boolean(foreign);
  const chatId = projectChatId(foreign ?? 'zmktl');
  if (!chatId) return;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: buildMessage(row, routed, opts),
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
