import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { resolveOrderRef } from '@/lib/own-crm/order-ref';
import { PRODUCTION_STATUS } from '@/lib/payments/production';
import { queueOrderForProduction } from '@/lib/own-crm/tseh-outbox';
import { INN_GATE_MESSAGE, INN_REQUIRED_STATUSES, ensureInnTask, orderInn } from '@/lib/own-crm/inn-gate';
import { editOrder } from '@/lib/own-crm/edit-order';
import { writeOwnHistory } from '@/lib/own-crm/history-write';
import { updateExistingOrderInCrm } from '@/lib/retailcrm/leads';
import { isRetailcrmOutboundWriteEnabled, RETAILCRM_WRITE_BLOCKED_MESSAGE } from '@/lib/retailcrm/outbound-guard';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
    status: z.string().min(1).max(120),
    /**
     * Причина перевода словами. Спрашиваем у статусов с галочкой
     * «Спрашивать причину словами» в их карточке (решение владельца
     * 05.10.2026) — как всплывающее окно в RetailCRM.
     */
    reason: z.string().trim().max(5000).optional().nullable(),
});

/** Сколько знаков считаем причиной. Одно слово разбору не помогает. */
const MIN_REASON = 10;

/**
 * Смена статуса заказа из карточки.
 *
 * Правила переходов ведём в своих таблицах (crm_statuses / crm_status_transitions), а
 * связь с RetailCRM — через external_code. Сам заказ живёт в RetailCRM, поэтому пишем
 * туда: иначе ближайший синк вернёт старый статус и менеджер решит, что кнопка врёт.
 */
/**
 * Заказ по тому, что пришло в адресе: это может быть и номер RetailCRM, и наш
 * номер с буквой («1025А»). Карточка зовёт этот маршрут номером заказа, а не
 * внутренним идентификатором — у своих заказов они разные, и смена статуса
 * отвечала «order_not_found» (поймано 02.10.2026).
 */
async function findOrder(id: string, columns: string) {
    // Номер или идентификатор разбирает одно место на весь проект: порядок
    // «сначала номер» важен, у своих заказов номер тоже число.
    const ref = await resolveOrderRef(id);
    if (!ref) return null;

    const { data } = await supabase.from('orders').select(columns).eq('id', ref.id).maybeSingle();
    return (data as any) ?? null;
}

/**
 * Сохранить причину перевода.
 *
 * Причина нужна разбору, а не галочке: пишем её в историю заказа (там её видно
 * рядом со сменой статуса) и, когда статус нерабочий — то есть заказ выбывает,
 * — в поле «Причина отмены (словами, подробно)», откуда её берёт анализ отмен.
 */
