import { supabase } from '@/utils/supabase';
import { SETTINGS_SCHEMA, specFor } from '@/lib/sales-rop/settings-schema';
import type { ApplyOptions, KnobKind, KnobValue, ModuleAdapter, ProposalOptions } from './types';
import { knobKey } from './types';

/**
 * Ручки бота-РОПа.
 *
 * Подписи и объяснения уже написаны для экрана настроек — берём их оттуда, а не
 * пишем вторые. Разойтись двум спискам ничего не мешало бы, и разошлись бы они
 * молча: человек читал бы одно описание, модель — другое.
 */

/**
 * Проверка значения.
 *
 * Живёт здесь, а не в обработчике PUT, потому что путей к настройке теперь два:
 * экран и Тамара. Проверка на одном из них — это проверка, которую второй путь
 * обходит.
 */
export function assertSalesRopValue(key: string, value: string): void {
    // Нагрузка — единственное значение, где опечатка бьёт по всему отделу
    // сразу: 10 вместо 1.0 завалит людей списком, который не сделать.
    if (key === 'load_factor') {
        const v = Number(value);
        if (!Number.isFinite(v) || v < 0.5 || v > 2) {
            throw new Error('Нагрузка задаётся числом от 0.5 до 2.0');
        }
        return;
    }

    const kind = specFor(key).kind as KnobKind;
    if (kind === 'number' || kind === 'money') {
        const v = Number(value);
        if (!Number.isFinite(v) || v < 0) throw new Error(`«${specFor(key).title}» — неотрицательное число`);
        return;
    }
    if (kind === 'toggle' && !['true', 'false'].includes(value.trim())) {
        throw new Error(`«${specFor(key).title}» — это да/нет`);
    }
}

async function loadValues(): Promise<Map<string, string>> {
    const { data, error } = await supabase.from('sales_rop_settings').select('key, value');
    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as any[]).map((r) => [String(r.key), String(r.value ?? '')]));
}

export const salesRopAdapter: ModuleAdapter = {
    id: 'sales_rop',

    async list(): Promise<KnobValue[]> {
        const values = await loadValues();
        const known = new Set(SETTINGS_SCHEMA.map((s) => s.key));

        const items: KnobValue[] = SETTINGS_SCHEMA.map((spec) => ({
            id: `sales_rop.${spec.key}`,
            module: 'sales_rop',
            title: spec.title,
            hint: spec.hint,
            kind: spec.kind as KnobKind,
            unit: spec.unit,
            group: spec.group,
            value: values.get(spec.key) ?? '',
        }));

        // Ключ, которого нет в схеме, всё равно влияет на работу бота. Прятать
        // его от модели значило бы дать ей неполную картину как полную.
        for (const [key, value] of Array.from(values.entries())) {
            if (known.has(key)) continue;
            const spec = specFor(key);
            items.push({
                id: `sales_rop.${key}`,
                module: 'sales_rop',
                title: spec.title,
                hint: spec.hint,
                kind: spec.kind as KnobKind,
                group: spec.group,
                value,
            });
        }
        return items;
    },

    async validate(knobId: string, value: string, _opts: ProposalOptions): Promise<string> {
        const key = knobKey(knobId);
        assertSalesRopValue(key, value);
        return value;
    },

    async apply(knobId: string, value: string, _opts: ApplyOptions): Promise<void> {
        const key = knobKey(knobId);
        assertSalesRopValue(key, value);
        const { error } = await supabase
            .from('sales_rop_settings')
            .upsert({ key, value }, { onConflict: 'key' });
        if (error) throw new Error(error.message);
    },
};
