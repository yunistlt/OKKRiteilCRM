import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkDutyToken, dutyTokenConfigured } from '@/lib/shtab/duty-auth';
import { REPORT_KINDS, ownsTask, saveReport } from '@/lib/shtab/duty';

export const dynamic = 'force-dynamic';

// POST /api/duty/report — исполнитель отчитался по задаче.
//
// «Сделал», «застрял на том-то», «сказал по делу». Отметка о выполнении и запись
// в журнал ставятся одной транзакцией: отметка без объяснения теряет смысл, а
// объяснение без отметки оставляет задачу висеть просроченной.

const Schema = z.object({
    uid: z.string().trim().min(1, 'Не передан uid').max(200),
    task_id: z.number().int().positive(),
    kind: z.enum(REPORT_KINDS),
    text: z.string().max(4000).default(''),
});

export async function POST(req: NextRequest) {
    if (!dutyTokenConfigured()) {
        return NextResponse.json({ error: 'Служебный доступ не настроен: нет SHTAB_DUTY_TOKEN' }, { status: 503 });
    }
    if (!checkDutyToken(req.headers.get('authorization'))) {
        return NextResponse.json({ error: 'Неверный токен' }, { status: 401 });
    }

    try {
        const parsed = Schema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        const { uid, task_id, kind, text } = parsed.data;

        // Проверяем принадлежность на КАЖДОЙ записи, а не только при чтении: зная
        // чужой номер задачи, иначе можно было бы отметить её выполненной, и
        // сводка владельца начала бы врать.
        if (!(await ownsTask(uid, task_id))) {
            return NextResponse.json({ error: 'Эта задача не за вами' }, { status: 403 });
        }

        if (kind === 'stuck' && !text.trim()) {
            // «Застрял» без объяснения бесполезен: на планёрке нечего разбирать.
            return NextResponse.json({ error: 'Скажи, на чём именно застрял — иначе помочь нечем' }, { status: 400 });
        }

        const id = await saveReport(task_id, kind, text, uid);
        return NextResponse.json({ ok: true, report_id: id });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
