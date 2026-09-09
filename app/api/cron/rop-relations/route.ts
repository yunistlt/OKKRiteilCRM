import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/rop-relations — ночной пересчёт отношений с клиентами.
//
// Отдельным кроном, а не внутри утреннего прогона: снимок нужен и другим
// потребителям, а утренний план должен читать готовое. Прогон занимает около двух
// секунды на всю базу, но зависит от синка клиентов и заказов — поэтому идёт
// после них и до плана.
export async function GET(req: NextRequest) {
    const auth = req.headers.get('authorization');
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data, error } = await supabase.rpc('sales_refresh_client_relations');
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, clients: Number(data ?? 0) });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
