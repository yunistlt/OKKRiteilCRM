import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import {
    getResolvedConfig,
    listConfigHistory,
    updateConfig,
    SALARY_CONFIG_KEYS,
} from '@/lib/salary/config';

export const dynamic = 'force-dynamic';

// GET /api/salary/config?asOf=YYYY-MM-DD&history=1
// Возвращает резолвнутый конфиг на дату + (опц.) историю версий.
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const asOf = searchParams.get('asOf') || new Date().toISOString().slice(0, 10);
        const withHistory = searchParams.get('history') === '1';

        const config = await getResolvedConfig(asOf);
        const history = withHistory ? await listConfigHistory() : undefined;

        return NextResponse.json({ asOf, keys: SALARY_CONFIG_KEYS, config, history });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// PUT /api/salary/config
// body: { key, value, effectiveFrom: 'YYYY-MM-DD', note? }
// Пишет новую версию ключа (с валидацией по Zod) + аудит.
export async function PUT(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }

        const body = await req.json();
        const { key, value, effectiveFrom, note } = body ?? {};
        if (!key || value === undefined || !effectiveFrom) {
            return NextResponse.json(
                { error: 'Нужны поля key, value, effectiveFrom' },
                { status: 400 },
            );
        }

        await updateConfig({
            key,
            value,
            effectiveFrom,
            note,
            actor: session?.user?.email ?? null,
        });

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
