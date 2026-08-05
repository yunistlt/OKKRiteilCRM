import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { sendPayrollToAccounting } from '@/lib/salary/notify-accounting';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/salary/send-to-accounting  body: { year, month }
// Ручная отправка ведомости закрытого периода (дубль автоматической при закрытии).
export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const { year, month } = await req.json();
        if (!year || !month) return NextResponse.json({ error: 'Нужны year и month' }, { status: 400 });

        const delivery = await sendPayrollToAccounting({
            year: Number(year),
            month: Number(month),
            actor: session?.user?.email ?? null,
            trigger: 'manual',
        });

        if (!delivery.ok) {
            const reason = delivery.skipped
                || delivery.failed.map((f) => `${f.name} — ${f.error}`).join('; ')
                || 'неизвестная ошибка';
            return NextResponse.json({ error: `Не отправлено: ${reason}` }, { status: delivery.skipped ? 400 : 502 });
        }
        return NextResponse.json({ ok: true, sent: delivery.sent, failed: delivery.failed });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
