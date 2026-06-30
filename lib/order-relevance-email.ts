/**
 * Письма об актуальности отложенных заказов (sales outreach).
 *
 * Находит заказы в статусе «Отложено», переведённые туда за период, и готовит письмо
 * клиенту: состав заказа (строго из данных заказа — без выдумок) + персонализированный
 * «толчок к покупке» на основе причины переноса (из комментария менеджера). Прозу с
 * психологическими триггерами генерирует LLM; состав и цифры собираются в коде.
 *
 * Состав/цифры — детерминированно из raw_payload (закон «без выдуманных данных»).
 * Тема письма получает служебный тег RetailCRM `[#N/NNNNN]` уже на этапе отправки
 * (см. lib/email.ts buildOrderThreadSubject / sendOrderEmail).
 */
import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { recordAiUsage } from '@/lib/ai-usage';
import { formatRub } from '@/lib/format';

export interface OrderItemLine {
    name: string;
    qty: number;
    sum: number; // итог по строке с учётом скидки, ₽
}

export interface PostponedCandidate {
    orderId: number;
    number: string;
    total: number;
    customerName: string | null; // компания / клиент
    contactName: string | null;  // контактное лицо
    toEmail: string | null;      // куда писать
    movedAt: string;             // когда переведён в «Отложено» (ISO)
    fromStatusCode: string | null;
    items: OrderItemLine[];
    reasonText: string | null;   // комментарий менеджера (сырой) — источник причины
}

/** Коды статусов семейства «Отложено» — тянем из справочника RetailCRM, не хардкодим. */
export async function getPostponedStatusCodes(): Promise<string[]> {
    const { data } = await supabase
        .from('retailcrm_dictionaries')
        .select('item_code, item_name')
        .eq('entity_type', 'status')
        .ilike('item_name', '%отлож%');
    const codes = (data || []).map((r: any) => r.item_code).filter(Boolean);
    return codes.length ? codes : ['otlozeno'];
}

function pickEmail(p: any): string | null {
    return p?.contact?.email || p?.email || p?.customer?.email || null;
}

function pickContactName(p: any): string | null {
    return p?.contact?.firstName || p?.firstName || null;
}

function pickCustomerName(p: any): string | null {
    return p?.customer?.nickName || p?.company || null;
}

function extractItems(p: any): OrderItemLine[] {
    return (p?.items || []).map((it: any): OrderItemLine => {
        const unit = it.initialPrice != null ? Number(it.initialPrice) : Number(it.price || 0);
        const qty = Number(it.quantity || 0);
        const discount = Number(it.discountTotal || 0);
        return {
            name: (it.offer && (it.offer.displayName || it.offer.name)) || it.productName || 'Позиция',
            qty,
            sum: Math.max(0, unit * qty - discount),
        };
    });
}

/**
 * Кандидаты на письмо об актуальности: заказы СЕЙЧАС в «Отложено», которые были переведены
 * в этот статус в указанном окне дат (по истории заказа), опц. фильтр по менеджеру.
 */
export async function getPostponedRelevanceCandidates(opts: {
    managerId?: number;
    movedFrom: string; // ISO (включительно)
    movedTo: string;   // ISO (исключительно)
    limit?: number;
}): Promise<PostponedCandidate[]> {
    const codes = await getPostponedStatusCodes();

    // 1) Заказы сейчас в «Отложено» (+ опц. менеджер).
    let q = supabase
        .from('orders')
        .select('order_id, number, status, totalsumm, manager_id, raw_payload')
        .in('status', codes);
    if (opts.managerId != null) q = q.eq('manager_id', opts.managerId);
    const { data: orders } = await q.limit(1000);
    if (!orders || orders.length === 0) return [];

    const orderIds = orders.map((o: any) => o.order_id);

    // 2) Переходы В «Отложено» в окне дат — по истории.
    const { data: hist } = await supabase
        .from('order_history_log')
        .select('retailcrm_order_id, old_value, new_value, occurred_at')
        .eq('field', 'status')
        .in('retailcrm_order_id', orderIds)
        .gte('occurred_at', opts.movedFrom)
        .lt('occurred_at', opts.movedTo);

    // Для каждого заказа — самый ранний переход в «Отложено» в окне.
    const movedInfo = new Map<number, { movedAt: string; fromCode: string | null }>();
    for (const h of (hist || []) as any[]) {
        let newCode: string | null = null;
        let oldCode: string | null = null;
        try { newCode = JSON.parse(h.new_value)?.code ?? null; } catch { /* ignore */ }
        try { oldCode = JSON.parse(h.old_value)?.code ?? null; } catch { /* ignore */ }
        if (!newCode || !codes.includes(newCode)) continue;
        const prev = movedInfo.get(h.retailcrm_order_id);
        if (!prev || new Date(h.occurred_at) < new Date(prev.movedAt)) {
            movedInfo.set(h.retailcrm_order_id, { movedAt: h.occurred_at, fromCode: oldCode });
        }
    }

    const out: PostponedCandidate[] = [];
    for (const o of orders as any[]) {
        const mv = movedInfo.get(o.order_id);
        if (!mv) continue; // переведён в «Отложено» не в этом окне
        const p = o.raw_payload || {};
        out.push({
            orderId: o.order_id,
            number: o.number || String(o.order_id),
            total: Number(o.totalsumm || 0),
            customerName: pickCustomerName(p),
            contactName: pickContactName(p),
            toEmail: pickEmail(p),
            movedAt: mv.movedAt,
            fromStatusCode: mv.fromCode,
            items: extractItems(p),
            reasonText: p.managerComment || null,
        });
    }
    out.sort((a, b) => new Date(b.movedAt).getTime() - new Date(a.movedAt).getTime());
    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
}

