// ============================================================================
// Хелперы развёртки параметров бонус-блока в плоский список ползунков.
// Общие для командного (FotSimulatorModal) и персонального
// (ManagerSalarySimulatorModal) симуляторов — один источник правды.
// Числа мотивации приходят из БД; здесь только диапазоны/подписи для UI.
// ============================================================================
import { formatNumberRu } from '@/lib/format';

// ── Цвета блоков (нежные: белый + тон). Один код → один цвет в палитре, роли и симуляторах ──
// Тот же хеш, что и в конструкторе настроек (app/salary/settings/ConstructorTabs.tsx),
// чтобы блок везде был окрашен одинаково.
export const BLOCK_TINTS = [
    { bg: '#f3f6ff', bar: '#3b82f6' }, // синий
    { bg: '#f1faf3', bar: '#16a34a' }, // зелёный
    { bg: '#fff6f1', bar: '#ea580c' }, // оранжевый
    { bg: '#faf2fb', bar: '#a21caf' }, // пурпурный
    { bg: '#eefafd', bar: '#0891b2' }, // циан
    { bg: '#fdf9ee', bar: '#ca8a04' }, // янтарный
    { bg: '#f4f3fb', bar: '#7c3aed' }, // фиолетовый
    { bg: '#fdf1f3', bar: '#e11d48' }, // розовый
];
export function tintFor(code: string) {
    let h = 0;
    for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
    return BLOCK_TINTS[h % BLOCK_TINTS.length];
}

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
// categoryNames — код категории RetailCRM → человеческое имя (для строк «по категориям»).
export function ctrlLabel(blockCode: string, key: string, item?: any, categoryNames?: Record<string, string>): string {
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
    const catName = (code?: string) => (code ? (categoryNames?.[code] ?? code) : '');
    if (key === 'coef') return item?.category != null ? `${catName(item.category)} · коэффициент` : 'Коэффициент категории';
    if (key === 'value') {
        const what = item?.mode === 'pct' ? '% от продажи' : 'доплата за заявку';
        return item?.category != null ? `${catName(item.category)} · ${what}` : (item?.mode === 'pct' ? '% от продажи' : 'Доплата за заявку');
    }
    if (key === 'min') return blockCode === 'k_team' ? 'Порог выручки' : 'Порог конверсии';
    return key;
}

// Развернуть параметры блока в плоский список ползунков с путём к значению.
export function controlsForBlock(blockCode: string, params: any, categoryNames?: Record<string, string>): Control[] {
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
        c.label = ctrlLabel(blockCode, key, item, categoryNames);
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
