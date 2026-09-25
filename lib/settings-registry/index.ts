import { salesRopAdapter } from './sales-rop';
import { salaryAdapter, salaryPlanAdapter } from './salary';
import { okkAdapter } from './okk';
import {
    MODULE_TITLES,
    knobModule,
    type ApplyOptions,
    type KnobValue,
    type ModuleAdapter,
    type ModuleId,
    type ProposalOptions,
} from './types';

export * from './types';

const ADAPTERS: Record<ModuleId, ModuleAdapter> = {
    sales_rop: salesRopAdapter,
    salary: salaryAdapter,
    salary_plan: salaryPlanAdapter,
    okk: okkAdapter,
};

export function adapterFor(knobId: string): ModuleAdapter {
    const module = knobModule(knobId);
    if (!module) throw new Error(`Непонятный адрес настройки: ${knobId}`);
    return ADAPTERS[module];
}

/**
 * Весь каталог ручек с текущими значениями.
 *
 * Сбой одной подсистемы не должен прятать остальные: если ОКК недоступен, это
 * повод сказать «правила качества не прочитались», а не ответить «настроек
 * нет». Молчаливо укороченный каталог модель приняла бы за полный.
 */
export async function listKnobs(opts: { module?: ModuleId; query?: string } = {}): Promise<{
    items: KnobValue[];
    failed: Array<{ module: ModuleId; error: string }>;
}> {
    const modules = opts.module ? [opts.module] : (Object.keys(ADAPTERS) as ModuleId[]);
    const results = await Promise.allSettled(modules.map((m) => ADAPTERS[m].list()));

    const items: KnobValue[] = [];
    const failed: Array<{ module: ModuleId; error: string }> = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') items.push(...r.value);
        else failed.push({ module: modules[i], error: String(r.reason?.message ?? r.reason) });
    });

    const q = opts.query?.trim().toLowerCase();
    if (!q) return { items, failed };

    const words = q.split(/\s+/).filter(Boolean);
    const matched = items.filter((k) => {
        const hay = `${k.id} ${k.title} ${k.hint} ${k.group} ${MODULE_TITLES[k.module]}`.toLowerCase();
        return words.every((w) => hay.includes(w));
    });
    return { items: matched, failed };
}

export async function findKnob(knobId: string): Promise<KnobValue> {
    const module = knobModule(knobId);
    if (!module) throw new Error(`Непонятный адрес настройки: ${knobId}`);
    const items = await ADAPTERS[module].list();
    const found = items.find((k) => k.id === knobId);
    if (!found) throw new Error(`Настройки ${knobId} нет`);
    return found;
}

export function validateKnob(knobId: string, value: string, opts: ProposalOptions = {}): Promise<string> {
    return adapterFor(knobId).validate(knobId, value, opts);
}

export function applyKnob(knobId: string, value: string, opts: ApplyOptions): Promise<void> {
    return adapterFor(knobId).apply(knobId, value, opts);
}
