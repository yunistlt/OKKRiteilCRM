import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { runMorning } from '@/lib/sales-rop/service';
import { localToday } from '@/app/api/cron/rop-morning/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/sales-rop/run — ручной прогон утреннего плана из интерфейса.
//
// Тот же runMorning, что дёргает крон, но пускает по сессии, а не по
// CRON_SECRET. Смысл ровно один: когда утренняя рассылка сорвалась, догнать её
// должно быть делом одного нажатия с телефона — а не заголовка Authorization,
// который в браузере не задать, и секрета, переписанного в заметки.
//
// Повтор безопасен: задачи пишутся upsert'ом по (plan_date, order_id), даты
// контакта в CRM переставляются на то же число.

const BodySchema = z.object({
    // Сухой прогон: собрать план и вернуть текст, ничего не отправляя и не
    // записывая. Первое, что стоит сделать, прежде чем будить отдел продаж.
    dry: z.boolean().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }

        const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            return NextResponse.json({ error: 'Неверные параметры прогона' }, { status: 400 });
        }

        const dryRun = parsed.data.dry !== false;
        const result = await runMorning(parsed.data.date || localToday(), { dryRun });

        return NextResponse.json({ ok: true, dry: dryRun, ...result });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
