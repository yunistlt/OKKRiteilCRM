import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { getConfigForPeriod } from '@/lib/salary/config';
import { collectEngineerMetrics } from '@/lib/salary/metrics';
import { businessDaysInMonth } from '@/lib/salary/engine';
import { listEngineerDictionary } from '@/lib/salary/schemes';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/salary/sim-engineer-baseline?year=&month=&codes=ivanov,petrov
// Реальные заказы инженеров-расчётчиков за baseline-месяц (сумма + время расчёта).
// Пересчёт ЗП по ползункам идёт на клиенте (compose) — сервер только отдаёт срез.
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const url = new URL(req.url);
        const year = Number(url.searchParams.get('year'));
        const month = Number(url.searchParams.get('month'));
        const codes = (url.searchParams.get('codes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
            return NextResponse.json({ error: 'Некорректный период' }, { status: 400 });
        }
        if (!codes.length) return NextResponse.json({ error: 'Не заданы инженеры' }, { status: 400 });

        const config = await getConfigForPeriod(year, month);
        const byItem = await collectEngineerMetrics(year, month, config);
        const dict = await listEngineerDictionary(config.engineer_field.code);
        const nameByCode = new Map(dict.map((d) => [d.itemCode, d.name]));

        const engineers = codes.map((code) => ({
            itemCode: code,
            name: nameByCode.get(code) ?? code,
            orders: (byItem.get(code) ?? []).map((o) => ({ orderId: o.orderId, sum: o.orderSum, raschetSeconds: o.raschetSeconds })),
        }));

        return NextResponse.json({ ok: true, year, month, businessDays: businessDaysInMonth(year, month), engineers });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
