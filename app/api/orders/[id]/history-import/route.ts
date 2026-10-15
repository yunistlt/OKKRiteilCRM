/**
 * Кнопка «Скачать историю из ритейла» в карточке заказа.
 *
 * Зачем: полная история переносилась к нам только с 01.01.2025 — у заказов
 * старше в ОКК видны одни смены статуса. По заказу 32321 в RetailCRM 66
 * записей против наших 5 (жалоба 15.10.2026: «в новой ОКК нет по нему истории,
 * по звонкам и менеджеру»). Массовую докачку владелец отменил: тянем по
 * одному заказу, когда он кому-то понадобился.
 *
 * ГЛАВНОЕ ПРАВИЛО (требование владельца 15.10.2026): скачивание НИЧЕГО не
 * затирает. Строки, которые у нас уже есть, не трогаются — ни единым полем.
 * Добавляются только те записи RetailCRM, которых у нас нет. Ничего не
 * удаляется и не перезаписывается, поэтому нажать кнопку второй раз безопасно.
 *
 * Рубильник чтения из RetailCRM (lib/retailcrm/inbound-guard.ts) здесь
 * сознательно не спрашивается: он бережёт РАБОЧИЕ поля заказа от перезаписи
 * чужим снимком, а мы пишем только в журнал истории и только недостающее.
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { resolveOrderRef } from '@/lib/own-crm/order-ref';
import { fetchRetailCrmOrderHistory } from '@/lib/retailcrm/orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const ref = await resolveOrderRef(id);
    if (!ref) {
        return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    // Свои заказы в RetailCRM не заводились — там про них ничего нет.
    if (ref.orderId >= 900_000_000) {
        return NextResponse.json({
            error: 'Это заказ ОКК, в RetailCRM его никогда не было — скачивать нечего.',
        }, { status: 400 });
    }

    let history: any[];
    try {
        history = await fetchRetailCrmOrderHistory(ref.orderId);
    } catch (e: any) {
        return NextResponse.json({
            error: `RetailCRM не ответила: ${e?.message || 'неизвестная ошибка'}`,
        }, { status: 502 });
    }

    if (!history.length) {
        return NextResponse.json({ ok: true, fetched: 0, added: 0, existed: 0 });
    }

    // Что из пришедшего у нас уже лежит. Эти строки остаются как есть.
    const ids = history.map((it) => it.id).filter((v) => v != null);
    const { data: known, error: knownError } = await supabase
        .from('order_history_log')
        .select('retailcrm_history_id')
        .in('retailcrm_history_id', ids);

    if (knownError) {
        return NextResponse.json({ error: `Не прочитали свою историю: ${knownError.message}` }, { status: 500 });
    }

    const have = new Set(((known as any[]) ?? []).map((r) => Number(r.retailcrm_history_id)));

    const rows = history
        .filter((it) => it.id != null && it.order?.id && !have.has(Number(it.id)))
        .map((it) => ({
            retailcrm_history_id: it.id,
            retailcrm_order_id: it.order.id,
            field: it.field,
            old_value: typeof it.oldValue === 'object' ? JSON.stringify(it.oldValue) : String(it.oldValue ?? ''),
            new_value: typeof it.newValue === 'object' ? JSON.stringify(it.newValue) : String(it.newValue ?? ''),
            user_data: it.user || null,
            occurred_at: it.createdAt,
        }));

    if (rows.length) {
        // ignoreDuplicates — на случай, если кнопку нажали дважды разом:
        // совпавшая строка пропускается, а не переписывается.
        const { error } = await supabase
            .from('order_history_log')
            .upsert(rows, { onConflict: 'retailcrm_history_id', ignoreDuplicates: true });

        if (error) {
            return NextResponse.json({ error: `Не записали историю: ${error.message}` }, { status: 500 });
        }
    }

    return NextResponse.json({
        ok: true,
        fetched: history.length,
        added: rows.length,
        existed: history.length - rows.length,
    });
}
