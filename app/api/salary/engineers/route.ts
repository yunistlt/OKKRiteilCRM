import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { getResolvedConfig } from '@/lib/salary/config';
import { deleteEngineerScheme, listEngineerRoster, listSchemes, saveEngineerRoster, saveScheme } from '@/lib/salary/schemes';

export const dynamic = 'force-dynamic';

function asOfParam(req: Request): string {
    const u = new URL(req.url);
    return u.searchParams.get('asOf') || new Date().toISOString().slice(0, 10);
}

// GET — реестр инженеров (справочник + опт-ин + назначение) + инженерные схемы на дату.
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const asOf = asOfParam(req);
        const config = await getResolvedConfig(asOf);
        const fieldCode = config.engineer_field.code;
        const [roster, schemes] = await Promise.all([listEngineerRoster(asOf, fieldCode), listSchemes(asOf, 'engineer')]);
        return NextResponse.json({ asOf, fieldCode, roster, schemes });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// PUT — сохранить версию инженерной схемы { code, name, effectiveFrom, prevEffectiveFrom, params }.
// Инженерная схема — ровно один блок procent_za_raschet; параметры редактируются формой.
export async function PUT(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const body = await req.json();
        if (!body.code || !body.name || !body.effectiveFrom) return NextResponse.json({ error: 'Нужны code, name, effectiveFrom' }, { status: 400 });
        await saveScheme({
            code: String(body.code),
            name: String(body.name),
            effectiveFrom: String(body.effectiveFrom),
            prevEffectiveFrom: body.prevEffectiveFrom ? String(body.prevEffectiveFrom) : null,
            blocks: [{ block_code: 'procent_za_raschet', params: body.params ?? {} }],
            actor: session?.user?.email ?? null,
            participantKind: 'engineer',
        });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}

// POST — сохранить реестр { action:'roster', rows:[{itemCode,schemeCode}], effectiveFrom }
//        либо удалить схему { action:'delete_scheme', schemeCode }.
export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const body = await req.json();
        if (body.action === 'delete_scheme') {
            if (!body.schemeCode) return NextResponse.json({ error: 'Нужен schemeCode' }, { status: 400 });
            await deleteEngineerScheme({ code: String(body.schemeCode), actor: session?.user?.email ?? null });
            return NextResponse.json({ ok: true });
        }
        // roster
        const rows = Array.isArray(body.rows)
            ? body.rows.filter((r: any) => r?.itemCode && r?.schemeCode).map((r: any) => ({ itemCode: String(r.itemCode), schemeCode: String(r.schemeCode) }))
            : [];
        const effectiveFrom = String(body.effectiveFrom || '');
        if (!effectiveFrom) return NextResponse.json({ error: 'Нужна effectiveFrom' }, { status: 400 });
        await saveEngineerRoster({ rows, effectiveFrom, actor: session?.user?.email ?? null });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
