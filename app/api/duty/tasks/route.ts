import { NextRequest, NextResponse } from 'next/server';
import { checkDutyToken, dutyTokenConfigured } from '@/lib/shtab/duty-auth';
import { dutyView } from '@/lib/shtab/duty';

export const dynamic = 'force-dynamic';

// GET /api/duty/tasks?uid=<идентификатор в ЦехУспехе>
//
// Задачи одного человека — то, чем консультант ЦехУспеха помогает ему работать.
// Отдаётся ТОЛЬКО его собственное: программы, закреплённые за его постом, и их
// задачи. Ни минусов, ни приоритетной области, ни чужих программ, ни стратегии.

export async function GET(req: NextRequest) {
    if (!dutyTokenConfigured()) {
        return NextResponse.json({ error: 'Служебный доступ не настроен: нет SHTAB_DUTY_TOKEN' }, { status: 503 });
    }
    if (!checkDutyToken(req.headers.get('authorization'))) {
        return NextResponse.json({ error: 'Неверный токен' }, { status: 401 });
    }

    try {
        const uid = (req.nextUrl.searchParams.get('uid') || '').trim();
        if (!uid) return NextResponse.json({ error: 'Не передан uid' }, { status: 400 });

        const view = await dutyView(uid);

        if (!view.post) {
            // Молчать нельзя: консультант должен сказать человеку, что его пост в
            // Штабе не заведён, а не делать вид, что задач просто нет.
            return NextResponse.json({
                known: false,
                reason: 'Пост с таким идентификатором в Штабе не заведён. Заводит владелец, вкладка «Цели и посты».',
                post: null,
                programs: [],
            });
        }

        return NextResponse.json({ known: true, ...view });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
