import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { buildPayrollWorkbook } from '@/lib/salary/export';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // открытый период считается на лету

// GET /api/salary/export?period=YYYY-MM — выгрузка расчёта в Excel
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const { searchParams } = new URL(req.url);
        const period = searchParams.get('period') || '';
        const m = period.match(/^(\d{4})-(\d{1,2})$/);
        if (!m) return NextResponse.json({ error: 'period в формате YYYY-MM' }, { status: 400 });

        const book = await buildPayrollWorkbook(Number(m[1]), Number(m[2]));
        if (!book) return NextResponse.json({ error: 'Период не рассчитан' }, { status: 404 });

        return new NextResponse(new Blob([book.buffer]), {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${book.filename}"`,
            },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
