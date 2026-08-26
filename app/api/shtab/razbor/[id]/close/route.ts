import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// POST /api/shtab/razbor/[id]/close — принять стратегию и закрыть разбор.
//
// Вместе с разбором закрываются минусы, которые он взялся закрыть. Двумя
// запросами это означало бы, что сбой между ними оставляет разбор закрытым, а
// минусы открытыми — реестр врёт, приоритетная область считается по неверным
// числам. Поэтому закрытие идёт функцией shtab_close_razbor: одна транзакция.

const CloseSchema = z.object({
    minus_ids: z.array(z.number().int().positive()).max(200).default([]),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const id = Number(params.id);
        if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const parsed = CloseSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }

        const { error: linkError } = await supabase.rpc('shtab_set_razbor_minuses', {
            p_razbor_id: id,
            p_minus_ids: parsed.data.minus_ids,
        });
        if (linkError) throw new Error(linkError.message);

        const { data: closed, error: closeError } = await supabase.rpc('shtab_close_razbor', {
            p_razbor_id: id,
        });
        if (closeError) throw new Error(closeError.message);

        return NextResponse.json({ closed_minuses: Number(closed ?? 0) });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
