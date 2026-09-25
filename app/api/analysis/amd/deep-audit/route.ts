// @ts-nocheck
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTelphinToken } from '@/lib/telphin';
import { processCallTranscription } from '@/lib/transcription';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '10');

        // 1. Fetch Controlled Managers
        const { data: controlledManagers } = await supabase
            .from('manager_settings')
            .select('id')
            .eq('is_controlled', true);

        const controlledIds = (controlledManagers || []).map((m: any) => m.id.toString());

        if (controlledIds.length === 0) {
            return NextResponse.json({ message: 'No controlled managers selected in settings.' });
        }

        // 2. Звонки выбранных менеджеров, у которых нет расшифровки.
        //
        // ВНИМАНИЕ: этот разбор не работал. Он читал таблицу `calls`, которой в
        // базе нет — запрос падал при каждом обращении, и молча, потому что
        // ошибку никто не проверял глазами. Ниже переписано на живые таблицы:
        // заказы выбранных менеджеров → их звонки через общую связь
        // call_order_link → записи без расшифровки.
        const { data: managerOrders } = await supabase
            .from('orders')
            .select('id')
            .in('manager_id', controlledIds);
        const orderIds = ((managerOrders ?? []) as any[]).map((o) => Number(o.id));

        if (orderIds.length === 0) {
            return NextResponse.json({ message: 'No orders for controlled managers.', count: 0 });
        }

        const linkedCallIds = new Set<string>();
        for (let i = 0; i < orderIds.length; i += 300) {
            const { data: links } = await supabase
                .from('call_order_link')
                .select('telphin_call_id')
                .in('order_id', orderIds.slice(i, i + 300));
            for (const l of ((links ?? []) as any[])) linkedCallIds.add(String(l.telphin_call_id));
        }

        if (linkedCallIds.size === 0) {
            return NextResponse.json({ message: 'No pending calls found for controlled managers.', count: 0 });
        }

        const { data: rawCalls, error: fetchError } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, recording_url, duration_sec, started_at')
            .in('telphin_call_id', Array.from(linkedCallIds).slice(0, 2000))
            .is('transcript', null)
            .not('recording_url', 'is', null)
            .order('started_at', { ascending: false })
            .limit(limit);

        if (fetchError) throw fetchError;

        const calls = ((rawCalls ?? []) as any[]).map((c) => ({
            id: String(c.telphin_call_id),
            record_url: c.recording_url as string | null,
            duration: Number(c.duration_sec ?? 0),
        }));

        if (!calls || calls.length === 0) {
            return NextResponse.json({ message: 'No pending calls found for controlled managers.', count: 0 });
        }

        // 4. Process Batch
        const token = await getTelphinToken();
        const results = [];
        for (const call of calls) {
            console.log(`[DeepAudit] Processing call ${call.id}`);
            const result = await processCallTranscription(call.id, call.record_url!, token);
            results.push({
                id: call.id,
                duration: call.duration,
                ...result
            });
        }

        return NextResponse.json({
            success: true,
            processed: results.length,
            details: results
        });

    } catch (e: any) {
        console.error('[DeepAudit API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