async function saveStatusReason(
    orderRowId: number,
    crmOrderId: number,
    actorId: number | null,
    status: { name?: string | null; is_working?: boolean | null },
    reason: string,
): Promise<void> {
    if (!reason) return;

    await writeOwnHistory(crmOrderId, [{ field: 'status_reason', newValue: reason }], actorId);

    if (status.is_working === false) {
        await supabase.from('orders').update({ prichina_otmeny_text: reason }).eq('id', orderRowId);
    }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id } = await params;

    const order = await findOrder(id, 'status, is_own');
    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });

    const [{ data: statuses }, { data: groups }, { data: transitions }] = await Promise.all([
        supabase.from('crm_statuses').select('id, name, color, group_id, external_code, ordering, requires_reason, is_working').eq('active', true),
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
            // Цвет статуса — это цвет его группы (решение владельца 01.10.2026):
            // на уровне статуса цвет не назначается.
            color: (groupById.get(s.group_id)?.color || null) as string | null,
            groupName: (groupById.get(s.group_id)?.name ?? 'Без группы') as string,
            groupColor: (groupById.get(s.group_id)?.color ?? null) as string | null,
            groupIcon: (groupById.get(s.group_id)?.icon ?? null) as string | null,
            groupOrdering: (groupById.get(s.group_id)?.ordering ?? 999) as number,
            ordering: s.ordering as number,
            allowed: allowedIds.has(s.id),
            // Карточка спросит причину окном, прежде чем звать POST.
            requiresReason: Boolean(s.requires_reason),
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

    const order = await findOrder(id, 'id, order_id, number, status, site, is_own');
    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    if (order.status === body.status) return NextResponse.json({ ok: true, unchanged: true });

    // Проверяем переход на сервере: интерфейс мог отстать от настроек.
    const [{ data: statuses }, { data: transitions }] = await Promise.all([
        supabase.from('crm_statuses').select('id, name, external_code, requires_reason, is_working').eq('active', true),
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

    /**
     * Причина перевода словами.
     *
     * Запрет настраивается галочкой в карточке статуса, а не списком в коде:
     * сегодня это «Согласование отмены», завтра другой статус. Проверяем на
     * сервере — интерфейс мог отстать от настроек.
     */
    const reason = String(body.reason ?? '').trim();
    if ((to as any).requires_reason && reason.length < MIN_REASON) {
        return NextResponse.json(
            {
                error: 'reason_required',
                message: `Чтобы перевести заказ в «${(to as any).name}», напишите причину словами — коротко не считается.`,
            },
            { status: 409 },
        );
    }

    /**
     * До договора и счёта у клиента должен быть ИНН.
     *
     * Решение владельца 04.10.2026: требование переносим на тот момент, когда
     * менеджер ещё разговаривает с клиентом. Иначе заказ застревает на входе в
     * производство — когда работа уже считается сделанной. Переход запрещаем и
     * ставим задачу уточнить ИНН, чтобы требование не превратилось в тупик.
     */
    if ((INN_REQUIRED_STATUSES as readonly string[]).includes(body.status)) {
        const inn = await orderInn(Number((order as any).order_id ?? id));
        if (!inn) {
            const who = [session.user.first_name, session.user.last_name].filter(Boolean).join(' ')
                || session.user.email || session.user.role;
            const taskAdded = await ensureInnTask(String((order as any).number ?? id), who);
            return NextResponse.json(
                {
                    error: 'inn_required',
                    message: taskAdded ? `${INN_GATE_MESSAGE} Задача добавлена в список по заказу.` : INN_GATE_MESSAGE,
                },
                { status: 409 },
            );
        }
    }

    // Свой заказ меняем у себя: в RetailCRM его нет, и рубильник исходящих
    // записей к нему не относится.
    if ((order as any).is_own) {
        // Через editOwnOrder, а не прямым update: он же пишет историю заказа
        // («Статус заказа: Новый → В просчёте»).
        const result = await editOrder(Number((order as any).id), { statusCode: body.status });
        if (!result.ok) return NextResponse.json({ error: 'own_update_failed', details: result.reason }, { status: 409 });

        await saveStatusReason(Number((order as any).id), Number((order as any).order_id ?? (order as any).id), Number(session.user.retail_crm_manager_id) || null, to as any, reason);

        // Руками поставили «Передано в производство» — заказ так же встаёт в
        // очередь на отправку в ЦехУспех.
        let productionNote: string | null = null;
        if (body.status === PRODUCTION_STATUS) {
            const queued = await queueOrderForProduction(Number((order as any).order_id ?? (order as any).id));
            // Статус менять не мешаем, но причину говорим сразу: иначе менеджер
            // узнает об отказе только когда ЦехУспех вернёт ошибку.
            if (!queued.queued) productionNote = queued.reason;
        }

        return NextResponse.json({ ok: true, status: body.status, own: true, productionNote });
    }

    // Пока свой функционал не достроен, наружу не пишем — см. lib/retailcrm/outbound-guard.
    if (!(await isRetailcrmOutboundWriteEnabled())) {
        return NextResponse.json({ error: 'crm_write_disabled', message: RETAILCRM_WRITE_BLOCKED_MESSAGE }, { status: 423 });
    }

    const result = await updateExistingOrderInCrm(Number((order as any).order_id ?? id), { status: body.status }, order.site || undefined);
    if (!result.success) {
        return NextResponse.json({ error: 'crm_rejected', details: result.errorMsg || null }, { status: 502 });
    }

    // Локальную копию поправим сразу, чтобы список не показывал старое до ближайшего синка.
    await supabase.from('orders').update({ status: body.status }).eq('id', (order as any).id);
    await saveStatusReason(Number((order as any).id), Number((order as any).order_id ?? id), Number(session.user.retail_crm_manager_id) || null, to as any, reason);

    return NextResponse.json({ ok: true, status: body.status });
}
