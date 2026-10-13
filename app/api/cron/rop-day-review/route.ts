import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { buildDayReview } from '@/lib/sales-rop/day-review';
import { backfillTouches } from '@/lib/sales-rop/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/rop-day-review — собрать разбор вчерашнего дня каждому менеджеру.
 *
 * Идёт до утреннего плана (rop-morning в 08:00 МСК): разбор читают перед
 * планом, а не после. Разбор ложится в sales_rop_day_review, оттуда его берёт
 * шлюз чтения и показывает человеку до начала работы.
 *
 * Разговоров за день нет, расшифровок нет, модель недоступна — разбора не
 * будет, и это нормально: нет документа, нет шлюза, отдел работает.
 */
export async function GET(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const url = new URL(req.url);
        // Вчера по московскому календарю.
        const date = url.searchParams.get('date')
            || new Date(Date.now() + 3 * 3600e3 - 24 * 3600e3).toISOString().slice(0, 10);
        const only = url.searchParams.get('manager');

        /**
         * Сначала досверяем вчерашний день: если вечерний прогон не записал
         * касания, разбор прочитает пустоту как «не сделано ни одной задачи».
         * Так и вышло 6 октября.
         */
        const backfill = await backfillTouches(date);

        /**
         * Разбор получают УЧАСТНИКИ ОТДЕЛА ПРОДАЖ, а не все, у кого есть
         * добавочный. Состав берём из реестра участников — того же, по
         * которому считается зарплата: один источник правды, и отдел не
         * расходится между двумя списками.
         *
         * Иначе в разбор попадают все, кто берёт трубку: секретарь, логист,
         * владелец. В первом прогоне так и вышло — четыре разбора вместо трёх.
         */
        const { data: participants } = await supabase
            .from('salary_participant')
            .select('manager_id');
        const ids = ((participants ?? []) as any[]).map((p) => Number(p.manager_id)).filter(Number.isFinite);

        const { data: managers } = ids.length
            ? await supabase
                .from('managers')
                .select('id, first_name, last_name, active, telphin_extension')
                .in('id', ids)
                .eq('active', true)
                .not('telphin_extension', 'is', null)
            : { data: [] as any[] };

        const list = ((managers ?? []) as any[]).filter((m) => !only || String(m.id) === only);
        const done: Array<{ manager: string; score?: number; reason?: string }> = [];

        for (const m of list) {
            const name = [m.last_name, m.first_name].filter(Boolean).join(' ') || `#${m.id}`;
            try {
                const res = await buildDayReview(Number(m.id), name, date);
                done.push({ manager: name, score: res.score, reason: res.reason });
            } catch (e: any) {
                done.push({ manager: name, reason: e?.message || 'сбой разбора' });
            }
        }

        return NextResponse.json({ ok: true, date, backfill, managers: done });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
