import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { assignManagerScheme, deleteOrArchiveScheme, listArchivedSchemes, listAssignments, listSchemes, restoreScheme, saveScheme, unassignManager } from '@/lib/salary/schemes';

export const dynamic = 'force-dynamic';

function asOfParam(req: Request): string {
    const u = new URL(req.url);
    return u.searchParams.get('asOf') || new Date().toISOString().slice(0, 10);
}

// GET — схемы (последние версии) + менеджеры + назначения (реестр) на дату.
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const asOf = asOfParam(req);
        const [schemes, assignments, archived, mgrs] = await Promise.all([
            listSchemes(asOf),
            listAssignments(asOf),
            listArchivedSchemes(),
            supabase.from('managers').select('id,first_name,last_name,active').order('id', { ascending: true }),
        ]);
        const managers = ((mgrs.data as any[]) ?? []).map((m) => ({ id: Number(m.id), name: [m.first_name, m.last_name].filter(Boolean).join(' ') || `#${m.id}`, active: m.active }));
        return NextResponse.json({ asOf, schemes, assignments, archived, managers });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// PUT — сохранить версию схемы { code, name, effectiveFrom, blocks: [{block_code, params, enabled?}] }
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
            blocks: Array.isArray(body.blocks) ? body.blocks : [],
            actor: session?.user?.email ?? null,
        });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}

// DELETE — удалить роль ?code=... (или заархивировать, если уже считалась ЗП).
export async function DELETE(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const code = new URL(req.url).searchParams.get('code');
        if (!code) return NextResponse.json({ error: 'Нужен code' }, { status: 400 });
        const result = await deleteOrArchiveScheme({ code, actor: session?.user?.email ?? null });
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}

// POST — назначить/снять схему менеджеру { action:'assign'|'unassign', managerId, schemeCode?, effectiveFrom }
//        либо восстановить роль из архива { action:'restore_scheme', schemeCode }.
export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const body = await req.json();
        if (body.action === 'restore_scheme') {
            if (!body.schemeCode) return NextResponse.json({ error: 'Нужен schemeCode' }, { status: 400 });
            await restoreScheme({ code: String(body.schemeCode), actor: session?.user?.email ?? null });
            return NextResponse.json({ ok: true });
        }
        const managerId = Number(body.managerId);
        const effectiveFrom = String(body.effectiveFrom || '');
        if (!managerId || !effectiveFrom) return NextResponse.json({ error: 'Нужны managerId и effectiveFrom' }, { status: 400 });
        if (body.action === 'unassign') {
            await unassignManager({ managerId, effectiveFrom });
        } else {
            if (!body.schemeCode) return NextResponse.json({ error: 'Нужен schemeCode' }, { status: 400 });
            await assignManagerScheme({ managerId, schemeCode: String(body.schemeCode), effectiveFrom, actor: session?.user?.email ?? null });
        }
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
