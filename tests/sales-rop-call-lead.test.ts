import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ИИ-РОП заводит заказ по звонку, который менеджер не оформил.
 *
 * Главный риск — лишние заказы: большинство звонков с незнакомых номеров не
 * покупатели. Поэтому проверяем прежде всего, когда заказ НЕ заводится.
 */

const findOrdersByPhone = vi.fn();
const existingBinding = vi.fn();
const bindCallToOrder = vi.fn();
const createCallLead = vi.fn();
const openaiCreate = vi.fn();
const journal: any[] = [];
const recentOrders: any[] = [];

vi.mock('@/lib/orders-by-phone', async () => {
    const real = await vi.importActual<any>('@/lib/orders-by-phone');
    return { phoneTail7: real.phoneTail7, findOrdersByPhone: (...a: unknown[]) => findOrdersByPhone(...a) };
});
vi.mock('@/lib/call-binding', () => ({
    existingBinding: (...a: unknown[]) => existingBinding(...a),
    bindCallToOrder: (...a: unknown[]) => bindCallToOrder(...a),
}));
vi.mock('@/lib/retailcrm/leads', () => ({ createCallLead: (...a: unknown[]) => createCallLead(...a) }));
vi.mock('@/lib/email/classify', () => ({ cutForAi: (t: string) => t }));
vi.mock('@/lib/ai-usage', () => ({ AiAgent: { SALES_ANALYST: 'sales_analyst' }, recordAiUsage: async () => null }));
vi.mock('@/utils/openai', () => ({
    isOpenAIConfigured: () => true,
    getOpenAIClient: () => ({ chat: { completions: { create: (...a: unknown[]) => openaiCreate(...a) } } }),
}));

/** Мини-подделка supabase: промпт, менеджер по добавочному и журнал. */
vi.mock('@/utils/supabase', () => {
    const chain = (table: string) => {
        const q: any = {
            _table: table,
            select: () => q, eq: () => q, in: () => q, lt: () => q, limit: () => q, gte: () => q, lte: () => q, is: () => q, order: () => q,
            maybeSingle: async () => (table === 'ai_prompts'
                ? { data: { system_prompt: 'промпт', model: 'gpt-4o-mini', temperature: 0, max_tokens: 500 } }
                : { data: null }),
            insert: async (row: any) => { journal.push({ op: 'insert', ...row }); return { error: null }; },
            update: (row: any) => { journal.push({ op: 'update', ...row }); return q; },
            then: (resolve: any) => resolve(table === 'managers' ? { data: [{ id: 98 }] } : table === 'orders' ? { data: recentOrders } : { data: [] }),
        };
        return q;
    };
    return { supabase: { from: (t: string) => chain(t) } };
});

const { reviewCall, parseVerdict, MIN_CONFIDENCE } = await import('@/lib/sales-rop/call-lead');

const call = {
    callId: 'ABC123',
    startedAt: '2026-11-20T08:00:00Z',
    durationSec: 120,
    phone: '+79990001122',
    managerExtension: '119',
    transcript: 'Менеджер: Компания ЗМК. Клиент: Нужен шкаф для ЛВЖ, пришлите КП.',
};

function modelSays(v: Record<string, unknown>) {
    openaiCreate.mockResolvedValue({ model: 'gpt-4o-mini', usage: {}, choices: [{ message: { content: JSON.stringify(v) } }] });
}

const lastJournal = () => journal.filter((j) => j.op === 'update').at(-1);

