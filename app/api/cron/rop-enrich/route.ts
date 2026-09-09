import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { enrichClients } from '@/lib/sales-rop/enrich';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/rop-enrich — кто эти клиенты: отрасль, филиалы, жив ли.
//
// Ходит пачками по 200: 5 084 клиента разом не нужны никому, а дневной лимит
// подсказок Dadata один на всю компанию. За неделю ночных прогонов база
// обогащается целиком, дальше — только новые и те, кого не проверяли полгода.
export async function GET(req: NextRequest) {
    const auth = req.headers.get('authorization');
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = Math.min(500, Number(req.nextUrl.searchParams.get('limit') || 200));

    try {
        const result = await enrichClients(limit);
        // Множитель потенциала пересчитываем сразу: иначе свежие данные лежат
        // мёртвым грузом до следующей ночи.
        const { data: scored } = await supabase.rpc('sales_refresh_client_potential');
        return NextResponse.json({ ok: true, ...result, scored: Number(scored ?? 0) });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
