import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { addDraftAd, directSandbox, failed } from '@/lib/yandex/direct';

export const dynamic = 'force-dynamic';

// Предложения Тамары создать объявление в Яндекс Директе.
//
// GET  — что ждёт решения (и чем кончились прошлые).
// POST — решение владельца: создать или отклонить.
//
// Создание идёт только отсюда и только от владельца: RBAC /api/shtab пускает
// admin. Объявление кладётся черновиком, на модерацию не уходит и показов не
// получает — отправляет его владелец сам, в интерфейсе Директа.

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const { data, error } = await supabase
            .from('ad_draft_proposal')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(30);
        if (error) throw new Error(error.message);

        return NextResponse.json({ proposals: data ?? [] });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

const DecisionSchema = z.object({
    id: z.number().int().positive(),
    decision: z.enum(['create', 'reject']),
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = DecisionSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Некорректные данные' }, { status: 400 });
        }
        const actor = session.user.email || String(session.user.id ?? 'владелец');

        const { data: row, error } = await supabase
            .from('ad_draft_proposal')
            .select('*')
            .eq('id', parsed.data.id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!row) return NextResponse.json({ error: 'Предложение не найдено' }, { status: 404 });
        if ((row as any).status !== 'pending') {
            return NextResponse.json({ error: 'По этому предложению решение уже принято' }, { status: 409 });
        }

        if (parsed.data.decision === 'reject') {
            const { data: upd } = await supabase
                .from('ad_draft_proposal')
                .update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: actor })
                .eq('id', parsed.data.id)
                .select('*')
                .single();
            return NextResponse.json({ proposal: upd });
        }

        // Контур мог смениться между предложением и нажатием: предложение
        // готовилось в песочнице, а токен с тех пор перевели на боевой — или
        // наоборот. Молча создать объявление не в том контуре нельзя.
        if ((row as any).sandbox !== directSandbox()) {
            return NextResponse.json(
                {
                    error: (row as any).sandbox
                        ? 'Предложение готовилось в песочнице, а Директ сейчас боевой. Попроси Тамару предложить заново — чтобы объявление не ушло в настоящий кабинет по ошибке.'
                        : 'Предложение готовилось на боевом Директе, а сейчас включена песочница. Объявление попало бы не туда.',
                },
                { status: 409 },
            );
        }

        const created = await addDraftAd({
            adGroupId: Number((row as any).ad_group_id),
            title: String((row as any).title),
            title2: (row as any).title2 ? String((row as any).title2) : undefined,
            text: String((row as any).body),
            href: String((row as any).href),
        });

        if (failed(created)) {
            const { data: upd } = await supabase
                .from('ad_draft_proposal')
                .update({
                    status: 'failed',
                    error: created.reason,
                    decided_at: new Date().toISOString(),
                    decided_by: actor,
                })
                .eq('id', parsed.data.id)
                .select('*')
                .single();
            return NextResponse.json({ proposal: upd, error: created.reason }, { status: 502 });
        }

        // Директ отвечает на каждое объявление отдельно: номер либо отказ.
        const first = created.AddResults?.[0] ?? {};
        const adId = first.Id ?? null;
        const refusal = (first.Errors ?? []).map((e: any) => e.Message).join('; ') || null;

        const { data: upd } = await supabase
            .from('ad_draft_proposal')
            .update({
                status: adId ? 'created' : 'failed',
                direct_ad_id: adId,
                error: refusal,
                decided_at: new Date().toISOString(),
                decided_by: actor,
            })
            .eq('id', parsed.data.id)
            .select('*')
            .single();

        return NextResponse.json({ proposal: upd, ad_id: adId, error: refusal });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
