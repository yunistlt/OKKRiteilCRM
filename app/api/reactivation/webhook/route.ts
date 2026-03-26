/**
 * POST /api/reactivation/webhook
 * Агент-Монитор: обрабатывает входящие ответы клиентов из RetailCRM.
 *
 * При POSITIVE — действие определяется настройками кампании:
 *   on_positive: "create_order" → создать заказ в статусе new_order_status
 *   on_positive: "send_reply"   → сгенерировать ответное письмо
 *
 * Настроить endpoint в RetailCRM → Настройки → Webhooks
 */

import { NextResponse } from 'next/server';
import { analyzeClientReply, generateReplyEmail } from '@/lib/reactivation';
import { getLogByCustomerId, markLogReplied, getCampaignById } from '@/lib/reactivation-db';

export const dynamic = 'force-dynamic';

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';
const RETAILCRM_SITE = process.env.RETAILCRM_SITE ?? '';

export async function POST(request: Request) {
    try {
        let customerId: number | null = null;
        let replyText: string | null = null;

        // Поддержка JSON и form-encoded от RetailCRM
        const contentType = request.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
            const body = await request.json().catch(() => null);
            customerId = body?.customerId ?? body?.customer?.id ?? null;
            replyText = body?.text ?? body?.message?.body ?? body?.comment ?? null;
        } else {
            const formText = await request.text().catch(() => '');
            const form = new URLSearchParams(formText);
            customerId = parseInt(form.get('customerId') ?? '0') || null;
            replyText = (form.get('text') ?? form.get('comment')) ?? null;
        }

        if (!customerId || !replyText) {
            return NextResponse.json({ success: false, error: 'customerId and text are required' }, { status: 400 });
        }

        // 1. Найти запись в логах
        const log = await getLogByCustomerId(customerId);
        if (!log) {
            return NextResponse.json({ success: true, action: 'ignored' });
        }

        // 2. Настройки кампании
        const campaign = await getCampaignById(log.campaign_id);
        const settings = campaign?.settings ?? {};
        const onPositive = settings.on_positive ?? 'create_order';
        const newOrderStatus = settings.new_order_status ?? 'new';

        // 3. Анализ ответа
        const { intent, reason } = await analyzeClientReply(replyText);
        console.log(`[Webhook] Customer ${customerId} intent: ${intent} — ${reason}`);

        // 4. Действие при POSITIVE
        if (intent === 'POSITIVE') {
            if (onPositive === 'send_reply') {
                // Сгенерировать и записать ответное письмо в RetailCRM
                await handleSendReply(
                    customerId,
                    log.generated_email ?? '',
                    replyText,
                    log.company_name ?? '',
                    settings.reply_prompt
                );
            } else {
                // Создать новый заказ (дефолтное действие)
                await handleCreateOrder(customerId, log.generated_email ?? '', replyText, newOrderStatus);
            }
        }

        // 5. Обновить лог
        await markLogReplied(log.id, replyText, intent);

        return NextResponse.json({ success: true, intent, reason });

    } catch (e: any) {
        console.error('[Reactivation Webhook] Error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────
// Действие 1: создать новый заказ с перепиской в комментарии
// ─────────────────────────────────────────────────────

async function handleCreateOrder(
    customerId: number,
    ourEmail: string,
    clientReply: string,
    orderStatus: string
): Promise<void> {
    const comment = [
        '🤖 ИИ-Реактиватор: Клиент ответил на рассылку.',
        '',
        '📤 Наше письмо:',
        ourEmail,
        '',
        '📩 Ответ клиента:',
        clientReply,
    ].join('\n');

    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);
    if (RETAILCRM_SITE) params.set('site', RETAILCRM_SITE);
    params.set('order', JSON.stringify({
        customer: { id: customerId },
        status: orderStatus,   // берётся из campaign.settings.new_order_status
        managerComment: comment,
    }));

    const res = await fetch(`${RETAILCRM_URL}/api/v5/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error('[Webhook] Failed to create order:', errText.substring(0, 300));
        return;
    }

    const data = await res.json();
    if (!data.success) {
        console.error('[Webhook] Create order returned success:false:', data);
    } else {
        console.log(`[Webhook] Created order #${data.order?.id} for customer ${customerId}`);
    }
}

// ─────────────────────────────────────────────────────
// Действие 2: сгенерировать ответное письмо и записать в RetailCRM
// ─────────────────────────────────────────────────────

async function handleSendReply(
    customerId: number,
    ourEmail: string,
    clientReply: string,
    companyName: string,
    replyPrompt?: string
): Promise<void> {
    const replyText = await generateReplyEmail({
        company_name: companyName,
        original_email: ourEmail,
        client_reply: clientReply,
        custom_prompt: replyPrompt,
    });

    // Записываем ответное письмо в поле ai_reactivation_text — триггер CRM отправит его
    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);
    if (RETAILCRM_SITE) params.set('site', RETAILCRM_SITE);
    params.set('customer[customFields][ai_reactivation_text]', replyText);

    const url = `${RETAILCRM_URL}/api/v5/customers/${customerId}/edit`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error('[Webhook] Failed to send reply:', errText.substring(0, 300));
    }
}
