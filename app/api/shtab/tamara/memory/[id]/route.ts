import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// DELETE /api/shtab/tamara/memory/[id] — забыть факт.
//
// Строка гасится, а не удаляется: по погашенным видно, что Тамара запоминала
// не то, и это повод поправить промпт свёртки, а не только забыть запись.

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const { error } = await supabase
            .from('shtab_tamara_memory')
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq('id', Number(params.id));
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