/** Собирает кандидата по одному заказу (для предпросмотра/отправки конкретного письма). */
export async function getCandidateByOrderId(orderId: number): Promise<PostponedCandidate | null> {
    const { data: o } = await supabase
        .from('orders')
        .select('order_id, number, totalsumm, raw_payload')
        .eq('order_id', orderId)
        .maybeSingle();
    if (!o) return null;
    const p = (o as any).raw_payload || {};

    // Последний переход в «Отложено» (для информации), если есть.
    const codes = await getPostponedStatusCodes();
    const { data: hist } = await supabase
        .from('order_history_log')
        .select('old_value, new_value, occurred_at')
        .eq('field', 'status')
        .eq('retailcrm_order_id', orderId)
        .order('occurred_at', { ascending: false })
        .limit(50);
    let movedAt: string | null = null;
    let fromCode: string | null = null;
    for (const h of (hist || []) as any[]) {
        let nc: string | null = null;
        try { nc = JSON.parse(h.new_value)?.code ?? null; } catch { /* ignore */ }
        if (nc && codes.includes(nc)) {
            movedAt = h.occurred_at;
            try { fromCode = JSON.parse(h.old_value)?.code ?? null; } catch { fromCode = null; }
            break;
        }
    }
    return {
        orderId: (o as any).order_id,
        number: (o as any).number || String(orderId),
        total: Number((o as any).totalsumm || 0),
        customerName: pickCustomerName(p),
        contactName: pickContactName(p),
        toEmail: pickEmail(p),
        movedAt: movedAt || new Date(0).toISOString(),
        fromStatusCode: fromCode,
        items: extractItems(p),
        reasonText: p.managerComment || null,
    };
}

export interface RelevanceEmailDraft {
    subjectText: string; // человеческая часть темы (тег [#N/NNNNN] добавит sendOrderEmail)
    html: string;
    aiUsed: boolean;
}

interface AiBody {
    subjectText: string;
    greeting: string;
    paragraphs: string[];
    triggerBullets: string[];
    closing: string;
}

const SYSTEM_PROMPT = `Ты — опытный менеджер по продажам промышленного оборудования и металлоконструкций (ЗМК).
Пишешь клиенту письмо, чтобы аккуратно вернуть в работу ОТЛОЖЕННЫЙ заказ и подтолкнуть к покупке.
Тон — деловой, уважительный, на «вы», по-русски, без давления и без «впаривания».
Опираешься на причину переноса (дам комментарий менеджера) и применяешь уместные психологические триггеры продаж:
ценностный рефрейминг, мягкий дефицит/срочность по срокам изготовления, социальное доказательство,
снятие барьера (рассрочка/этапы), консистентность («вы уже выбрали нас»), реципрокность.
Не выдумывай факты, которых нет (цены, сроки бери только из данных — их я подставлю отдельно таблицей).
Не вставляй таблицу состава и подпись — их добавит код. Верни СТРОГО JSON:
{"subjectText": "...", "greeting": "Имя, здравствуйте!", "paragraphs": ["...","..."], "triggerBullets": ["...","..."], "closing": "..."}
subjectText — короткая тема без служебных тегов. paragraphs — 1–2 абзаца. triggerBullets — 2–4 коротких аргумента.`;

