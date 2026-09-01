import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Пересборка канона клиентов ЗП (склейка карточек одного юрлица по ИНН).
// Зачем крон: открытый период считается НА ЛЕТУ (без recalcAndPersist), а менеджеры
// заводят новую карточку клиента почти на каждый заказ — без свежего канона постоянный
// клиент считается новым (инцидент по заказу 54232, ООО «ХРС-Снабжение»).
// Пересборка идемпотентна и занимает ~12 с на всей базе, поэтому раз в сутки.
export async function GET(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startedAt = Date.now();
    const { data, error } = await supabase.rpc('salary_rebuild_client_canon');
    if (error) {
        console.error('[salary-client-canon] rebuild error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const changed = Number(data ?? 0);
    console.log(JSON.stringify({ tag: 'salary-client-canon', changed, ms: Date.now() - startedAt }));
    return NextResponse.json({ ok: true, changed, ms: Date.now() - startedAt });
}
