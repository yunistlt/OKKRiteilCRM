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

/**
 * Автоответчик и голосовое меню.
 *
 * Проверено на живых расшифровках: «Вы позвонили в акционерное общество…»,
 * «Наберите добавочный номер или дождитесь ответа секретаря», «Ваш звонок очень
 * важен для нас». Такие звонки длятся и по полторы минуты — по длительности их
 * не отличить от разговора, только по словам.
 */
const MACHINE = new RegExp(
    [
        'вы позвонили в',
        'вас приветствует',
        'наберите (добавочный|в тоновом|внутренний)',
        'дождитесь ответа (оператора|секретаря)',
        'ваш звонок очень важен',
        'оставьте сообщение после',
        'все операторы заняты',
        'абонент (временно )?недоступен',
        'вне зоны действия',
        'аппарат абонента',
        'нажмите \\d',
    ].join('|'),
    'i',
);

/**
 * Шум распознавания. Whisper на тишине выдаёт заставки от обучающих данных, а
 * постобработка иногда возвращает отказ вместо текста — и то и другое не
 * разговор, хотя выглядит как речь.
 */
const NOISE = /продолжение следует|субтитры|dimatorzok|не содержит диалога|предоставьте более полный/i;

export type CallVerdict = 'talk' | 'machine' | 'noise' | 'short' | 'no_transcript';

/**
 * Что это было на самом деле.
 *
 * Разговором считается только подтверждённый расшифровкой диалог. Слушать
 * автоответчик минуту — не работа, и засчитывать это нельзя: иначе показатель
 * начинает измерять терпение, а не переговоры.
 */
export function classifyCall(call: DayCall): CallVerdict {
    if (call.durationSec < 15) return 'short';

    const text = (call.transcript ?? '').trim();
    // Записи нет — судить не по чему. Такой звонок не зачитывается, но и
    // обвинять человека в нём нельзя: он показывается отдельной строкой.
    if (!text) return 'no_transcript';

    if (NOISE.test(text) && text.length < 300) return 'noise';
    if (MACHINE.test(text.slice(0, 400))) return 'machine';

    // Диалог: реплики обеих сторон. Часть расшифровок идёт без разметки ролей —
    // там судим по длине: сто символов односторонней речи это приветствие,
    // четыреста — уже разговор.
    const hasBothRoles = /клиент\s*:/i.test(text) && /менеджер\s*:/i.test(text);
    if (hasBothRoles) return 'talk';
    return text.length >= 400 ? 'talk' : 'noise';
}

/** Пустой звонок — всё, что не подтверждённый разговор. */
export function isEmptyCall(call: DayCall): boolean {
    return classifyCall(call) !== 'talk';
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
        `Всего звонков за день: ${calls.length}. Из них не дошли до разговора (гудки, автоответчик, тишина): ${empty}.`,
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

export type CallReview = {
    text: string;
    totalCalls: number;
    realTalks: number;
    emptyCalls: number;
    machineCalls: number;
    noAnswerCalls: number;
    noRecordCalls: number;
};

export async function reviewCallDay(date: string, managerRcId: string): Promise<CallReview | null> {
    const calls = await loadDayCalls(date, managerRcId);
    if (calls.length === 0) return null;

    const verdicts = calls.map((c) => classifyCall(c));
    const real = calls.filter((_, i) => verdicts[i] === 'talk');
    const stats = {
        totalCalls: calls.length,
        realTalks: real.length,
        emptyCalls: calls.length - real.length,
        machineCalls: verdicts.filter((v) => v === 'machine').length,
        noAnswerCalls: verdicts.filter((v) => v === 'short' || v === 'noise').length,
        noRecordCalls: verdicts.filter((v) => v === 'no_transcript').length,
    };

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
