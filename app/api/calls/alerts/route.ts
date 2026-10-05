/**
 * Входящие звонки для всплывающего оповещения: кто звонит и по какому заказу.
 *
 * Евгения Матвеева 05.10.2026: «поступил входящий звонок, не показывает ОКК кто
 * звонит, заказ, нету никакой информации вообще». Панель телефона открывается
 * событием софтфона и до человека доходит не всегда; оповещение работает так
 * же, как по письмам и задачам, — опросом, и показывает то, ради чего его
 * смотрят: клиента, его заказ и менеджера.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const since = searchParams.get('since');
    // Звонок живёт минуты: первый заход смотрит последние пять, дальше — от
    // прошлой проверки.
    const from = since && !Number.isNaN(Date.parse(since))
        ? new Date(since)
        : new Date(Date.now() - 5 * 60 * 1000);

    const { data: calls, error } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, from_number, from_number_normalized, started_at')
        .eq('direction', 'incoming')
        .gt('started_at', from.toISOString())
        .order('started_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('[call-alerts] звонки не прочитались:', error.message);
        return NextResponse.json({ error: 'Не удалось прочитать звонки' }, { status: 500 });
    }

    const rows = (calls || []) as any[];
    if (!rows.length) return NextResponse.json({ calls: [], checkedAt: new Date().toISOString() });

    /**
     * Чей это номер. Ищем по последним десяти цифрам — в заказах номер записан
     * как придётся, и сравнение строк здесь уже подводило (поиск по телефону,
     * 05.10.2026).
     */
    const result = [];
    for (const call of rows) {
        let order: any = null;

        /**
         * Заказ звонка берём из привязки — той, что сделали в ОКК или RetailCRM
         * (`call_order_link`). Раньше здесь шёл поиск по телефону прямо в
         * оповещении: он показывал первый попавшийся заказ этого номера, даже
         * если звонят по другому. Угадывать мы перестали (решение владельца
         * 05.10.2026) — если привязки нет, менеджер указывает заказ сам.
         */
        const { data: link } = await supabase
            .from('call_order_link')
            .select('order_id')
            .eq('telphin_call_id', call.telphin_call_id)
            .limit(1);

        const linkedId = ((link ?? []) as any[])[0]?.order_id ?? null;
        if (linkedId) {
            const { data: found } = await supabase
                .from('orders')
                .select('number, manager_id, raw_payload')
                .eq('id', linkedId)
                .maybeSingle();
            order = (found as any) ?? null;
        }

        let managerName: string | null = null;
        if (order?.manager_id) {
            const { data: manager } = await supabase
                .from('managers')
                .select('first_name, last_name')
                .eq('id', order.manager_id)
                .maybeSingle();
            const row = manager as any;
            managerName = row ? [row.last_name, row.first_name].filter(Boolean).join(' ') : null;
        }

        const payload = order?.raw_payload ?? {};
        result.push({
            id: `call-${call.telphin_call_id}`,
            // Нужен, чтобы менеджер мог указать заказ прямо из оповещения.
            callId: call.telphin_call_id,
            phone: call.from_number,
            orderNumber: order?.number ?? null,
            clientName: payload.customer?.nickName
                || payload.contragent?.legalName
                || [payload.firstName, payload.lastName].filter(Boolean).join(' ')
                || null,
            managerName,
            startedAt: call.started_at,
        });
    }

    return NextResponse.json({ calls: result, checkedAt: new Date().toISOString() });
}
