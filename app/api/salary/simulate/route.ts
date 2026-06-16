import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { simulatePeriod } from '@/lib/salary/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/salary/simulate
// Считает период под черновиком правил (тариф/назначения/планы) и возвращает результат
// + фактический снимок для сравнения. НИЧЕГО НЕ СОХРАНЯЕТ — безопасно для закрытого периода.
const Body = z.object({
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    schemes: z.array(z.object({
        code: z.string(),
        blocks: z.array(z.object({ block_code: z.string(), params: z.any().optional(), enabled: z.boolean().optional() })),
    })).optional(),
    assignments: z.array(z.object({ managerId: z.number().int(), schemeCode: z.string() })).optional(),
    plans: z.object({
        personal: z.array(z.object({ managerId: z.number().int(), target: z.number().nullable() })).optional(),
        department: z.number().nullable().optional(),
    }).optional(),
});

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const parsed = Body.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Некорректные данные симуляции', details: parsed.error.flatten() }, { status: 400 });
        }
        const { year, month, schemes, assignments, plans } = parsed.data;
        const result = await simulatePeriod(year, month, {
            schemes: schemes?.map((s) => ({
                code: s.code,
                blocks: (s.blocks ?? []).filter((b) => b.enabled !== false).map((b) => ({ code: b.block_code, params: b.params ?? {} })),
            })),
            assignments,
            plans,
        });
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