describe('ИИ-РОП: заказ по звонку', () => {
    beforeEach(() => {
        journal.length = 0;
        recentOrders.length = 0;
        [findOrdersByPhone, existingBinding, bindCallToOrder, createCallLead, openaiCreate].forEach((m) => m.mockReset());
        findOrdersByPhone.mockResolvedValue([]);
        existingBinding.mockResolvedValue(null);
        createCallLead.mockResolvedValue({ id: 900000777, number: '900777', managerId: 98 });
    });

    it('новый запрос — заводит заказ на того, кто говорил, и привязывает звонок', async () => {
        modelSays({ category: 'new_request', create_order: true, confidence: 0.9, reason: 'просит КП', summary: 'Шкаф ЛВЖ, КП' });
        const d = await reviewCall(call);

        expect(createCallLead).toHaveBeenCalledWith(expect.objectContaining({ phone: call.phone, managerId: 98, summary: 'Шкаф ЛВЖ, КП' }));
        expect(bindCallToOrder).toHaveBeenCalledWith(expect.objectContaining({ callId: 'ABC123', orderId: 900000777 }));
        expect(d).toMatchObject({ decision: 'created', order_id: 900000777, orderNumber: '900777' });
        expect(lastJournal()).toMatchObject({ decision: 'created', order_id: 900000777 });
    });

    it('по телефону уже есть заказ — модель не зовём, заказ не заводим', async () => {
        findOrdersByPhone.mockResolvedValue([{ id: 55001, number: '55001', created_at: '2026-10-01T00:00:00Z' }]);
        const d = await reviewCall(call);

        expect(openaiCreate).not.toHaveBeenCalled();
        expect(createCallLead).not.toHaveBeenCalled();
        expect(d).toMatchObject({ decision: 'skipped', category: 'known_number' });
    });

    it('менеджер завёл заказ сам после звонка — пропускаем', async () => {
        findOrdersByPhone.mockResolvedValue([{ id: 900000700, number: '900700', created_at: '2026-11-20T08:30:00Z' }]);
        const d = await reviewCall(call);
        expect(d).toMatchObject({ decision: 'skipped', category: 'manager_created' });
        expect(createCallLead).not.toHaveBeenCalled();
    });

    it('звонок уже привязан к заказу — пропускаем', async () => {
        existingBinding.mockResolvedValue({ orderId: 55001, method: 'manual' });
        const d = await reviewCall(call);
        expect(d).toMatchObject({ decision: 'skipped', category: 'bound' });
        expect(openaiCreate).not.toHaveBeenCalled();
    });

    it('наш клиент с другого номера — заказ не заводим', async () => {
        modelSays({ category: 'existing_order', create_order: false, confidence: 0.9, reason: 'про фото готовности заказа' });
        const d = await reviewCall(call);
        expect(createCallLead).not.toHaveBeenCalled();
        expect(d).toMatchObject({ decision: 'skipped', category: 'existing_order' });
    });

    it('модель не уверена — заказ не заводим', async () => {
        modelSays({ category: 'new_request', create_order: true, confidence: MIN_CONFIDENCE - 0.1, reason: 'похоже на запрос' });
        const d = await reviewCall(call);
        expect(createCallLead).not.toHaveBeenCalled();
        expect(d.decision).toBe('skipped');
    });

    it('пробный прогон: говорит «завёл бы», но ничего не создаёт и не пишет', async () => {
        modelSays({ category: 'new_request', create_order: true, confidence: 0.95, reason: 'цена на шкаф', summary: 'Цена шкафа' });
        const d = await reviewCall(call, { dryRun: true });
        expect(d.decision).toBe('created');
        expect(createCallLead).not.toHaveBeenCalled();
        expect(bindCallToOrder).not.toHaveBeenCalled();
        expect(journal).toHaveLength(0);
    });

    it('сбой модели — строка «ошибка», заказ не создан, будет повтор', async () => {
        openaiCreate.mockRejectedValue(new Error('timeout'));
        const d = await reviewCall(call);
        expect(d).toMatchObject({ decision: 'error' });
        expect(createCallLead).not.toHaveBeenCalled();
    });

    it('тот же запрос уже пришёл письмом — заказ не заводим, звонок подсказкой к тому заказу', async () => {
        recentOrders.push({ id: 900000654, number: '900654', created_at: '2026-11-20T08:11:00Z', src: 'email-secretary', company: 'ООО Приоритет-Сервис', comment: 'Запрос цены SCO433' });
        openaiCreate
            .mockResolvedValueOnce({ model: 'gpt-4o-mini', usage: {}, choices: [{ message: { content: JSON.stringify({ category: 'new_request', create_order: true, confidence: 0.9, reason: 'цена', summary: 'SCO433 цена', company: 'Приоритет Сервис' }) } }] })
            .mockResolvedValueOnce({ model: 'gpt-4o-mini', usage: {}, choices: [{ message: { content: JSON.stringify({ order_number: '900654', reason: 'та же компания и изделие' }) } }] });
        const d = await reviewCall(call);

        expect(createCallLead).not.toHaveBeenCalled();
        expect(bindCallToOrder).toHaveBeenCalledWith(expect.objectContaining({ orderId: 900000654, suggested: true }));
        expect(d).toMatchObject({ decision: 'skipped', category: 'already_ordered', orderNumber: '900654' });
    });

    it('модель назвала номер не из списка — совпадение не засчитываем', async () => {
        recentOrders.push({ id: 900000654, number: '900654', created_at: '2026-11-20T08:11:00Z', src: 'email-secretary' });
        openaiCreate
            .mockResolvedValueOnce({ model: 'gpt-4o-mini', usage: {}, choices: [{ message: { content: JSON.stringify({ category: 'new_request', create_order: true, confidence: 0.9, summary: 'x' }) } }] })
            .mockResolvedValueOnce({ model: 'gpt-4o-mini', usage: {}, choices: [{ message: { content: JSON.stringify({ order_number: '123456' }) } }] });
        const d = await reviewCall(call);
        expect(d.decision).toBe('created');
    });

    it('короткий или внутренний номер — не клиент', async () => {
        const d = await reviewCall({ ...call, phone: '105' });
        expect(d).toMatchObject({ decision: 'skipped', category: 'no_phone' });
    });
});

describe('разбор ответа модели', () => {
    it('create_order без new_request не заводит', () => {
        expect(parseVerdict(JSON.stringify({ category: 'supplier', create_order: true, confidence: 1 }), 'm').createOrder).toBe(false);
    });
    it('неизвестная категория → other', () => {
        expect(parseVerdict(JSON.stringify({ category: 'xxx', create_order: false }), 'm').category).toBe('other');
    });
    it('строка "null" в имени — это пусто', () => {
        expect(parseVerdict(JSON.stringify({ category: 'other', client_name: 'null' }), 'm').clientName).toBeNull();
    });
});
