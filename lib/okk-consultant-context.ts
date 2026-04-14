import { ConsultantOrder, OrderEvidence } from '@/lib/okk-consultant';
import { supabase } from '@/utils/supabase';

const CONTEXT_CACHE_TTL_MS = 1000 * 60 * 2;

const orderContextCache = new Map<string, { value: ConsultantOrder; cachedAt: number }>();
const evidenceCache = new Map<string, { value: OrderEvidence; cachedAt: number }>();

function getCachedValue<T>(cache: Map<string, { value: T; cachedAt: number }>, key: string): T | null {
    const cached = cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > CONTEXT_CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return cached.value;
}

function setCachedValue<T>(cache: Map<string, { value: T; cachedAt: number }>, key: string, value: T): T {
    cache.set(key, { value, cachedAt: Date.now() });
    return value;
}

export async function loadConsultantOrder(orderId: number, userRole: string, retailCrmManagerId: number | null): Promise<ConsultantOrder> {
    const cacheKey = `${orderId}:${userRole}:${retailCrmManagerId || 'none'}`;
    const cached = getCachedValue(orderContextCache, cacheKey);
    if (cached) return cached;

    const [{ data: orderRow, error: orderError }, { data: scoreRow, error: scoreError }] = await Promise.all([
        supabase
            .from('orders')
            .select('order_id, status, manager_id, totalsumm, raw_payload')
            .eq('order_id', orderId)
            .maybeSingle(),
        supabase
            .from('okk_order_scores')
            .select('*')
            .eq('order_id', orderId)
            .maybeSingle(),
    ]);

    if (orderError) throw orderError;
    if (scoreError) throw scoreError;
    if (!orderRow && !scoreRow) throw new Error('Заказ не найден');

    const managerId = orderRow?.manager_id ?? scoreRow?.manager_id ?? null;
    if (userRole === 'manager' && retailCrmManagerId && managerId && managerId !== retailCrmManagerId) {
        throw new Error('Недостаточно прав для этого заказа');
    }

    const [{ data: managerData }, { data: statusData }] = await Promise.all([
        managerId
            ? supabase.from('managers').select('first_name, last_name').eq('id', managerId).maybeSingle()
            : Promise.resolve({ data: null }),
        orderRow?.status
            ? supabase.from('statuses').select('name, color').eq('code', orderRow.status).maybeSingle()
            : Promise.resolve({ data: null }),
    ]);

    return setCachedValue(orderContextCache, cacheKey, {
        ...(scoreRow || {}),
        order_id: orderId,
        manager_name: managerData ? [managerData.first_name, managerData.last_name].filter(Boolean).join(' ') : scoreRow?.manager_name || '—',
        status_label: statusData?.name || scoreRow?.status_label || orderRow?.status || '—',
    });
}

export async function loadConsultantEvidence(orderId: number, historyLimit: number = 5): Promise<OrderEvidence> {
    const cacheKey = `${orderId}:${historyLimit}`;
    const cached = getCachedValue(evidenceCache, cacheKey);
    if (cached) return cached;

    const [
        { count: commentCount },
        { count: emailCount },
        { data: callRows },
        { data: historyRows },
        { data: orderRow },
    ] = await Promise.all([
        supabase
            .from('raw_order_events')
            .select('event_id', { count: 'exact', head: true })
            .eq('retailcrm_order_id', orderId)
            .ilike('event_type', '%comment%'),
        supabase
            .from('raw_order_events')
            .select('event_id', { count: 'exact', head: true })
            .eq('retailcrm_order_id', orderId)
            .ilike('event_type', '%email%'),
        supabase
            .from('call_order_matches')
            .select('raw_telphin_calls(direction, transcript, started_at, duration_sec, recording_url)')
            .eq('retailcrm_order_id', orderId),
        supabase
            .from('order_history_log')
            .select('field, occurred_at, old_value, new_value')
            .eq('retailcrm_order_id', orderId)
            .order('occurred_at', { ascending: false })
            .limit(historyLimit),
        supabase
            .from('orders')
            .select('raw_payload')
            .eq('order_id', orderId)
            .maybeSingle(),
    ]);

    const calls = (callRows || [])
        .map((row: any) => Array.isArray(row.raw_telphin_calls) ? row.raw_telphin_calls[0] : row.raw_telphin_calls)
        .filter(Boolean);
    const rawPayload = orderRow?.raw_payload || {};
    const tzFields = ['tz', 'technical_specification', 'width', 'height', 'depth', 'temperature'];

    return setCachedValue(evidenceCache, cacheKey, {
        commentCount: commentCount || 0,
        emailCount: emailCount || 0,
        totalCalls: calls.length,
        transcriptCalls: calls.filter((call: any) => Boolean(call?.transcript)).length,
        calls: calls.map((call: any) => ({
            started_at: call.started_at || null,
            direction: call.direction || null,
            duration_sec: call.duration_sec || 0,
            hasTranscript: Boolean(call.transcript),
            transcript_excerpt: call.transcript ? String(call.transcript).slice(0, 220) : null,
            included_in_score: null,
            classification: null,
            classification_reason: null,
            matched_by: null,
        })),
        facts: {
            buyer: rawPayload?.customer?.firstName || rawPayload?.customer?.name || rawPayload?.contact?.name || null,
            company: rawPayload?.company?.name || null,
            phone: rawPayload?.phone || rawPayload?.contact?.phones?.[0]?.number || null,
            email: rawPayload?.email || null,
            totalSum: rawPayload?.totalSumm || null,
            category: rawPayload?.customFields?.tovarnaya_kategoriya || rawPayload?.customFields?.product_category || rawPayload?.category || null,
            sphere: rawPayload?.customFields?.sfera_deiatelnosti || rawPayload?.customFields?.sphere_of_activity || null,
            purchaseForm: rawPayload?.customFields?.typ_customer_margin || rawPayload?.customFields?.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete || null,
            expectedAmount: rawPayload?.customFields?.expected_amount || rawPayload?.customFields?.ozhidaemaya_summa || null,
            nextContactDate: rawPayload?.customFields?.next_contact_date || rawPayload?.customFields?.data_kontakta || null,
            status: rawPayload?.status || null,
        },
        tzEvidence: {
            customerComment: rawPayload?.customerComment || null,
            managerComment: rawPayload?.managerComment || null,
            customFieldKeys: tzFields.filter((field) => Boolean(rawPayload?.customFields?.[field])),
        },
        lastHistoryEvents: (historyRows || []).map((item: any) => ({
            field: item.field || null,
            created_at: item.occurred_at || null,
            old_value: item.old_value ?? null,
            new_value: item.new_value ?? null,
        })),
    });
}