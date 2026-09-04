import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { updateExistingOrderInCrm } from '@/lib/retailcrm/leads';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ status: z.string().min(1).max(120) });

/**
 * Смена статуса заказа из карточки.
 *
 * Правила переходов ведём в своих таблицах (crm_statuses / crm_status_transitions), а
 * связь с RetailCRM — через external_code. Сам заказ живёт в RetailCRM, поэтому пишем
 * туда: иначе ближайший синк вернёт старый статус и менеджер решит, что кнопка врёт.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id } = await params;

    const { data: order } = await supabase
        .from('orders')
        .select('status')
        .eq('order_id', String(id))
        .maybeSingle();

    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });

    const [{ data: statuses }, { data: groups }, { data: transitions }] = await Promise.all([
        supabase.from('crm_statuses').select('id, name, color, group_id, external_code, ordering').eq('active', true),
        supabase.from('crm_status_groups').select('id, name, color, ordering'),
        supabase.from('crm_status_transitions').select('from_status_id, to_status_id'),
    ]);

    const list = (statuses || []) as any[];
    const current = list.find((s) => s.external_code === order.status);

    // Переходы не настроены — не выдумываем разрешения и честно говорим об этом.
    const allTransitions = (transitions || []) as any[];
    const allowedIds = current
        ? new Set(allTransitions.filter((t) => t.from_status_id === current.id).map((t) => t.to_status_id))
        : new Set<string>();

    const groupById = new Map(((groups || []) as any[]).map((g) => [g.id, g]));

    const options = list
        .filter((s) => allowedIds.has(s.id) && s.external_code)
        .map((s) => ({
            code: s.external_code as string,
            name: s.name as string,
            color: (s.color || groupById.get(s.group_id)?.color || null) as string | null,
            groupName: (groupById.get(s.group_id)?.name ?? 'Без группы') as string,
            groupOrdering: (groupById.get(s.group_id)?.ordering ?? 999) as number,
            ordering: s.ordering as number,
        }))
        .sort((a, b) => a.groupOrdering - b.groupOrdering || a.ordering - b.ordering || a.name.localeCompare(b.name));

    return NextResponse.json({
        ok: true,
        currentCode: order.status,
        currentName: current?.name ?? null,
        // Статуса нет в нашем справочнике либо для него не заведено ни одного перехода.
        known: Boolean(current),
        transitionsConfigured: allTransitions.length > 0,
        options,
    });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id } = await params;

    let body: z.infer<typeof BodySchema>;
    try {
        body = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    const { data: order } = await supabase
        .from('orders')
        .select('status, site')
        .eq('order_id', String(id))
        .maybeSingle();

    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    if (order.status === body.status) return NextResponse.json({ ok: true, unchanged: true });

    // Проверяем переход на сервере: интерфейс мог отстать от настроек.
    const [{ data: statuses }, { data: transitions }] = await Promise.all([
        supabase.from('crm_statuses').select('id, external_code').eq('active', true),
        supabase.from('crm_status_transitions').select('from_status_id, to_status_id'),
    ]);

    const list = (statuses || []) as any[];
    const from = list.find((s) => s.external_code === order.status);
    const to = list.find((s) => s.external_code === body.status);

    if (!from || !to) {
        return NextResponse.json({ error: 'status_not_mapped' }, { status: 400 });
    }

    const allowed = ((transitions || []) as any[]).some((t) => t.from_status_id === from.id && t.to_status_id === to.id);
    if (!allowed) {
        return NextResponse.json({ error: 'transition_not_allowed' }, { status: 409 });
    }

    const result = await updateExistingOrderInCrm(Number(id), { status: body.status }, order.site || undefined);
    if (!result.success) {
        return NextResponse.json({ error: 'crm_rejected', details: result.errorMsg || null }, { status: 502 });
    }

    // Локальную копию поправим сразу, чтобы список не показывал старое до ближайшего синка.
    await supabase.from('orders').update({ status: body.status }).eq('order_id', String(id));

    return NextResponse.json({ ok: true, status: body.status });
}
