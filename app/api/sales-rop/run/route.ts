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

/**
 * GET /api/sales-rop/run — прогон по ссылке, без кнопки.
 *
 * Нужен там, где интерфейса нет под рукой: ссылку можно открыть в браузере
 * телефона, положить на экран «Домой» или дать боту. Пускает та же сессия, что
 * и кнопку, — секрета в ссылке нет и быть не должно.
 *
 * Без параметров — сухой прогон: ссылка, открытая по ошибке или из истории,
 * не должна будить отдел продаж. Боевая рассылка — только по явному ?send=1.
 */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get('send') !== '1';

    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return new NextResponse('Доступ запрещён. Войдите в CRM под своей учётной записью и откройте ссылку снова.', {
            status: 403,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    try {
        const date = url.searchParams.get('date') || localToday();
        const result = await runMorning(date, { dryRun });
        const longest = result.preview.reduce((max, t) => Math.max(max, t.length), 0);

        // Отвечаем текстом, а не JSON: это открывают с телефона, и результат
        // должен читаться глазами, а не разбираться jq.
        const lines = [
            dryRun ? `ПРОВЕРКА (ничего не отправлено), ${date}` : `РАССЫЛКА, ${date}`,
            '',
            `Адресатов: ${result.managers}`,
            `Задач: ${result.tasks}`,
            `Самое длинное сообщение: ${longest} символов${longest > 3900 ? ' — уйдёт несколькими частями' : ''}`,
        ];
        if (!dryRun) {
            lines.push(
                result.failures.length === 0
                    ? 'Разослано всем.'
                    : `НЕ ДОСТАВЛЕНО (${result.failures.length}): ${result.failures.join('; ')}. Остальные планы ушли.`,
            );
        } else {
            lines.push('', 'Чтобы разослать: добавьте к ссылке ?send=1');
        }

        return new NextResponse(lines.join('\n'), {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    } catch (e: any) {
        return new NextResponse(`Прогон не удался: ${e.message}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }
}

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
