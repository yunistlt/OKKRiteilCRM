import { supabase } from '@/utils/supabase';
import { applyKnob, findKnob, validateKnob } from './index';
import { MODULE_TITLES, knobModule, type ModuleId } from './types';

/**
 * Предложения изменить настройку.
 *
 * Модель не пишет в прод. Она кладёт сюда строку «что, на что и зачем», человек
 * видит её карточкой в разговоре и нажимает «применить» или «отклонить».
 *
 * Между этими двумя моментами проходит время, и за это время настройку мог
 * изменить кто-то другой прямо на её экране. Поэтому применение не доверяет
 * снимку: значение читается заново, и если оно разошлось со снимком, человеку
 * сообщают — молча затереть чужую правку хуже, чем ничего не сделать.
 */

export type Proposal = {
    id: number;
    knob_id: string;
    module: ModuleId;
    title: string;
    current_value: string | null;
    new_value: string;
    effective_from: string | null;
    reason: string;
    evidence: string | null;
    status: 'pending' | 'applied' | 'rejected' | 'failed';
    created_at: string;
    decided_at: string | null;
    decided_by: string | null;
    error: string | null;
};

const TABLE = 'setting_change_proposal';

export async function createProposal(input: {
    knobId: string;
    newValue: string;
    reason: string;
    evidence?: string;
    effectiveFrom?: string;
    conversationId?: number | null;
}): Promise<{ proposal: Proposal; normalized: string }> {
    const knob = await findKnob(input.knobId);

    // Проверяем до показа человеку: предложение, которое заведомо не применится,
    // это не предложение, а мусор в очереди.
    const normalized = await validateKnob(input.knobId, input.newValue, {
        effectiveFrom: input.effectiveFrom,
    });

    if (normalized === (knob.value ?? '')) {
        throw new Error(`«${knob.title}» уже стоит в этом значении — менять нечего`);
    }

    // Старое открытое предложение по той же ручке снимаем: последнее слово за
    // последним разговором, а два открытых предложения на одну настройку
    // человек подтвердил бы оба.
    await supabase
        .from(TABLE)
        .update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: 'вытеснено новым предложением' })
        .eq('knob_id', input.knobId)
        .eq('status', 'pending');

    const { data, error } = await supabase
        .from(TABLE)
        .insert({
            knob_id: input.knobId,
            module: knob.module,
            title: knob.title,
            current_value: knob.value,
            new_value: normalized,
            effective_from: input.effectiveFrom ?? null,
            reason: input.reason,
            evidence: input.evidence ?? null,
            conversation_id: input.conversationId ?? null,
        })
        .select()
        .single();
    if (error) throw new Error(error.message);

    return { proposal: data as Proposal, normalized };
}

export async function listProposals(opts: { status?: Proposal['status']; limit?: number } = {}): Promise<Proposal[]> {
    let q = supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(opts.limit ?? 20);
    if (opts.status) q = q.eq('status', opts.status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Proposal[];
}

export async function getProposal(id: number): Promise<Proposal> {
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Предложения №${id} нет`);
    return data as Proposal;
}

export async function rejectProposal(id: number, actor: string): Promise<Proposal> {
    const proposal = await getProposal(id);
    if (proposal.status !== 'pending') throw new Error('Это предложение уже рассмотрено');

    const { data, error } = await supabase
        .from(TABLE)
        .update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: actor })
        .eq('id', id)
        .select()
        .single();
    if (error) throw new Error(error.message);
    return data as Proposal;
}

/**
 * Применить подтверждённое человеком предложение.
 *
 * `force` — ответ на случай «значение успело измениться»: человек видит, что
 * настройка теперь другая, и решает сам. По умолчанию применения не будет.
 */
export async function applyProposal(
    id: number,
    actor: string,
    opts: { force?: boolean } = {},
): Promise<Proposal> {
    const proposal = await getProposal(id);
    if (proposal.status !== 'pending') throw new Error('Это предложение уже рассмотрено');

    const knob = await findKnob(proposal.knob_id);
    if (!opts.force && (knob.value ?? '') !== (proposal.current_value ?? '')) {
        throw new Error(
            `«${knob.title}» изменилась с момента предложения: было «${proposal.current_value}», сейчас «${knob.value}». Подтвердите ещё раз, если всё равно ставим «${proposal.new_value}».`,
        );
    }

    try {
        await applyKnob(proposal.knob_id, proposal.new_value, {
            actor,
            effectiveFrom: proposal.effective_from ?? undefined,
            note: proposal.reason,
        });
    } catch (e: any) {
        // Провал не прячем в лог: предложение остаётся видимым, с причиной.
        await supabase
            .from(TABLE)
            .update({ status: 'failed', decided_at: new Date().toISOString(), decided_by: actor, error: String(e.message ?? e) })
            .eq('id', id);
        throw e;
    }

    const { data, error } = await supabase
        .from(TABLE)
        .update({ status: 'applied', decided_at: new Date().toISOString(), decided_by: actor, error: null })
        .eq('id', id)
        .select()
        .single();
    if (error) throw new Error(error.message);
    return data as Proposal;
}

/** Как показать предложение человеку и модели одной строкой. */
export function describeProposal(p: Proposal): string {
    const module = knobModule(p.knob_id);
    const where = module ? MODULE_TITLES[module] : p.module;
    const when = p.effective_from ? `, с ${p.effective_from}` : '';
    return `${where} → «${p.title}»: «${p.current_value || 'не задано'}» → «${p.new_value}»${when}`;
}
