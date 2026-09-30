import type { PointPaymentRow } from './service';
import { kopecksToRubles } from './types';
import { detectForeignProject } from './projects';
import { supabase } from '@/utils/supabase';
import { sendNotification, type SendResult } from '@/lib/notify/send';

/**
 * Куда уходят платёжные сообщения ЗМКТЛ.
 *
 * Раньше — в общий чат отдела продаж (TELEGRAM_PAYMENTS_CHAT_ID). Менеджерам эти
 * строки не нужны и топят рабочую переписку, поэтому весь платёжный поток ЗМК идёт
 * владельцу в личку: адрес тот же, что у бота-РОПа (sales_rop_settings.owner_chat_id),
 * запасной env — TELEGRAM_OWNER_CHAT_ID. Чужие проекты (столярка, консалтинг) не
 * трогаем: у них свои отдельные чаты.
 *
 * Возвращает и признак личного чата: в личке нет топиков форума, message_thread_id
 * туда слать нельзя.
 */
// Чат больше не выбирается здесь: адресат — свойство типа сообщения (lib/notify).
// Было наоборот, и правка маршрута платежей увела их из общего чата в личку
// владельца (инцидент 28.09.2026) — заодно с не связанными правками.

// Снабженец проекта ЗМК (константа): его тег ставим в каждое уведомление об оплате.
// Личность — запись в managers (по умолчанию id 13, Лариса Хоменко); сам ник берём из
// managers.raw_data.telegram_username, поэтому появится в сообщении сразу, как только он там задан.
const SUPPLY_MANAGER_ID = process.env.TELEGRAM_PAYMENTS_SUPPLY_MANAGER_ID || '13';

// Уведомления об оплатах шлём типами сообщений (lib/notify/catalog.ts):
//   payment.received            — разнесённая оплата ЗМКТЛ → общий чат отдела;
//   payment.pending_digest      — поступления без заказа → общий чат отдела;
//   payment.push_error          — оплата не прошла в CRM → владельцу в личку;
//   payment.project_stolyarka / payment.project_consulting → чаты своих проектов.
// Адресата любого типа человек меняет в интерфейсе (/settings/notifications).

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
  /** Тег менеджера сделки, напр. «@nick» или ФИО (заполняется резолвером перед отправкой). */
  managerTag?: string | null;
  /** Тег снабженца (Лариса), напр. «@nick». Пусто, пока ник не задан в managers. */
  supplyTag?: string | null;
  /**
   * Статус заказа на момент отправки — для досылки, когда перевод в производство
   * делали не сейчас. Говорим, где заказ стоит, а не выдумываем факт перевода.
   */
  currentStatusName?: string | null;
}

// Тег участника по его managers.id: @ник, если задан telegram_username; иначе ФИО (без пинга);
// null — если записи нет вовсе. Используется и для менеджера сделки, и для снабженца.
async function managerTagById(managerId: string | number | null): Promise<string | null> {
  if (managerId == null) return null;
  const { data } = await supabase
    .from('managers')
    .select('first_name, last_name, raw_data')
    .eq('id', String(managerId))
    .maybeSingle();
  if (!data) return null;
  const tg = (data as any).raw_data?.telegram_username;
  if (tg) return `@${String(tg).replace(/^@/, '')}`;
  const name = [(data as any).first_name, (data as any).last_name].filter(Boolean).join(' ').trim();
  return name ? esc(name) : null;
}

// Менеджер, ведущий сделку: matched_order_number → orders.manager_id → managers.
async function resolveDealManagerTag(row: PointPaymentRow): Promise<string | null> {
  const num = row.matched_order_number;
  if (!num) return null;
  const { data: ord } = await supabase
    .from('orders')
    .select('manager_id')
    .eq('number', String(num))
    .limit(1)
    .maybeSingle();
  return managerTagById((ord as any)?.manager_id ?? null);
}

