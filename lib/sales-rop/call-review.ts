import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';

// Разбор дня по расшифровкам звонков.
//
// Счётчик звонков обманывает: сорок звонков выглядят работой, а в расшифровках
// половина — «Компания ЗМК, добрый день» на четыре секунды и «Продолжение
// следует...» (так распознаётся тишина автоответчика). Считать их разговорами
// значит выдавать менеджеру красивую цифру вместо правды.
//
// Поэтому день разбирает модель: она читает расшифровки и отделяет разговор от
// гудка. Числа при этом остаются на коде — их модель не считает, ей достаётся
// вопрос «что происходило», а не «сколько».

export type DayCall = {
    at: string;
    direction: string;
    durationSec: number;
    phone: string | null;
    orderNumber: string | null;
    transcript: string | null;
};

/** Пустой звонок: гудки, автоответчик, тишина, распознанная как речь. */
export function isEmptyCall(call: DayCall): boolean {
    if (call.durationSec < 15) return true;
    const text = (call.transcript ?? '').trim();
    if (!text) return call.durationSec < 25;

    // Whisper на тишине выдаёт заставки вроде «Продолжение следует...» и
    // «Субтитры сделал DimaTorzok» — это не разговор, а шум распознавания.
    const noise = /продолжение следует|субтитры|редактор субтитров|dimatorzok/i;
    if (noise.test(text) && text.length < 120) return true;

    // Одна реплика приветствия и всё — до клиента не дошло.
    return text.length < 80;
}

export async function loadDayCalls(date: string, managerRcId: string): Promise<DayCall[]> {
    const { data, error } = await supabase.rpc('sales_rop_day_calls', { p_date: date, p_manager: managerRcId });
    if (error) throw new Error(error.message);
    return ((data ?? []) as any[]).map((r) => ({
        at: String(r.call_at),
        direction: r.direction,
        durationSec: Number(r.duration_sec ?? 0),
        phone: r.phone ?? null,
        orderNumber: r.order_number ?? null,
        transcript: r.transcript ?? null,
    }));
}

/** Текст для модели: только те звонки, где есть что читать. */
export function renderDayCalls(calls: DayCall[], utcOffsetHours = 4): string {
    const hhmm = (v: string) => new Date(new Date(v).getTime() + utcOffsetHours * 3600_000).toISOString().slice(11, 16);
    const real = calls.filter((c) => !isEmptyCall(c));
    const empty = calls.length - real.length;

    const lines = [
        `Всего звонков за день: ${calls.length}. Из них похожи на пустые (гудки, автоответчик, приветствие без ответа): ${empty}.`,
        '',
        'Разговоры:',
    ];

    for (const c of real.slice(0, 20)) {
        lines.push(
            `[${hhmm(c.at)}, ${c.direction}, ${c.durationSec} сек${c.orderNumber ? `, заказ №${c.orderNumber}` : ''}]`,
            c.transcript ?? '(расшифровки нет)',
            '',
        );
    }

    if (real.length > 20) lines.push(`…и ещё ${real.length - 20} разговоров, не поместились.`);
    return lines.join('\n');
}

export type CallReview = { text: string; totalCalls: number; realTalks: number; emptyCalls: number };

export async function reviewCallDay(date: string, managerRcId: string): Promise<CallReview | null> {
    const calls = await loadDayCalls(date, managerRcId);
    if (calls.length === 0) return null;

    const real = calls.filter((c) => !isEmptyCall(c));
    const stats = { totalCalls: calls.length, realTalks: real.length, emptyCalls: calls.length - real.length };

    // Разбирать нечего: считать это ошибкой не надо, но и звать модель незачем.
    if (real.length === 0) {
        return { ...stats, text: `За день ${calls.length} звонков, и ни один не дошёл до разговора.` };
    }
    if (!isOpenAIConfigured()) return { ...stats, text: '' };

    const { data: prompt } = await supabase
        .from('ai_prompts')
        .select('system_prompt, model, temperature, max_tokens')
        .eq('key', 'sales_call_day_review')
        .eq('is_active', true)
        .maybeSingle();
    if (!prompt) return { ...stats, text: '' };

    try {
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: prompt.model || 'gpt-4o',
            temperature: Number(prompt.temperature ?? 0.3),
            max_tokens: Number(prompt.max_tokens ?? 600),
            messages: [
                { role: 'system', content: prompt.system_prompt },
                { role: 'user', content: renderDayCalls(calls) },
            ],
        });

        await recordAiUsage({
            agentId: AiAgent.SALES_ANALYST,
            model: completion.model,
            usage: completion.usage,
            purpose: 'sales_call_day_review',
        }).catch(() => null);

        return { ...stats, text: (completion.choices[0]?.message?.content || '').trim() };
    } catch {
        // Разбор — добавка к цифрам, а не замена им: сбой модели не должен
        // отменять вечерний отчёт.
        return { ...stats, text: '' };
    }
}