function buildItemsTableHtml(items: OrderItemLine[], total: number): string {
    const rows = items
        .map(
            (it) =>
                `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(it.name)}</td>` +
                `<td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${it.qty} шт</td>` +
                `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${formatRub(it.sum)}</td></tr>`
        )
        .join('');
    return (
        `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:12px 0">` +
        `<thead><tr style="background:#f5f5f5">` +
        `<th style="padding:6px 10px;text-align:left;border-bottom:1px solid #ddd">Позиция</th>` +
        `<th style="padding:6px 10px;text-align:left;border-bottom:1px solid #ddd">Кол-во</th>` +
        `<th style="padding:6px 10px;text-align:right;border-bottom:1px solid #ddd">Сумма</th>` +
        `</tr></thead><tbody>${rows}` +
        `<tr><td style="padding:8px 10px;font-weight:bold">Итого</td><td></td>` +
        `<td style="padding:8px 10px;text-align:right;font-weight:bold;white-space:nowrap">${formatRub(total)}</td></tr>` +
        `</tbody></table>`
    );
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function assembleHtml(body: AiBody, c: PostponedCandidate): string {
    const paras = body.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
    const bullets = body.triggerBullets.length
        ? `<p style="margin-top:14px"><b>Почему стоит вернуться к заказу сейчас:</b></p><ul>` +
          body.triggerBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('') +
          `</ul>`
        : '';
    return (
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.55;max-width:640px">` +
        `<p>${escapeHtml(body.greeting)}</p>\n${paras}\n` +
        `<p style="margin:16px 0 4px;font-weight:bold">Состав заказа №${escapeHtml(c.number)}:</p>` +
        buildItemsTableHtml(c.items, c.total) +
        bullets +
        `<p style="margin-top:16px">${escapeHtml(body.closing)}</p>` +
        `</div>`
    );
}

/** Детерминированный фолбэк, если LLM недоступен. */
function fallbackBody(c: PostponedCandidate): AiBody {
    const name = c.contactName ? `${c.contactName}, здравствуйте!` : 'Здравствуйте!';
    return {
        subjectText: `Заказ №${c.number} — актуальность`,
        greeting: name,
        paragraphs: [
            `Возвращаюсь к вашему заказу №${c.number}. Подскажите, пожалуйста, актуальна ли ещё задача — мы готовы продолжить работу и ответить на любые вопросы.`,
        ],
        triggerBullets: [
            'Состав и расчёт по заказу актуальны — можем запускать в работу.',
            'Готовы обсудить условия и сроки под вашу ситуацию.',
        ],
        closing: 'С уважением, отдел продаж ЗМК.',
    };
}

/**
 * Готовит письмо об актуальности по кандидату. Прозу пишет LLM (с учётом причины переноса),
 * состав/итог собираются в коде из данных заказа. Деградирует на шаблон, если LLM недоступен.
 */
export async function generateRelevanceEmail(c: PostponedCandidate): Promise<RelevanceEmailDraft> {
    if (!isOpenAIConfigured()) {
        const body = fallbackBody(c);
        return { subjectText: body.subjectText, html: assembleHtml(body, c), aiUsed: false };
    }

    const itemsForPrompt = c.items.map((i) => `- ${i.qty} шт × ${i.name} = ${formatRub(i.sum)}`).join('\n');
    const userPrompt =
        `Заказ №${c.number}. Клиент: ${c.customerName || '—'}. Контакт: ${c.contactName || '—'}.\n` +
        `Сумма заказа: ${formatRub(c.total)}.\n` +
        `Состав (для контекста, таблицу вставит код):\n${itemsForPrompt}\n\n` +
        `Комментарий менеджера (причина переноса/история, из неё пойми, почему отложили и что поможет вернуть):\n` +
        `${(c.reasonText || 'нет данных').slice(0, 2500)}`;

    try {
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.5,
        });
        await recordAiUsage({
            agentId: 'sales_outreach',
            model: completion.model,
            usage: completion.usage,
            purpose: 'relevance_email',
        });
        const content = completion.choices[0]?.message?.content;
        if (!content) return degraded(c);
        const parsed = JSON.parse(content) as Partial<AiBody>;
        const body: AiBody = {
            subjectText: parsed.subjectText || `Заказ №${c.number} — актуальность`,
            greeting: parsed.greeting || (c.contactName ? `${c.contactName}, здравствуйте!` : 'Здравствуйте!'),
            paragraphs: Array.isArray(parsed.paragraphs) && parsed.paragraphs.length ? parsed.paragraphs : fallbackBody(c).paragraphs,
            triggerBullets: Array.isArray(parsed.triggerBullets) ? parsed.triggerBullets : [],
            closing: parsed.closing || 'С уважением, отдел продаж ЗМК.',
        };
        return { subjectText: body.subjectText, html: assembleHtml(body, c), aiUsed: true };
    } catch (e: any) {
        console.warn('[relevance-email] LLM ошибка, фолбэк на шаблон:', e?.message || e);
        return degraded(c);
    }
}

function degraded(c: PostponedCandidate): RelevanceEmailDraft {
    const body = fallbackBody(c);
    return { subjectText: body.subjectText, html: assembleHtml(body, c), aiUsed: false };
}