// Снабженец (Лариса): показываем только если у него задан @ник — иначе строку опускаем.
async function resolveSupplyTag(): Promise<string | null> {
  const tag = await managerTagById(SUPPLY_MANAGER_ID);
  return tag && tag.startsWith('@') ? tag : null;
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
    // Человеческим языком: в сообщении речь об оплате, а не о внутренней механике
    // синхронизации. «Проброшен в RetailCRM» людям в чате ничего не объясняет.
    const synced = row.retailcrm_synced_at ? ' — оплата занесена в CRM' : ' — оплата в CRM ещё не занесена';
    lines.push(`✅ Заказ ${order}${synced}`);
    const num = esc(String(row.matched_order_number));
    if (opts.movedToProduction) {
      const name = opts.productionStatusName || 'Передано в производство';
      lines.push(`🏭 Заказ №${num} переведён в статус «${esc(name)}»`);
    } else if (opts.productionNotMovedReason) {
      lines.push(`❗ Заказ №${num} НЕ переведён в производство — ${esc(opts.productionNotMovedReason)}`);
    } else if (opts.currentStatusName) {
      lines.push(`🏭 Заказ №${num} в статусе «${esc(opts.currentStatusName)}»`);
    }
  } else {
    lines.push(`🟡 Требует ручного разбора — <a href="${paymentsPageLink()}">открыть</a>`);
  }

  // Ответственные по сделке ЗМК: менеджер и снабженец. Теги (@ник) пингуют их в чате.
  if (opts.managerTag) lines.push(`👔 Менеджер: ${opts.managerTag}`);
  if (opts.supplyTag) lines.push(`📦 Снабжение: ${opts.supplyTag}`);

  return lines.join('\n');
}

/**
 * Дайджест «деньги пришли, но не разнесены» — одним сообщением в чат ЗМКТЛ.
 * Отдельно от уведомления о разнесённой оплате: там платёж уже привязан к заказу,
 * тут наоборот — никто не знает, чьи это деньги, и заказ не двигается в производство.
 * No-op, если бот/чат не сконфигурированы или список пуст.
 */
export async function notifyPendingPaymentsTelegram(
    rows: PointPaymentRow[],
    opts: { totalCount: number; totalKopecks: number },
): Promise<void> {
    if (rows.length === 0) return;

    const MAX_ROWS = 10;
    const lines: string[] = [];
    lines.push(`🟡 <b>Требуют разбора: ${opts.totalCount} ${plural(opts.totalCount, 'поступление', 'поступления', 'поступлений')}</b>`);
    lines.push(`<b>${esc(formatRub(opts.totalKopecks))}</b> не привязано к заказам`);
    lines.push('');
    for (const r of rows.slice(0, MAX_ROWS)) {
        const date = r.payment_date ? String(r.payment_date).slice(0, 10).split('-').reverse().slice(0, 2).join('.') : '—';
        const payer = r.payer_name ? esc(r.payer_name) : 'плательщик не указан';
        const invoice = r.extracted_invoice_number ? ` · счёт №${esc(String(r.extracted_invoice_number))}` : '';
        const days = daysSince(r.payment_date);
        const age = days != null && days >= 3 ? ` · висит ${days} дн.` : '';
        lines.push(`• ${date} · <b>${esc(formatRub(Number(r.amount_kopecks)))}</b> · ${payer}${invoice}${age}`);
        // Подсказка «похоже на заказ №…»: матчинг нашёл кандидатов, но уверенности не хватило.
        for (const c of (Array.isArray(r.match_candidates) ? r.match_candidates : []).slice(0, 2)) {
            const num = esc(String(c?.orderNumber ?? ''));
            if (!num) continue;
            const why = c?.reason ? ` (${esc(String(c.reason))})` : '';
            lines.push(`   🔵 похоже на заказ №${num}${why}`);
        }
    }
    if (opts.totalCount > MAX_ROWS) lines.push(`…и ещё ${opts.totalCount - MAX_ROWS}`);
    lines.push('');
    lines.push(`Пока платёж не привязан к заказу, он не проведён в CRM и заказ не уходит в производство.`);
    lines.push(`🔗 <a href="${paymentsPageLink()}">Разобрать поступления</a>`);
    const reviewers = await resolveReviewTags().catch(() => []);
    if (reviewers.length) lines.push(`🧾 Разбор: ${reviewers.join(' ')}`);

    await sendNotification('payment.pending_digest', lines.join('\n'));
}

/**
 * Кого звать на разбор неразобранных поступлений и на сбой проводки: РОП + бухгалтер.
 * Личности — записи в managers (id в env), ник берётся из managers.raw_data.telegram_username,
 * поэтому @пинг появится сразу, как только ник там задан; до этого — просто ФИО.
 */
