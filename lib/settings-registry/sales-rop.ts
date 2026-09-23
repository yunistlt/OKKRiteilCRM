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

/**
 * Личная нагрузка каждого менеджера — такая же ручка, как остальные.
 *
 * Хранится не в sales_rop_settings, а колонкой в sales_rop_manager: настройка
 * привязана к человеку, и держать её строкой «load_factor_249» значило бы
 * заводить ключ на каждого нового сотрудника руками.
 */
async function managerKnobs(): Promise<KnobValue[]> {
    const { data, error } = await supabase
        .from('sales_rop_manager')
        .select('manager_id, load_factor, is_active')
        .eq('is_active', true);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];
    if (rows.length === 0) return [];

    // Имена — из справочника менеджеров: в интерфейсе и в разговоре должен
    // стоять человек, а не номер.
    const { data: people } = await supabase
        .from('managers')
        .select('id, first_name, last_name')
        .in('id', rows.map((r) => Number(r.manager_id)));
    const nameById = new Map(
        ((people ?? []) as any[]).map((m) => [
            Number(m.id),
            [m.last_name, m.first_name].filter(Boolean).join(' ').trim() || `#${m.id}`,
        ]),
    );

    return rows.map((r) => {
        const id = Number(r.manager_id);
        const name = nameById.get(id) ?? `#${id}`;
        return {
            id: `sales_rop.manager.${id}.load_factor`,
            module: 'sales_rop' as const,
            title: `Нагрузка: ${name}`,
            hint:
                'Личный множитель поверх общей нагрузки отдела. 1.00 — как у всех, 1.20 — этому человеку на 20% больше задач в день. ' +
                'Пусто — работает общий коэффициент. Нужен, когда одному день не заполнен, а у другого и так четырнадцать своих звонков. Границы 0.5–2.0.',
            kind: 'factor' as const,
            group: 'Нагрузка по людям',
            value: r.load_factor === null || r.load_factor === undefined ? '' : String(r.load_factor),
        };
    });
}

async function loadValues(): Promise<Map<string, string>> {
    const { data, error } = await supabase.from('sales_rop_settings').select('key, value');
    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as any[]).map((r) => [String(r.key), String(r.value ?? '')]));
}

/** `manager.249.load_factor` → 249. Не личная ручка — null. */
function personalLoadOf(key: string): number | null {
    const m = /^manager\.(\d+)\.load_factor$/.exec(key);
    return m ? Number(m[1]) : null;
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

        // Личная нагрузка людей — рядом с общей: вопрос «поднять нагрузку»
        // одинаково часто означает и отдел, и одного человека.
        items.push(...(await managerKnobs()));

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
        const personal = personalLoadOf(key);
        if (personal !== null) {
            assertSalesRopValue('load_factor', value);
            return value;
        }
        assertSalesRopValue(key, value);
        return value;
    },

    async apply(knobId: string, value: string, _opts: ApplyOptions): Promise<void> {
        const key = knobKey(knobId);

        const managerId = personalLoadOf(key);
        if (managerId !== null) {
            assertSalesRopValue('load_factor', value);
            const { error } = await supabase
                .from('sales_rop_manager')
                .update({ load_factor: Number(value), updated_at: new Date().toISOString() })
                .eq('manager_id', managerId);
            if (error) throw new Error(error.message);
            return;
        }

        assertSalesRopValue(key, value);
        const { error } = await supabase
            .from('sales_rop_settings')
            .upsert({ key, value }, { onConflict: 'key' });
        if (error) throw new Error(error.message);
    },
};
