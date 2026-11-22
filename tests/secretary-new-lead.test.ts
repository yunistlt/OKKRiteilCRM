import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Ветка «новая заявка» секретаря Телфина.
 *
 * Раньше менеджера выбирал свой `pickLeastLoadedManager`, который запрашивал
 * несуществующие `managers.max_load/rating`: запрос падал, звонок всегда уходил
 * в очередь, а заказ получал другого менеджера по общему правилу. Теперь
 * менеджер один — тот, кого назначило общее правило всех потоков, — и звонок
 * переводится на него же, если на него разрешён перевод.
 */

const createSecretaryLead = vi.fn();
const transferTargetById = vi.fn();
const logInsert = vi.fn(async () => ({ error: null }));

vi.mock('@/lib/retailcrm/leads', () => ({
    createSecretaryLead: (...args: unknown[]) => createSecretaryLead(...args),
}));

vi.mock('@/lib/secretary/core', () => ({
    findOrderByNumber: vi.fn(),
    getManagerById: vi.fn(),
    findOwnerByCallerPhone: vi.fn(),
    transferTargetById: (...args: unknown[]) => transferTargetById(...args),
}));

vi.mock('@/utils/supabase', () => ({
    supabase: { from: () => ({ insert: logInsert }) },
}));

process.env.TELPHIN_FALLBACK_EXTENSION = '200';
delete process.env.TELPHIN_SECRETARY_TOKEN;

const { GET } = await import('@/app/api/telphin/secretary/route');

function call(params: Record<string, string>) {
    const url = new URL('https://okk.test/api/telphin/secretary');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return GET(new NextRequest(url));
}

function lastLog(): any {
    const calls = logInsert.mock.calls as unknown as Array<[any]>;
    return calls[calls.length - 1][0];
}

describe('секретарь Телфина: новая заявка', () => {
    beforeEach(() => {
        createSecretaryLead.mockReset();
        transferTargetById.mockReset();
        logInsert.mockClear();
        createSecretaryLead.mockResolvedValue({ id: 900000501, number: '900501', managerId: 119 });
    });

    it('менеджера не выбирает сам — отдаёт общему правилу', async () => {
        transferTargetById.mockResolvedValue(null);
        await call({ mode: 'new', CallerIDNum: '79990001122', voice_navigator_STT: 'нужен шкаф', CallID: 'c1' });

        expect(createSecretaryLead).toHaveBeenCalledWith({ phone: '79990001122', summary: 'нужен шкаф' });
    });

    it('звонок переводится на того же менеджера, что стал хозяином заказа', async () => {
        transferTargetById.mockResolvedValue({ id: 119, name: 'Евгения Матвеева', extension: '119' });
        const res = await call({ mode: 'new', CallerIDNum: '79990001122', CallID: 'c2' });
        const xml = await res.text();

        expect(transferTargetById).toHaveBeenCalledWith(119);
        expect(xml).toContain('<SetVar name="transferDestination">119</SetVar>');
        expect(xml).toContain('Соединяю вас с менеджером Евгения Матвеева');
        expect(lastLog()).toMatchObject({ decision: 'created_new', manager_id: 119, extension: '119', order_id: 900000501 });
    });

    it('перевод на хозяина не разрешён — заказ с менеджером, звонок в очередь ОП', async () => {
        transferTargetById.mockResolvedValue(null);
        const res = await call({ mode: 'new', CallerIDNum: '79990001122', CallID: 'c3' });
        const xml = await res.text();

        expect(xml).toContain('<SetVar name="transferDestination">200</SetVar>');
        expect(lastLog()).toMatchObject({ decision: 'created_no_transfer', manager_id: 119, extension: null, order_id: 900000501 });
    });

    it('заявку создать не удалось — звонящий всё равно уходит в очередь', async () => {
        createSecretaryLead.mockRejectedValue(new Error('Заявку некому назначить'));
        const res = await call({ mode: 'new', CallerIDNum: '79990001122', CallID: 'c4' });
        const xml = await res.text();

        expect(xml).toContain('<SetVar name="transferDestination">200</SetVar>');
        expect(lastLog()).toMatchObject({ decision: 'error' });
    });
});
