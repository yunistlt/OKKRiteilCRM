import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { formatKnowledge, getTamaraPrompt, parseStructured, renderTemplate, runTamara, searchTamaraKnowledge } from '@/lib/shtab/tamara';
import { BLOCKS_SCHEMA } from '@/lib/shtab/program-schema';
import { goalLine } from '@/lib/shtab/program-context';
import type { BlockDraft } from '@/lib/shtab/programs';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/shtab/tamara/blocks — Тамара предлагает нарезку стратегии на блоки.
//
// Именно предлагает: черновик возвращается на экран, а в базу его кладёт владелец
// отдельным действием. Та же граница, что и с минусами — она советует, не пишет.

const Schema = z.object({ razbor_id: z.number().int().positive() });

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = Schema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }

        const { data: razbor, error } = await supabase
            .from('shtab_razbor')
            .select('id, strategy, goal_fix, goal_grow')
            .eq('id', parsed.data.razbor_id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!razbor) return NextResponse.json({ error: 'Разбор не найден' }, { status: 404 });

        const strategy = (razbor.strategy || '').trim();
        if (!strategy) {
            // Резать нечего, и это не ошибка модели — это порядок разбора.
            return NextResponse.json(
                { error: 'Стратегия ещё не написана. Блоки режутся из её текста, поэтому сначала стратегия.' },
                { status: 409 },
            );
        }

        const goal = goalLine(razbor.goal_fix, razbor.goal_grow);
        const [prompt, knowledge] = await Promise.all([
            getTamaraPrompt('shtab_tamara_blocks'),
            searchTamaraKnowledge('как резать стратегию на логические блоки'),
        ]);

        const answer = await runTamara({
            prompt,
            purpose: 'shtab_tamara_blocks',
            // Инструменты не нужны: текст стратегии уже в сообщении, а фактов о
            // компании нарезка не требует — она делит написанное, а не изучает цех.
            withTools: false,
            schema: BLOCKS_SCHEMA as any,
            userContent: renderTemplate(prompt.userPromptTemplate, {
                goal,
                strategy,
                knowledge_context: formatKnowledge(knowledge),
            }),
        });

        const draft = parseStructured<{ blocks: BlockDraft[] }>(answer.reply, 'Нарезка на блоки');
        return NextResponse.json({ blocks: draft.blocks ?? [], model: answer.model });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
