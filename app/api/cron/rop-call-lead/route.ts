import { NextRequest, NextResponse } from 'next/server';
import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { runCallLeadReview } from '@/lib/sales-rop/call-lead';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/rop-call-lead — ИИ-РОП заводит заказ по звонку с незнакомого
// номера, если менеджер поговорил и не завёл. Логика и журнал решений —
// lib/sales-rop/call-lead.ts, таблица call_lead_reviews. Включается настройкой
// «Заводить заказ по звонку» (call_lead_enabled) в настройках ИИ-РОПа.
export async function GET(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const result = await runCallLeadReview();
        const created = result.decisions.filter((d) => d.decision === 'created').length;
        const errors = result.decisions.filter((d) => d.decision === 'error').length;
        return NextResponse.json({ ok: true, status: result.status, reviewed: result.decisions.length, created, errors });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
}