async function resolveReviewTags(): Promise<string[]> {
    const ids = (process.env.TELEGRAM_PAYMENTS_REVIEW_MANAGER_IDS || '102,356')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const tags = await Promise.all(ids.map((id) => managerTagById(id).catch(() => null)));
    return tags.filter((t): t is string => Boolean(t));
}

/**
 * Сбой проводки: платёж привязан к заказу, но RetailCRM его не принял. Деньги в системе
 * есть, в CRM их нет и заказ не поедет в производство — это надо чинить руками, поэтому
 * зовём тех же, кто разбирает поступления.
 */
export async function notifyPaymentPushErrorTelegram(row: PointPaymentRow, error: string, explanation?: string): Promise<void> {
    const token = process.env.TELEGRAM_PAYMENTS_BOT_TOKEN;
    if (!token) return;
    const lines: string[] = [];
    lines.push(`❗ <b>Оплата не проведена в CRM</b>`);
    lines.push(`<b>${esc(formatRub(Number(row.amount_kopecks)))}</b>${row.payer_name ? ` · ${esc(row.payer_name)}` : ''}`);
    if (row.matched_order_number) {
        const link = crmOrderLink(row.matched_order_id, row.matched_order_number);
        lines.push(`Заказ ${link ? `<a href="${link}">№${esc(row.matched_order_number)}</a>` : `№${esc(row.matched_order_number)}`} — статус не изменится, пока оплата не проведена`);
    }
    lines.push(`Причина: ${esc(String(error).slice(0, 300))}`);
    // Человеку важно понимать, ждать ему или чинить: при сбое на стороне
    // RetailCRM платёж проводится сам, звать никого не нужно.
    if (explanation) lines.push(explanation);
    lines.push(`🔗 <a href="${paymentsPageLink()}">Открыть платёж</a>`);
    const reviewers = await resolveReviewTags().catch(() => []);
    if (reviewers.length && !explanation?.includes('делать ничего не нужно')) {
        lines.push(`🧾 ${reviewers.join(' ')}`);
    }

    await sendNotification('payment.push_error', lines.join('\n')).catch((e) =>
        console.error('[payments] push error notify failed:', e?.message || e),
    );
}

function plural(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
}

function daysSince(date: string | null): number | null {
    if (!date) return null;
    const t = new Date(String(date).slice(0, 10)).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/**
 * Отправляет уведомление об оплате и возвращает исход: в какой чат ушло или
 * почему пропущено. Исход нужен вызывающему, чтобы не выдавать ненастроенный
 * адрес за доставленное сообщение.
 */
export async function notifyPaymentTelegram(
  row: PointPaymentRow,
  opts: NotifyOptions = {},
): Promise<SendResult> {
  // Тип сообщения зависит от проекта платежа; адресат каждого типа — в настройках.
  // Сматченный на заказ RetailCRM → всегда ЗМКТЛ (заказ реальный); иначе — по проекту
  // из назначения (столярка/консалтинг → свой чат).
  const matched = row.status === 'matched' || row.status === 'manual';
  // Проект уже определён при обработке (в т.ч. по плательщику) — берём его; пере-детект
  // только как фолбэк для старых строк без project.
  const stored = row.project === 'stolyarka' || row.project === 'consulting' ? row.project : null;
  const foreign = matched
    ? null
    : stored ??
      detectForeignProject({
        purpose: row.purpose,
        recipientInn: row.recipient_inn,
        payerName: row.payer_name,
        payerInn: row.payer_inn,
      });
  const routed = Boolean(foreign);
  const code =
    foreign === 'stolyarka'
      ? 'payment.project_stolyarka'
      : foreign === 'consulting'
        ? 'payment.project_consulting'
        : 'payment.received';

  // Теги ответственных — только для ЗМК (у чужих проектов нет заказа/снабженца ЗМК).
  const tagOpts: NotifyOptions = { ...opts };
  if (!routed) {
    tagOpts.managerTag = opts.managerTag ?? (await resolveDealManagerTag(row).catch(() => null));
    tagOpts.supplyTag = opts.supplyTag ?? (await resolveSupplyTag().catch(() => null));
  }

  return sendNotification(code, buildMessage(row, routed, tagOpts));
}
