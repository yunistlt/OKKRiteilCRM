import { supabase } from '@/utils/supabase';
import type { ApplyOptions, KnobValue, ModuleAdapter } from './types';
import { knobKey } from './types';

/**
 * Ручки качества.
 *
 * Правило ОКК — не пара «ключ-значение», а строка с условием на SQL. Условие
 * модели не отдаём и менять ей не даём: правило ловит нарушение, за нарушение
 * удерживают деньги, и переписанное условие меняет зарплату задним числом по
 * всей базе. Модели остаются три безопасных рычага: включить правило, выключить
 * и сдвинуть его числовой порог.
 *
 * Адрес ручки — `okk.<код правила>.<что крутим>`, например
 * `okk.call_no_greeting.active`.
 */

type RuleRow = {
    code: string;
    name: string;
    description: string | null;
    severity: string;
    parameters: Record<string, unknown> | null;
    is_active: boolean | null;
};

const SEVERITY_TITLES: Record<string, string> = {
    low: 'низкая',
    medium: 'средняя',
    high: 'высокая',
    critical: 'критическая',
};

async function loadRules(): Promise<RuleRow[]> {
    const { data, error } = await supabase
        .from('okk_rules')
        .select('code, name, description, severity, parameters, is_active')
        .order('code');
    if (error) throw new Error(error.message);
    return (data ?? []) as RuleRow[];
}

async function loadRule(code: string): Promise<RuleRow> {
    const { data, error } = await supabase
        .from('okk_rules')
        .select('code, name, description, severity, parameters, is_active')
        .eq('code', code)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Правила ОКК с кодом ${code} нет`);
    return data as RuleRow;
}

export const okkAdapter: ModuleAdapter = {
    id: 'okk',

    async list(): Promise<KnobValue[]> {
        const rules = await loadRules();
        const items: KnobValue[] = [];

        for (const rule of rules) {
            const group = `Правило: ${rule.name}`;
            items.push({
                id: `okk.${rule.code}.active`,
                module: 'okk',
                title: `«${rule.name}» — правило работает`,
                hint: `${rule.description || 'Описания у правила нет.'} Выключенное правило перестаёт ловить нарушения со следующей проверки; уже записанные нарушения остаются.`,
                kind: 'toggle',
                group,
                value: String(rule.is_active ?? true),
            });
            items.push({
                id: `okk.${rule.code}.severity`,
                module: 'okk',
                title: `«${rule.name}» — тяжесть нарушения`,
                hint: `Насколько серьёзным считается нарушение: ${Object.values(SEVERITY_TITLES).join(', ')}. От тяжести зависит, насколько нарушение роняет балл качества, а балл качества — деньги менеджера.`,
                kind: 'text',
                group,
                value: rule.severity,
            });

            // Порог показываем только там, где он есть: у правила «нет
            // приветствия» крутить нечего, а у «перезвонил позже N минут» — есть.
            const params = rule.parameters ?? {};
            for (const [name, raw] of Object.entries(params)) {
                if (typeof raw !== 'number') continue;
                items.push({
                    id: `okk.${rule.code}.param.${name}`,
                    module: 'okk',
                    title: `«${rule.name}» — порог «${name}»`,
                    hint: 'Число, при котором правило срабатывает. Сдвиг порога меняет, сколько нарушений найдётся при следующей проверке.',
                    kind: 'number',
                    group,
                    value: String(raw),
                });
            }
        }
        return items;
    },

    async validate(knobId: string, value: string): Promise<string> {
        const rest = knobKey(knobId);
        const [code, field, ...tail] = rest.split('.');
        const rule = await loadRule(code);

        if (field === 'active') {
            if (!['true', 'false'].includes(value.trim())) throw new Error('Включено или выключено: true или false');
            return value.trim();
        }
        if (field === 'severity') {
            if (!(value in SEVERITY_TITLES)) {
                throw new Error(`Тяжесть — одно из: ${Object.keys(SEVERITY_TITLES).join(', ')}`);
            }
            return value;
        }
        if (field === 'param') {
            const name = tail.join('.');
            const current = (rule.parameters ?? {})[name];
            if (typeof current !== 'number') throw new Error(`У правила ${code} нет числового порога «${name}»`);
            const v = Number(value);
            if (!Number.isFinite(v)) throw new Error('Порог — это число');
            return String(v);
        }
        throw new Error(`У правила ОКК можно менять только включённость, тяжесть и числовой порог (запрошено «${field}»)`);
    },

    async apply(knobId: string, value: string, _opts: ApplyOptions): Promise<void> {
        const rest = knobKey(knobId);
        const [code, field, ...tail] = rest.split('.');
        const rule = await loadRule(code);

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (field === 'active') patch.is_active = value.trim() === 'true';
        else if (field === 'severity') patch.severity = value;
        else if (field === 'param') {
            patch.parameters = { ...(rule.parameters ?? {}), [tail.join('.')]: Number(value) };
        } else throw new Error(`Нельзя менять «${field}» у правила ОКК`);

        const { error } = await supabase.from('okk_rules').update(patch).eq('code', code);
        if (error) throw new Error(error.message);
    },
};
