// ============================================================================
// Хелперы развёртки параметров бонус-блока в плоский список ползунков.
// Общие для командного (FotSimulatorModal) и персонального
// (ManagerSalarySimulatorModal) симуляторов — один источник правды.
// Числа мотивации приходят из БД; здесь только диапазоны/подписи для UI.
// ============================================================================
import { formatNumberRu } from '@/lib/format';

export type Range = { min: number; max: number; step: number; unit: '₽' | '%' | '×' | 'шт' };
export type Control = { path: (string | number)[]; label: string; range: Range; value: number };

// ── Диапазоны ползунков по смыслу параметра (ключ + код блока + контекст строки) ──
export function rangeFor(blockCode: string, key: string, rowMode?: string): Range | null {
    switch (key) {
        case 'oklad': return { min: 0, max: 150000, step: 1000, unit: '₽' };
        case 'new': case 'permanent': return { min: 0, max: 10000, step: 100, unit: '₽' };
        case 'rate': return { min: 0, max: 5000, step: 50, unit: '₽' };
        case 'perPercent': return { min: 0, max: 5000, step: 50, unit: '₽' };
        case 'bonus': return { min: 0, max: 30000, step: 500, unit: '₽' };
        case 'minZayavki': return { min: 0, max: 50, step: 1, unit: 'шт' };
        case 'threshold': return { min: 0, max: 50, step: 1, unit: '%' };
        case 'thresholdPct': return { min: 0, max: 100, step: 1, unit: '%' };
        case 'k': case 'coef': return { min: 0.5, max: 2, step: 0.05, unit: '×' };
        case 'min': return blockCode === 'k_team'
            ? { min: 0, max: 40_000_000, step: 500_000, unit: '₽' }
            : { min: 0, max: 100, step: 1, unit: '%' }; // conv_bonus: порог конверсии
        case 'value': return rowMode === 'pct' ? { min: 0, max: 50, step: 0.5, unit: '%' } : { min: 0, max: 30000, step: 500, unit: '₽' };
        case 'level': case 'prorate': return null; // не ползунки
        default: return { min: 0, max: 100000, step: 1000, unit: '₽' };
    }
}

// Человеческая подпись ползунка с контекстом тира.
export function ctrlLabel(blockCode: string, key: string, item?: any): string {
    if (key === 'oklad') return 'Оклад';
    if (key === 'new') return 'Ставка за новую заявку';
    if (key === 'permanent') return 'Ставка за постоянного';
    if (key === 'rate') return blockCode === 'duty' ? 'Ставка за смену' : 'Ставка за заказ';
    if (key === 'perPercent') return 'Ставка за 1% сверх плана';
    if (key === 'minZayavki') return 'Мин. входящих для допуска';
    if (key === 'thresholdPct') return 'Порог выполнения плана';
    if (key === 'threshold') return 'Порог метрики';
    if (key === 'bonus') return item && item.min != null ? `Бонус при ≥ ${item.min}%` : 'Бонус';
    if (key === 'k') {
        if (blockCode === 'k_team' && item?.min != null) return `× при выручке ≥ ${formatNumberRu(item.min)} ₽`;
        if (item?.level != null) return `× для грейда ${item.level}`;
        return 'Коэффициент';
    }
    if (key === 'coef') return 'Коэффициент категории';
    if (key === 'value') return item?.mode === 'pct' ? '% от продажи' : 'Доплата за заявку';
    if (key === 'min') return blockCode === 'k_team' ? 'Порог выручки' : 'Порог конверсии';
    return key;
}

// Развернуть параметры блока в плоский список ползунков с путём к значению.
export function controlsForBlock(blockCode: string, params: any): Control[] {
    const out: Control[] = [];
    const walk = (val: any, path: (string | number)[], rowMode?: string) => {
        if (val == null) return;
        if (typeof val === 'number') {
            const key = String(path[path.length - 1]);
            const r = rangeFor(blockCode, key, rowMode);
            if (r) out.push({ path, label: '', range: r, value: val });
            return;
        }
        if (Array.isArray(val)) {
            val.forEach((item, i) => walk(item, [...path, i], item?.mode));
            return;
        }
        if (typeof val === 'object') {
            for (const k of Object.keys(val)) walk(val[k], [...path, k], val.mode);
        }
    };
    walk(params, []);
    // подписи с контекстом тира/строки
    for (const c of out) {
        const key = String(c.path[c.path.length - 1]);
        let item: any = params;
        for (let i = 0; i < c.path.length - 1; i++) item = item?.[c.path[i] as any];
        c.label = ctrlLabel(blockCode, key, item);
    }
    return out;
}

export function setAtPath(obj: any, path: (string | number)[], value: number): any {
    if (!path.length) return value;
    const [head, ...rest] = path;
    const clone = Array.isArray(obj) ? [...obj] : { ...obj };
    clone[head as any] = setAtPath(obj?.[head as any], rest, value);
    return clone;
}

export const BLOCK_NAMES: Record<string, string> = {
    oklad: 'Оклад', premia_zayavki: 'Премия за заявки', premia_categorii: 'Премия за категории',
    coef_categorii: 'Коэффициент за категории', k_quality: 'К_качества', conv_bonus: 'Конв-бонус',
    discount_bonus: 'Скидочная дисциплина', k_team: 'К_команды', duty: 'Дежурства',
    plan_attainment: 'Выполнение плана', plan_accelerator: 'Ускоритель плана', plan_gate: 'Гейт по плану',
    department_plan_gate: 'Гейт по плану отдела', volume_bonus: 'Бонус за объём', same_day_sale: 'Продажа в день обращения',
    script_bonus: 'Соблюдение скрипта', fast_contact_bonus: 'Скорость контакта', fields_bonus: 'Заполнение ТЗ',
    grade_multiplier: 'Грейд-коэффициент',
};
