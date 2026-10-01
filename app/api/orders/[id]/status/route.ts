import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { updateExistingOrderInCrm } from '@/lib/retailcrm/leads';
import { isRetailcrmOutboundWriteEnabled, RETAILCRM_WRITE_BLOCKED_MESSAGE } from '@/lib/retailcrm/outbound-guard';

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
        .select('status, is_own')
        .eq('order_id', String(id))
        .maybeSingle();

    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });

    const [{ data: statuses }, { data: groups }, { data: transitions }] = await Promise.all([
        supabase.from('crm_statuses').select('id, name, color, group_id, external_code, ordering').eq('active', true),
        supabase.from('crm_status_groups').select('id, name, color, ordering, icon'),
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

    // Показываем весь каталог статусов, как в RetailCRM: человек видит, куда
    // заказ вообще может пойти. Перейти можно только в разрешённые матрицей —
    // у остальных стоит allowed: false (требование владельца 01.10.2026).
    const options = list
        .filter((s) => s.external_code)
        .map((s) => ({
            code: s.external_code as string,
            name: s.name as string,
            color: (s.color || groupById.get(s.group_id)?.color || null) as string | null,
            groupName: (groupById.get(s.group_id)?.name ?? 'Без группы') as string,
            groupColor: (groupById.get(s.group_id)?.color ?? null) as string | null,
            groupIcon: (groupById.get(s.group_id)?.icon ?? null) as string | null,
            groupOrdering: (groupById.get(s.group_id)?.ordering ?? 999) as number,
            ordering: s.ordering as number,
            allowed: allowedIds.has(s.id),
            current: s.external_code === order.status,
        }))
        .sort((a, b) => a.groupOrdering - b.groupOrdering || a.ordering - b.ordering || a.name.localeCompare(b.name));

    // У своего заказа рубильник исходящих записей ни при чём: менять статус
    // можно всегда, менять его негде, кроме нашей базы.
    const writeEnabled = (order as any).is_own ? true : await isRetailcrmOutboundWriteEnabled();

    return NextResponse.json({
        ok: true,
        writeEnabled,
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
        .select('id, status, site, is_own')
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

    // Свой заказ меняем у себя: в RetailCRM его нет, и рубильник исходящих
    // записей к нему не относится.
    if ((order as any).is_own) {
        const { data: row } = await supabase
            .from('orders')
            .select('raw_payload')
            .eq('order_id', String(id))
            .maybeSingle();
        const payload = { ...(((row as any)?.raw_payload) || {}), status: body.status };
        await supabase.from('orders').update({ status: body.status, raw_payload: payload }).eq('order_id', String(id));
        return NextResponse.json({ ok: true, status: body.status, own: true });
    }

    // Пока свой функционал не достроен, наружу не пишем — см. lib/retailcrm/outbound-guard.
    if (!(await isRetailcrmOutboundWriteEnabled())) {
        return NextResponse.json({ error: 'crm_write_disabled', message: RETAILCRM_WRITE_BLOCKED_MESSAGE }, { status: 423 });
    }

    const result = await updateExistingOrderInCrm(Number(id), { status: body.status }, order.site || undefined);
    if (!result.success) {
        return NextResponse.json({ error: 'crm_rejected', details: result.errorMsg || null }, { status: 502 });
    }

    // Локальную копию поправим сразу, чтобы список не показывал старое до ближайшего синка.
    await supabase.from('orders').update({ status: body.status }).eq('order_id', String(id));

    return NextResponse.json({ ok: true, status: body.status });
}
