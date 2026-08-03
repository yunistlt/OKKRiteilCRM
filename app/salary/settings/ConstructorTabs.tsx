'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { formatNumberRu } from '@/lib/format';
import { tintFor } from '@/lib/salary/sim-controls';
import { Loader2, Plus, Trash2, GripVertical, Save, ChevronRight, ChevronDown, Info, Check, FlaskConical, SlidersHorizontal, ArrowDownNarrowWide } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import FotSimulatorModal from './FotSimulatorModal';
import EngineerFotSimulatorModal from './EngineerFotSimulatorModal';
import BaseConfigTab from './BaseConfigTab';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

type Catalog = { code: string; name: string; methodology: string; kind: string; group: string; scope?: string; requiredMetrics: string[]; defaultParams: any; available: boolean }[];
type SchemeBlock = { block_code: string; params: any; raw: boolean; rawText: string; enabled: boolean };
// prevEffectiveFrom — дата версии «как загружена». Если при сохранении дата изменилась,
// бэкенд переносит ту же версию на новую дату (а не плодит дубль). '' = новая, ещё не сохранённая схема.
// kind — тип участника роли: 'manager' (роль=группа RetailCRM) | 'engineer' (роль
// инженера-расчётчика, код задаётся вручную). isNew — новая, ещё не сохранённая роль
// (у инженера редактируется код). Механика блоков/drag-drop одинакова для всех типов.
type EditScheme = { code: string; name: string; effectiveFrom: string; prevEffectiveFrom: string; blocks: SchemeBlock[]; kind?: 'manager' | 'engineer'; isNew?: boolean };

// ── RU-лейблы технических ключей параметров ──
const PARAM_LABELS: Record<string, string> = {
    oklad: 'Оклад, ₽', prorate: 'Пропорция по отработанным дням',
    rates: 'Ставки по типам клиента', new: 'Новый', permanent: 'Постоянный',
    tiers: 'Пороги', min: 'От', k: 'Коэффициент ×', bonus: 'Бонус, ₽',
    minZayavki: 'Мин. входящих', metric: 'Метрика', comparator: 'Сравнение', threshold: 'Порог',
    rate: 'Ставка, ₽',
    // Доплата за повторную покупку (блок repeat_client_bonus)
    ordinal: 'Какая покупка клиента',
    thresholdPct: 'Порог, %', perPercent: 'Ставка за 1% сверх плана, ₽',
    rows: 'Категории товара', category: 'Категория', mode: 'Начисление', value: 'Ставка ₽ / %', coef: 'Коэффициент ×',
    // Инженер-расчётчик (блок procent_za_raschet)
    percent: 'Процент от суммы, %', slaNormy: 'Норматив срочности (по сумме заказа)', maxSum: 'Сумма заказа до, ₽', normHours: 'Норма, ч',
    kTiers: 'K срочности (по факт/норма)', maxRatio: 'Отношение факт/норма до', kMissing: 'K при отсутствии данных таймера',
};
const labelFor = (k: string) => PARAM_LABELS[k] ?? k;
// Дата версии для интерфейса: 2026-08-01 → 01.08.2026 (в UI только человеческий формат).
const ruDate = (iso: string) => String(iso ?? '').slice(0, 10).split('-').reverse().join('.');
const COMPARATORS: Record<string, string> = { lte: '≤ не больше', gte: '≥ не меньше' };
// Режимы начисления премии за категорию товара (блок premia_categorii).
const CATEGORY_MODES: Record<string, string> = { sum: 'Сумма, ₽', pct: '% от продажи' };
// Метрики скидочной дисциплины (блок discount_bonus) — человеческие названия кодов.
const DISCOUNT_METRICS: Record<string, string> = {
    avg_order_discount_pct: 'Средневзвешенный % скидки',
    share_orders_no_discount: 'Доля заказов без скидки, %',
};
// Группа блока (роль в формуле) — человеческие названия вместо кодов.
const GROUP_LABELS: Record<string, string> = {
    base: 'Базовая часть',
    premia: 'Премия',
    variable: 'Переменная часть',
    flat: 'Разовая доплата',
};
const groupLabel = (g: string) => GROUP_LABELS[g] ?? g;

// Категории товара (typ_castomer) из словаря RetailCRM — для выпадающего списка.
type CategoryOption = { code: string; name: string };
const CategoriesContext = createContext<CategoryOption[]>([]);

// ── Всплывающая подсказка с методологией расчёта блока (CSS hover, без зависимостей) ──
// align управляет горизонтальной привязкой панели, чтобы не обрезалась у краёв.
function MethodologyTip({ text, align = 'left' }: { text?: string; align?: 'left' | 'right' }) {
    if (!text) return null;
    return (
        <span className="group/tip relative inline-flex shrink-0">
            <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground hover:text-foreground" aria-label="Методология расчёта" />
            <span
                role="tooltip"
                className={`pointer-events-none absolute top-5 z-50 hidden w-72 border bg-white p-2 text-[11px] font-normal leading-snug text-foreground group-hover/tip:block ${align === 'right' ? 'right-0' : 'left-0'}`}
            >
                {text}
            </span>
        </span>
    );
}

// Человеческое значение кодового параметра (метрика/сравнение/режим) — в UI не показываем слаги (закон).
function valueLabel(key: string, value: string): string {
    if (key === 'metric') return DISCOUNT_METRICS[value] ?? value;
    if (key === 'comparator') return COMPARATORS[value] ?? value;
    if (key === 'mode') return CATEGORY_MODES[value] ?? value;
    return value;
}

// Короткая сводка параметров для свёрнутого блока.
function summarize(params: any): string {
    if (params == null || typeof params !== 'object') return '';
    return Object.entries(params).map(([k, v]) => {
        if (Array.isArray(v)) return `${labelFor(k)}: ${v.length}`;
        if (v && typeof v === 'object') return labelFor(k);
        if (typeof v === 'number') return `${labelFor(k)} ${formatNumberRu(v)}`;
        return `${labelFor(k)} ${valueLabel(k, String(v))}`;
    }).join(' · ');
}

// ── Редактор параметров блока (поля вместо сырого JSON) ──────────────────────
const inputCls = 'h-7 border px-2 text-xs';
// Поля внутри таблиц ступеней: без собственной рамки (её роль играет сетка таблицы),
// рамка проявляется только при наведении и фокусе — golds: «можно убрать рамку — убрать».
const cellInputCls = 'h-7 w-full border border-transparent bg-transparent px-2 text-xs hover:border-input focus:border-primary focus:outline-none';

function ScalarField({ pkey, value, onChange, full, bare }: { pkey: string; value: any; onChange: (v: any) => void; full?: boolean; bare?: boolean }) {
    const categories = useContext(CategoriesContext);
    const base = bare ? cellInputCls : inputCls;
    if (pkey === 'comparator' && typeof value === 'string') {
        return (
            <select value={value} onChange={(e) => onChange(e.target.value)} className={`${base} ${full ? 'w-full' : ''}`}>
                {Object.entries(COMPARATORS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
        );
    }
    if (pkey === 'mode' && typeof value === 'string') {
        return (
            <select value={value} onChange={(e) => onChange(e.target.value)} className={`${base} ${full ? 'w-full' : ''}`}>
                {Object.entries(CATEGORY_MODES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
        );
    }
    if (pkey === 'metric' && typeof value === 'string') {
        const known = value in DISCOUNT_METRICS;
        return (
            <select value={value} onChange={(e) => onChange(e.target.value)} className={`${base} ${full ? 'w-full' : ''}`}>
                {!known && value ? <option value={value}>{value}</option> : null}
                {Object.entries(DISCOUNT_METRICS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
        );
    }
    if (pkey === 'category') {
        const known = categories.some((c) => c.code === value);
        return (
            <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={`${base} ${full ? 'w-full' : ''}`}>
                <option value="">— выберите категорию —</option>
                {!known && value ? <option value={String(value)}>{String(value)} (нет в словаре)</option> : null}
                {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
        );
    }
    if (typeof value === 'boolean') {
        return <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-primary" />;
    }
    if (typeof value === 'number') {
        return <NumberInput value={Number.isFinite(value) ? value : 0} emptyValue={0} maxFractionDigits={2} onChange={(v) => onChange(v ?? 0)} className={`${base} ${full ? 'w-full' : 'w-28'} text-right`} />;
    }
    return <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={`${base} w-full`} />;
}

// Таблица для массива объектов вида {min,k} / {min,bonus} (пороги). По GOLD_UI_TABLES.
function TierTable({ value, onChange }: { value: any[]; onChange: (v: any[]) => void }) {
    // «От» (порог) всегда первой колонкой — читается как «От N → коэффициент/бонус».
    const keys = Array.from(new Set(value.flatMap((r) => Object.keys(r ?? {})))).sort((a, b) => (a === 'min' ? -1 : b === 'min' ? 1 : 0));
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [overIdx, setOverIdx] = useState<number | null>(null);
    const [armed, setArmed] = useState<number | null>(null); // строка «взята» за ручку — только тогда она draggable
    const setCell = (i: number, k: string, v: any) => onChange(value.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    // Новая строка с типобезопасными дефолтами по образцу существующих строк.
    const addRow = () => {
        const sample = value[0] ?? {};
        const blank = keys.reduce((a, k) => {
            let v: any = 0;
            if (k === 'mode') v = 'sum';
            else if (k === 'coef') v = 1;
            // Номер покупки — следующий по счёту: ноль схема не примет (нужно
            // целое ≥ 1), а вручную набирать очевидное значение незачем.
            else if (k === 'ordinal') v = Math.max(0, ...value.map((r) => Number(r?.ordinal) || 0)) + 1;
            else if (typeof sample[k] === 'string') v = '';
            return { ...a, [k]: v };
        }, {} as Record<string, any>);
        onChange([...value, blank]);
    };
    const delRow = (i: number) => onChange(value.filter((_, j) => j !== i));

    // Порядок строк — дело владельца схемы: на расчёт он не влияет (ступень выбирается
    // по наибольшему подходящему порогу), но читать таблицу удобнее в своём порядке.
    // Перетаскивание — только за ручку, иначе нельзя было бы выделять текст в полях.
    const move = (from: number, to: number) => {
        if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return;
        const next = value.slice();
        const [row] = next.splice(from, 1);
        next.splice(to, 0, row);
        onChange(next);
    };
    const sortAsc = () => onChange(value.slice().sort((a, b) => (Number(a?.min) || 0) - (Number(b?.min) || 0)));
    const sortable = keys.includes('min') && value.length > 1;

    return (
        <div>
            <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                    <tr className="border-b">
                        <th className="w-5" />
                        {keys.map((k) => <th key={k} className="px-2 pb-1 text-right text-[10px] font-bold uppercase tracking-wide">{labelFor(k)}</th>)}
                        <th className="w-7" />
                    </tr>
                </thead>
                <tbody>
                    {value.map((row, i) => (
                        <tr
                            key={i}
                            draggable={armed === i}
                            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(i); }}
                            onDragEnd={() => { setDragIdx(null); setOverIdx(null); setArmed(null); }}
                            onDragOver={(e) => { if (dragIdx == null) return; e.preventDefault(); setOverIdx(i); }}
                            onDrop={(e) => { e.preventDefault(); if (dragIdx != null) move(dragIdx, i); setDragIdx(null); setOverIdx(null); setArmed(null); }}
                            className={`border-b last:border-b-0 hover:bg-muted/40 ${dragIdx === i ? 'opacity-40' : ''} ${overIdx === i && dragIdx !== i ? 'outline outline-2 -outline-offset-2 outline-primary' : ''}`}
                        >
                            <td className="py-0.5 text-center align-middle">
                                <button
                                    onMouseDown={() => setArmed(i)}
                                    onMouseUp={() => setArmed(null)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
                                        if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
                                    }}
                                    title="Перетащите, чтобы поменять порядок · ↑ / ↓ с клавиатуры"
                                    aria-label="Переместить строку"
                                    className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                                >
                                    <GripVertical className="h-3.5 w-3.5" />
                                </button>
                            </td>
                            {keys.map((k) => (
                                <td key={k} className="py-0.5">
                                    <ScalarField pkey={k} value={row?.[k]} full bare onChange={(v) => setCell(i, k, v)} />
                                </td>
                            ))}
                            <td className="py-0.5 text-center"><button onClick={() => delRow(i)} className="text-muted-foreground hover:text-red-600" title="Удалить строку"><Trash2 className="h-3.5 w-3.5" /></button></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="flex items-center gap-3 pt-1">
                <button onClick={addRow} className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"><Plus className="h-3 w-3" /> {keys.includes('category') ? 'Добавить категорию' : keys.includes('ordinal') ? 'Добавить доплату' : 'Добавить порог'}</button>
                {sortable && (
                    <button onClick={sortAsc} title="Расставить строки по возрастанию порога" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                        <ArrowDownNarrowWide className="h-3 w-3" /> По возрастанию
                    </button>
                )}
            </div>
        </div>
    );
}

// Форма по объекту параметров: скаляры строками, объекты — подгруппой, массивы — таблицей.
function ParamsForm({ params, onChange }: { params: any; onChange: (v: any) => void }) {
    if (params == null || typeof params !== 'object' || Array.isArray(params)) {
        return <div className="text-[11px] text-muted-foreground">Нет параметров.</div>;
    }
    const set = (k: string, v: any) => onChange({ ...params, [k]: v });
    return (
        <div className="space-y-1.5">
            {Object.entries(params).map(([k, v]) => {
                if (Array.isArray(v)) {
                    return <div key={k}><div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{labelFor(k)}</div><TierTable value={v} onChange={(nv) => set(k, nv)} /></div>;
                }
                if (v && typeof v === 'object') {
                    return (
                        <div key={k} className="border-l-2 pl-2">
                            <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{labelFor(k)}</div>
                            <ParamsForm params={v} onChange={(nv) => set(k, nv)} />
                        </div>
                    );
                }
                return (
                    <div key={k} className="flex items-center justify-between gap-2">
                        <span className="text-xs">{labelFor(k)}</span>
                        <ScalarField pkey={k} value={v} onChange={(nv) => set(k, nv)} />
                    </div>
                );
            })}
        </div>
    );
}

// ── Конструктор схем ─────────────────────────────────────────────────────────
export function SchemesTab() {
    const { toast } = useToast();
    const [catalog, setCatalog] = useState<Catalog>([]);
    const [schemes, setSchemes] = useState<EditScheme[]>([]);
    const [archived, setArchived] = useState<{ code: string; name: string; archivedAt: string }[]>([]);
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [groups, setGroups] = useState<{ code: string; name: string }[]>([]); // группы RetailCRM (роли)
    const [loading, setLoading] = useState(true);
    const [drag, setDrag] = useState<{ fromPalette?: string; schemeIdx?: number; blockIdx?: number } | null>(null);
    const [overScheme, setOverScheme] = useState<number | null>(null); // роль под курсором при перетаскивании
    const [saving, setSaving] = useState<string | null>(null);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const toggleOpen = (key: string) => setOpen((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
    const [showBase, setShowBase] = useState(false); // раскрыты ли базовые параметры (общие значения по умолчанию)
    // Симуляция «что если» (песочница тарифов) — считает черновики на периоде, НЕ сохраняет.
    const [managers, setManagers] = useState<{ id: number; name: string }[]>([]);
    const [assignments, setAssignments] = useState<{ managerId: number; schemeCode: string }[]>([]); // реестр: кто в какой роли
    // Все версии ролей (код роли → версии, новые сверху) — история мотивации.
    const [versions, setVersions] = useState<Record<string, any[]>>({});
    const [engineerAssignments, setEngineerAssignments] = useState<{ itemCode: string; schemeCode: string }[]>([]); // инженеры: кто в какой роли
    const nowSim = new Date();
    const [simYear, setSimYear] = useState(nowSim.getFullYear());
    const [simMonth, setSimMonth] = useState(nowSim.getMonth() + 1);
    const [simulating, setSimulating] = useState(false);
    const [simResult, setSimResult] = useState<any | null>(null);
    const [showOverrides, setShowOverrides] = useState(false); // раскрыта ли панель подмен ролей/планов
    const [simAssign, setSimAssign] = useState<Record<number, string>>({}); // managerId → код роли (подмена)
    const [simPlanPersonal, setSimPlanPersonal] = useState<Record<number, number | null>>({}); // managerId → личный план
    const [simDept, setSimDept] = useState<number | null>(null); // план отдела (подмена)
    const [simSchemeIdx, setSimSchemeIdx] = useState<number | null>(null); // открыт симулятор ФОТ для роли (индекс)

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [bRes, sRes, cRes, gRes, eRes] = await Promise.all([fetch('/api/salary/blocks'), fetch('/api/salary/schemes'), fetch('/api/salary/categories'), fetch('/api/salary/groups'), fetch('/api/salary/engineers')]);
            const bJson = await bRes.json();
            const sJson = await sRes.json();
            const cJson = await cRes.json().catch(() => ({ categories: [] }));
            const gJson = await gRes.json().catch(() => ({ groups: [] }));
            const eJson = await eRes.json().catch(() => ({ schemes: [] }));
            if (bJson.error) throw new Error(bJson.error);
            if (sJson.error) throw new Error(sJson.error);
            setCatalog(bJson.blocks ?? []);
            setCategories(cJson.categories ?? []);
            setGroups(gJson.groups ?? []);
            setArchived(sJson.archived ?? []);
            setManagers(sJson.managers ?? []);
            setAssignments(sJson.assignments ?? []);
            setVersions(sJson.versions ?? {});
            const toEdit = (s: any, kind: 'manager' | 'engineer'): EditScheme => ({
                code: s.code, name: s.name, effectiveFrom: String(s.effectiveFrom).slice(0, 10), prevEffectiveFrom: String(s.effectiveFrom).slice(0, 10), kind,
                blocks: (s.blocks ?? []).map((b: any) => ({ block_code: b.block_code, params: b.params ?? {}, raw: false, rawText: '', enabled: b.enabled !== false })),
            });
            // Одна общая лента ролей: менеджерские (из групп RetailCRM) + инженерные (справочник).
            setSchemes([
                ...(sJson.schemes ?? []).map((s: any) => toEdit(s, 'manager')),
                ...(eJson.schemes ?? []).map((s: any) => toEdit(s, 'engineer')),
            ]);
            setEngineerAssignments(((eJson.roster ?? []) as any[]).filter((r) => r.inRoster && r.schemeCode).map((r) => ({ itemCode: String(r.itemCode), schemeCode: String(r.schemeCode) })));
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const byCode = (code: string) => catalog.find((c) => c.code === code);
    // Любой блок можно добавить в любую роль (кроме уже добавленного) — что уместно,
    // решает пользователь. Блоку без данных по этой роли расчёт просто даст 0.
    const addBlock = (si: number, code: string) => setSchemes((prev) => prev.map((s, i) => {
        if (i !== si || s.blocks.some((b) => b.block_code === code)) return s;
        return { ...s, blocks: [...s.blocks, { block_code: code, params: byCode(code)?.defaultParams ?? {}, raw: false, rawText: '', enabled: true }] };
    }));
    const removeBlock = (si: number, bi: number) => setSchemes((p) => p.map((s, i) => (i === si ? { ...s, blocks: s.blocks.filter((_, j) => j !== bi) } : s)));
    const reorder = (si: number, from: number, to: number) => setSchemes((p) => p.map((s, i) => {
        if (i !== si) return s; const arr = [...s.blocks]; const [m] = arr.splice(from, 1); arr.splice(to, 0, m); return { ...s, blocks: arr };
    }));
    const setField = (si: number, patch: Partial<EditScheme>) => setSchemes((p) => p.map((s, i) => (i === si ? { ...s, ...patch } : s)));
    /** Открыть в карточке другую версию роли — посмотреть, что действовало с той даты. */
    const openVersion = (si: number, code: string, effectiveFrom: string) => {
        const v = (versions[code] ?? []).find((x: any) => x.effectiveFrom === effectiveFrom);
        if (!v) return;
        setField(si, {
            effectiveFrom: v.effectiveFrom,
            prevEffectiveFrom: v.effectiveFrom,
            name: v.name ?? '',
            blocks: (v.blocks ?? []).map((b: any) => ({ block_code: b.block_code, params: b.params ?? {}, raw: false, rawText: '', enabled: b.enabled !== false })),
        });
    };
    const patchBlock = (si: number, bi: number, patch: Partial<SchemeBlock>) =>
        setSchemes((p) => p.map((s, i) => (i === si ? { ...s, blocks: s.blocks.map((b, j) => (j === bi ? { ...b, ...patch } : b)) } : s)));
    const save = async (s: EditScheme, si: number) => {
        const isEng = (s.kind ?? 'manager') === 'engineer';
        if (isEng && !s.name.trim()) { toast({ title: 'Укажите название роли', variant: 'destructive' }); return; }
        const blocks = s.blocks.map((b) => ({ block_code: b.block_code, params: b.params, enabled: b.enabled }));
        const saveKey = s.code || `new-${si}`;
        setSaving(saveKey);
        try {
            const url = isEng ? '/api/salary/engineers' : '/api/salary/schemes';
            const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: s.code.trim(), name: s.name.trim(), effectiveFrom: s.effectiveFrom, prevEffectiveFrom: s.prevEffectiveFrom || null, blocks }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            toast({ title: 'Роль сохранена', description: s.name }); load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setSaving(null); }
    };
    // Менеджерская роль = группа RetailCRM. Новую создаём выбором группы из справочника (не вручную).
    const addSchemeFromGroup = (code: string) => {
        if (!code) return;
        if (schemes.some((s) => s.code === code)) { toast({ title: 'Схема для этой роли уже есть', variant: 'destructive' }); return; }
        const grp = groups.find((g) => g.code === code);
        setSchemes((p) => [...p, { code, name: grp?.name ?? code, effectiveFrom: new Date().toISOString().slice(0, 10), prevEffectiveFrom: '', blocks: [], kind: 'manager' }]);
    };
    // Инженерная роль — код генерируем автоматически (внутренний идентификатор, инженеры
    // не пользователи CRM). Пользователь задаёт только название; блоки тащит из палитры.
    const addEngineerScheme = () => setSchemes((p) => [...p, { code: `inzh_${Date.now().toString(36)}`, name: '', effectiveFrom: new Date().toISOString().slice(0, 10), prevEffectiveFrom: '', blocks: [], kind: 'engineer', isNew: true }]);
    const availableGroups = groups.filter((g) => !schemes.some((s) => s.code === g.code) && !archived.some((a) => a.code === g.code));

    // Удалить роль целиком. Если по ней уже считалась ЗП — бэкенд заархивирует (с возможностью восстановления).
    const removeScheme = async (si: number) => {
        const s = schemes[si];
        // Несохранённую новую роль (инженер) просто убираем из списка — на сервере её нет.
        if (s.isNew) { setSchemes((p) => p.filter((_, i) => i !== si)); return; }
        const isEng = (s.kind ?? 'manager') === 'engineer';
        if (!confirm(`Удалить роль «${s.name}»?${isEng ? '' : '\n\nЕсли по этой роли уже рассчитывалась зарплата за прошлые месяцы — она будет заархивирована (история сохранится, роль можно восстановить из архива).'}`)) return;
        setSaving(s.code);
        try {
            const res = isEng
                ? await fetch('/api/salary/engineers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_scheme', schemeCode: s.code }) })
                : await fetch(`/api/salary/schemes?code=${encodeURIComponent(s.code)}`, { method: 'DELETE' });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            if (j.action === 'archived') toast({ title: 'Роль заархивирована', description: 'По роли уже считалась зарплата — она перенесена в архив. Восстановить можно ниже.' });
            else toast({ title: 'Роль удалена', description: j.removedAssignments ? `Снято назначений: ${j.removedAssignments}` : s.name });
            load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setSaving(null); }
    };
    // Симуляция: берём ТЕКУЩИЕ (в т.ч. несохранённые) черновики всех тарифов и считаем на периоде. Без записи.
    const runSimulation = async () => {
        setSimulating(true);
        setSimResult(null);
        try {
            const payloadSchemes = schemes.filter((s) => (s.kind ?? 'manager') === 'manager').map((s) => ({
                code: s.code,
                blocks: s.blocks.map((b) => ({ block_code: b.block_code, params: b.params, enabled: b.enabled })),
            }));
            const body: any = { year: simYear, month: simMonth, schemes: payloadSchemes };
            // Подмена ролей: только реально изменённые относительно реестра.
            const assignOverrides = assignments
                .filter((a) => simAssign[a.managerId] && simAssign[a.managerId] !== a.schemeCode)
                .map((a) => ({ managerId: a.managerId, schemeCode: simAssign[a.managerId] }));
            if (assignOverrides.length) body.assignments = assignOverrides;
            // Подмена планов: личные (только заполненные) + план отдела.
            const personalOverrides = Object.entries(simPlanPersonal)
                .filter(([, v]) => v != null)
                .map(([id, v]) => ({ managerId: Number(id), target: v as number }));
            const plans: any = {};
            if (personalOverrides.length) plans.personal = personalOverrides;
            if (simDept != null) plans.department = simDept;
            if (Object.keys(plans).length) body.plans = plans;
            const res = await fetch('/api/salary/simulate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка симуляции');
            setSimResult(j);
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setSimulating(false); }
    };

    const restoreSchemeUi = async (code: string, name: string) => {
        setSaving(code);
        try {
            const res = await fetch('/api/salary/schemes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore_scheme', schemeCode: code }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            toast({ title: 'Роль восстановлена', description: name }); load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setSaving(null); }
    };

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

    return (
      <CategoriesContext.Provider value={categories}>
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <div>
                <div className="mb-0.5 text-xs font-semibold uppercase tracking-tight">Палитра блоков</div>
                <div className="mb-1.5 text-[10px] text-muted-foreground">Перетащите в схему. Серые — нет данных.</div>
                <div className="divide-y border">
                    {catalog.map((b) => {
                        const tint = tintFor(b.code);
                        const scope = b.scope ?? 'manager';
                        return (
                            <div key={b.code} draggable={b.available} onDragStart={() => setDrag({ fromPalette: b.code })}
                                onDragEnd={() => { setDrag(null); setOverScheme(null); }}
                                style={b.available ? { backgroundColor: tint.bg, borderLeft: `3px solid ${tint.bar}` } : undefined}
                                className={`px-2 py-1.5 text-xs ${b.available ? 'cursor-grab hover:brightness-95' : 'cursor-not-allowed border-l-[3px] border-transparent bg-muted text-muted-foreground'}`}>
                                <div className="flex items-center gap-1 leading-tight">
                                    <span className="font-medium">{b.name}</span>
                                    <MethodologyTip text={b.methodology} />
                                    {scope === 'engineer' && <span className="ml-auto shrink-0 bg-amber-100 px-1 text-[9px] font-medium uppercase text-amber-700" title="Блок для роли инженера-расчётчика">инж.</span>}
                                </div>
                                <div className="text-[10px] text-muted-foreground">{groupLabel(b.group)}{b.available ? '' : ' · нет данных'}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="space-y-3">
                {/* Базовые параметры — общие значения по умолчанию (статус закрытия, исключения, НДС, дефолтные ставки/тиры). Раскрываются по клику, чтобы не загромождать конструктор ролей. */}
                <div className="border">
                    <button onClick={() => setShowBase((v) => !v)} className="flex w-full items-center gap-1.5 border-b bg-muted/40 px-2 py-1.5 text-left">
                        {showBase ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-sm font-semibold">Базовые параметры</span>
                        <span className="text-[11px] text-muted-foreground">сквозные настройки сбора данных (статус закрытия, исключения, постоянный клиент, дубль на тендер, НДС)</span>
                    </button>
                    {showBase && <div className="p-2"><BaseConfigTab /></div>}
                </div>
                {/* Песочница тарифов: примерить ТЕКУЩИЕ (несохранённые) черновики на любой период, в т.ч. закрытый. Ничего не пишет. */}
                <div className="border border-violet-300 bg-violet-50/40">
                    <div className="flex flex-wrap items-center gap-2 border-b border-violet-200 bg-violet-100/60 px-2 py-1.5">
                        <FlaskConical className="h-4 w-4 text-violet-700" />
                        <span className="text-sm font-semibold text-violet-900">Симуляция «что если»</span>
                        <span className="bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-violet-800">не сохраняется</span>
                        <label className="ml-auto text-[11px] text-muted-foreground">период</label>
                        <select value={simMonth} onChange={(e) => { setSimMonth(Number(e.target.value)); setSimResult(null); }} className="h-8 border px-2 text-xs">
                            {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
                        </select>
                        <select value={simYear} onChange={(e) => { setSimYear(Number(e.target.value)); setSimResult(null); }} className="h-8 border px-2 text-xs">
                            {[simYear - 1, simYear, simYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <Button size="sm" className="h-8 bg-violet-700 hover:bg-violet-800" onClick={runSimulation} disabled={simulating}>
                            {simulating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="mr-1 h-3.5 w-3.5" />} Посчитать
                        </Button>
                    </div>
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                        Считает зарплату на выбранном периоде по <b>текущим черновикам тарифов</b> в этом конструкторе (несохранённые правки учитываются) и сравнивает с фактом. Расчёт нигде не сохраняется — закрытый период не меняется.
                    </div>
                    {/* Необязательные подмены: роли менеджеров и планы периода. */}
                    <div className="border-t border-violet-200">
                        <button onClick={() => setShowOverrides((v) => !v)} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] font-medium text-violet-800 hover:bg-violet-100/40">
                            {showOverrides ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            Подмены ролей и планов (необязательно)
                            {(Object.values(simAssign).some(Boolean) || Object.values(simPlanPersonal).some((v) => v != null) || simDept != null) && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                        </button>
                        {showOverrides && (
                            <div className="space-y-2 px-2 pb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-muted-foreground">План отдела (выручка без НДС):</span>
                                    <NumberInput value={simDept} onChange={setSimDept} placeholder="как в периоде" className="h-7 w-40 border px-2 text-xs text-right" />
                                </div>
                                {assignments.length === 0 ? (
                                    <div className="text-[11px] text-muted-foreground">В реестре нет менеджеров с назначенной ролью.</div>
                                ) : (
                                    <table className="w-full text-xs">
                                        <thead className="text-left text-[10px] uppercase text-muted-foreground">
                                            <tr><th className="p-1">Менеджер</th><th className="p-1">Роль (подмена)</th><th className="p-1 text-right">Личный план</th></tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {assignments.map((a) => {
                                                const opts = schemes.some((s) => s.code === a.schemeCode) ? schemes : [...schemes, { code: a.schemeCode, name: a.schemeCode } as any];
                                                return (
                                                    <tr key={a.managerId}>
                                                        <td className="p-1">{managers.find((m) => m.id === a.managerId)?.name ?? `#${a.managerId}`}</td>
                                                        <td className="p-1">
                                                            <select value={simAssign[a.managerId] ?? a.schemeCode} onChange={(e) => setSimAssign((p) => ({ ...p, [a.managerId]: e.target.value }))} className="h-7 border px-1 text-xs">
                                                                {opts.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                                                            </select>
                                                        </td>
                                                        <td className="p-1 text-right">
                                                            <NumberInput value={simPlanPersonal[a.managerId] ?? null} onChange={(v) => setSimPlanPersonal((p) => ({ ...p, [a.managerId]: v }))} placeholder="как в периоде" className="h-7 w-36 border px-2 text-xs text-right" />
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                                <div className="text-[10px] text-muted-foreground">Пустое поле плана = как в периоде. Роль по умолчанию = текущая из реестра.</div>
                            </div>
                        )}
                    </div>
                    {simResult && (() => {
                        const sim = new Map<number, number>((simResult.simulated?.results ?? []).map((r: any) => [Number(r.managerId), Number(r.total)]));
                        const act = new Map<number, number>((simResult.actual ?? []).map((r: any) => [Number(r.managerId), Number(r.total)]));
                        const ids = Array.from(new Set([...Array.from(sim.keys()), ...Array.from(act.keys())])).sort((a, b) => a - b);
                        const rub = (n: number | null | undefined) => n == null ? '—' : Math.round(Number(n)).toLocaleString('ru-RU') + ' ₽';
                        const nameOf = (id: number) => managers.find((m) => m.id === id)?.name ?? `#${id}`;
                        const statusLabel = simResult.periodStatus === 'closed' ? 'закрыт' : simResult.periodStatus === 'open' ? 'открыт' : 'не рассчитан';
                        return (
                            <div className="border-t border-violet-200">
                                <div className="px-2 py-1 text-[11px] text-violet-900">
                                    Период {MONTHS[simResult.month - 1]} {simResult.year} · статус: <b>{statusLabel}</b>
                                    {simResult.periodStatus === 'none' && ' (факта нет — сравнивать не с чем)'}
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-violet-100/50 text-left text-[10px] uppercase text-violet-800">
                                            <tr><th className="p-1.5">Менеджер</th><th className="p-1.5 text-right">Факт</th><th className="p-1.5 text-right">Симуляция</th><th className="p-1.5 text-right">Δ</th></tr>
                                        </thead>
                                        <tbody className="divide-y divide-violet-100">
                                            {ids.map((id) => {
                                                const a = act.get(id); const s = sim.get(id);
                                                const d = (s ?? 0) - (a ?? 0);
                                                return (
                                                    <tr key={id}>
                                                        <td className="p-1.5">{nameOf(id)}</td>
                                                        <td className="p-1.5 text-right tabular-nums">{rub(a)}</td>
                                                        <td className="p-1.5 text-right tabular-nums">{rub(s)}</td>
                                                        <td className={`p-1.5 text-right tabular-nums font-medium ${d > 0 ? 'text-emerald-700' : d < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>{d === 0 ? '—' : (d > 0 ? '+' : '') + Math.round(d).toLocaleString('ru-RU') + ' ₽'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot className="border-t-2 border-violet-300 bg-violet-100/40 font-semibold text-violet-900">
                                            <tr>
                                                <td className="p-1.5">ФОТ отдела</td>
                                                <td className="p-1.5 text-right tabular-nums">{rub(simResult.actualTotal)}</td>
                                                <td className="p-1.5 text-right tabular-nums">{rub(simResult.simulatedTotal)}</td>
                                                <td className={`p-1.5 text-right tabular-nums ${simResult.simulatedTotal - simResult.actualTotal > 0 ? 'text-emerald-700' : simResult.simulatedTotal - simResult.actualTotal < 0 ? 'text-red-600' : ''}`}>
                                                    {(() => { const d = simResult.simulatedTotal - simResult.actualTotal; return d === 0 ? '—' : (d > 0 ? '+' : '') + Math.round(d).toLocaleString('ru-RU') + ' ₽'; })()}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-[11px] text-muted-foreground">Роль (группа RetailCRM):</span>
                    <select
                        value=""
                        onChange={(e) => { addSchemeFromGroup(e.target.value); e.currentTarget.value = ''; }}
                        className="h-8 border px-2 text-sm"
                        disabled={availableGroups.length === 0}
                    >
                        <option value="">{availableGroups.length ? '+ Добавить роль из справочника…' : 'все роли уже добавлены'}</option>
                        {availableGroups.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
                    </select>
                    <Button size="sm" variant="outline" className="h-8" onClick={addEngineerScheme} title="Роль инженера-расчётчика (код задаётся вручную, блоки — из палитры)"><Plus className="mr-1 h-3.5 w-3.5" /> Роль инженера</Button>
                </div>
                {schemes.map((s, si) => {
                  const isEng = (s.kind ?? 'manager') === 'engineer';
                  const saveKey = s.code || `new-${si}`;
                  const paletteDrag = !!drag?.fromPalette;          // тащим блок из палитры
                  const dup = paletteDrag && s.blocks.some((b) => b.block_code === drag!.fromPalette); // блок уже есть в роли
                  const over = overScheme === si;
                  return (
                    <div key={`${s.kind ?? 'manager'}:${s.code || si}`}
                        onDragOver={(e) => { e.preventDefault(); if (paletteDrag) setOverScheme(si); }}
                        onDrop={() => { if (drag?.fromPalette) addBlock(si, drag.fromPalette); setDrag(null); setOverScheme(null); }}
                        className={`border transition-[box-shadow,background-color] ${paletteDrag ? (dup ? 'ring-1 ring-amber-300' : over ? 'ring-2 ring-blue-500 bg-blue-50/40' : 'ring-1 ring-blue-300') : ''}`}>
                        {paletteDrag && (
                            <div className={`px-2 py-1 text-center text-[10px] font-medium ${dup ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                                {dup ? 'Блок уже добавлен в эту роль' : over ? '↓ Отпустите, чтобы добавить в эту роль' : 'Можно перетащить сюда'}
                            </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1.5">
                            {isEng ? (
                                <input value={s.name} onChange={(e) => setField(si, { name: e.target.value })} placeholder="Название роли (напр. Инженер 4%)" className="h-8 min-w-[160px] flex-1 border px-2 text-sm font-semibold" title="Роль инженера-расчётчика" />
                            ) : (
                                <span className="text-sm font-semibold px-1" title="Роль (группа RetailCRM)">{s.name}</span>
                            )}
                            {/* История мотивации: какая версия роли действовала на какую дату.
                                Выбор версии открывает её состав блоков — так видно, по каким
                                правилам считался прошлый месяц. */}
                            {(versions[s.code]?.length ?? 0) > 1 && (
                                <select
                                    value={s.prevEffectiveFrom || ''}
                                    onChange={(e) => openVersion(si, s.code, e.target.value)}
                                    className="ml-auto h-8 border px-2 text-xs"
                                    title="Версия мотивации: показать, что действовало с этой даты"
                                >
                                    {versions[s.code].map((v: any) => (
                                        <option key={v.effectiveFrom} value={v.effectiveFrom}>
                                            версия с {ruDate(v.effectiveFrom)}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <label className={`${(versions[s.code]?.length ?? 0) > 1 ? '' : 'ml-auto'} text-[11px] text-muted-foreground`}>с</label>
                            <input type="date" value={s.effectiveFrom} onChange={(e) => setField(si, { effectiveFrom: e.target.value })} className="h-8 border px-2 text-xs" />
                            {s.prevEffectiveFrom && s.effectiveFrom !== s.prevEffectiveFrom && (
                                <span className="bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700" title="Прошлые периоды продолжат считаться по прежней версии">
                                    новая версия; с {ruDate(s.prevEffectiveFrom)} останется как есть
                                </span>
                            )}
                            {(() => {
                                const assigned = isEng
                                    ? engineerAssignments.filter((a) => a.schemeCode === s.code).length
                                    : assignments.filter((a) => a.schemeCode === s.code).length;
                                return (
                                    <Button size="sm" variant="outline" className="h-8 border-violet-300 text-violet-700 hover:bg-violet-50" onClick={() => setSimSchemeIdx(si)} disabled={assigned === 0}
                                        title={assigned === 0 ? 'Нет людей в этой роли (назначьте в «Реестр ОП»)' : 'Симулятор ФОТ: ползунки → мгновенный пересчёт'}>
                                        <SlidersHorizontal className="mr-1 h-3.5 w-3.5" /> Симулятор ФОТ
                                    </Button>
                                );
                            })()}
                            <Button size="sm" className="h-8" onClick={() => save(s, si)} disabled={saving === saveKey}>{saving === saveKey ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />} Сохранить</Button>
                            <Button size="sm" variant="outline" className="h-8 px-2 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => removeScheme(si)} disabled={saving === saveKey} title="Удалить роль"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                        {s.blocks.length === 0 ? (
                            <div className="m-2 border border-dashed p-3 text-center text-[11px] text-muted-foreground">Перетащите сюда блоки</div>
                        ) : (
                            <div className="divide-y">
                                {s.blocks.map((b, bi) => {
                                    const meta = byCode(b.block_code);
                                    const tint = tintFor(b.block_code);
                                    const key = `${s.code}:${b.block_code}`;
                                    const isOpen = open.has(key);
                                    return (
                                        <div key={b.block_code} draggable onDragStart={(e) => { e.stopPropagation(); setDrag({ schemeIdx: si, blockIdx: bi }); }}
                                            onDragEnd={() => { setDrag(null); setOverScheme(null); }}
                                            onDragOver={(e) => { e.preventDefault(); if (drag?.fromPalette) setOverScheme(si); }}
                                            onDrop={(e) => {
                                                e.stopPropagation();
                                                if (drag?.fromPalette) addBlock(si, drag.fromPalette); // drop из палитры на карточку — добавляем в роль, а не глотаем
                                                else if (drag && drag.schemeIdx === si && drag.blockIdx != null) reorder(si, drag.blockIdx, bi);
                                                setDrag(null); setOverScheme(null);
                                            }}
                                            style={{ backgroundColor: tint.bg, borderLeft: `3px solid ${tint.bar}` }}>
                                            <div className="flex items-center gap-1.5 px-2 py-1.5">
                                                <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
                                                <button onClick={() => toggleOpen(key)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                                                    <span className="shrink-0 text-xs font-semibold">{meta?.name ?? b.block_code}</span>
                                                    <span onClick={(e) => e.stopPropagation()}><MethodologyTip text={meta?.methodology} /></span>
                                                    {!isOpen && <span className="truncate text-[10px] text-muted-foreground">{summarize(b.params)}</span>}
                                                </button>
                                                <button onClick={() => removeBlock(si, bi)} className="shrink-0 text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                                            </div>
                                            {isOpen && (
                                                <div className="space-y-1.5 px-2 pb-2 pl-7">
                                                    {meta && <div className="text-[10px] leading-snug text-muted-foreground">{meta.methodology}</div>}
                                                    <div className="bg-white p-2"><ParamsForm params={b.params} onChange={(nv) => patchBlock(si, bi, { params: nv })} /></div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                  );
                })}
                {archived.length > 0 && (
                    <div className="border border-dashed">
                        <div className="border-b bg-muted/30 px-2 py-1.5 text-xs font-semibold uppercase tracking-tight text-muted-foreground">Архив ролей</div>
                        <div className="divide-y">
                            {archived.map((a) => (
                                <div key={a.code} className="flex items-center gap-2 px-2 py-1.5">
                                    <span className="text-sm text-muted-foreground">{a.name}</span>
                                    <span className="text-[10px] text-muted-foreground">в архиве с {String(a.archivedAt).slice(0, 10)}</span>
                                    <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => restoreSchemeUi(a.code, a.name)} disabled={saving === a.code}>{saving === a.code ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Восстановить</Button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
        {simSchemeIdx != null && schemes[simSchemeIdx] && ((schemes[simSchemeIdx].kind ?? 'manager') === 'engineer' ? (
            <EngineerFotSimulatorModal
                schemeName={schemes[simSchemeIdx].name}
                blocks={schemes[simSchemeIdx].blocks.map((b) => ({ block_code: b.block_code, params: b.params, enabled: b.enabled }))}
                itemCodes={engineerAssignments.filter((a) => a.schemeCode === schemes[simSchemeIdx!].code).map((a) => a.itemCode)}
                initialYear={simYear}
                initialMonth={simMonth}
                onClose={() => setSimSchemeIdx(null)}
            />
        ) : (
            <FotSimulatorModal
                schemeCode={schemes[simSchemeIdx].code}
                schemeName={schemes[simSchemeIdx].name}
                blocks={schemes[simSchemeIdx].blocks.map((b) => ({ block_code: b.block_code, params: b.params, enabled: b.enabled }))}
                managerIds={assignments.filter((a) => a.schemeCode === schemes[simSchemeIdx!].code).map((a) => a.managerId)}
                initialYear={simYear}
                initialMonth={simMonth}
                onClose={() => setSimSchemeIdx(null)}
            />
        ))}
      </CategoriesContext.Provider>
    );
}

// ── Реестр ОП ────────────────────────────────────────────────────────────────
export function RosterTab() {
    const { toast } = useToast();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try { const res = await fetch('/api/salary/schemes'); const j = await res.json(); if (j.error) throw new Error(j.error); setData(j); }
        catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    if (loading || !data) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
    const nameByCode = new Map<string, string>((data.schemes ?? []).map((s: any) => [s.code, s.name]));
    const assignmentName = (id: number) => {
        const code = data?.assignments?.find((a: any) => a.managerId === id)?.schemeCode;
        return code ? (nameByCode.get(code) ?? code) : null;
    };
    const inRoster = (m: any) => assignmentName(m.id) != null;

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <div className="text-sm font-semibold">Менеджеры</div>
                <div className="border bg-muted/30 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                    Роль (схема) определяется <b>группами пользователя в RetailCRM</b> автоматически; при нескольких подходящих ролях её выбирают там же.
                    Кто участвует в расчёте ЗП — отмечается пофамильно в <a href="/settings/managers" className="text-primary underline">Настройки → Менеджеры</a>.
                    Здесь — только просмотр итогового реестра.
                </div>
                <div className="overflow-x-auto border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-2 py-1.5">ID</th><th className="px-2 py-1.5">Менеджер</th><th className="px-2 py-1.5">Активен</th><th className="px-2 py-1.5">Роль (из RetailCRM)</th></tr></thead>
                        <tbody>
                            {(data.managers ?? []).map((m: any) => (
                                <tr key={m.id} className={`border-t ${inRoster(m) ? '' : 'opacity-50'}`}>
                                    <td className="px-2 py-1 text-muted-foreground">{m.id}</td>
                                    <td className="px-2 py-1">{m.name}</td>
                                    <td className="px-2 py-1">{m.active ? '✓' : '—'}</td>
                                    <td className="px-2 py-1">{assignmentName(m.id) ?? <span className="text-muted-foreground">— не в реестре ЗП —</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {/* Инженеры-расчётчики — тоже сотрудники ОП (из справочника, не пользователи CRM). */}
            <div className="border-t pt-4"><EngineerRosterSection /></div>
        </div>
    );
}

// ── Планы ────────────────────────────────────────────────────────────────────
export function PlansTab() {
    const { toast } = useToast();
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [baseline, setBaseline] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/salary/plans?period=${year}-${month}`); const j = await res.json(); if (j.error) throw new Error(j.error);
            setData(j); const e: Record<string, string> = {}; for (const p of j.plans ?? []) e[p.manager_id == null ? 'dept' : String(p.manager_id)] = String(p.target); setEdits(e); setBaseline(e);
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [year, month, toast]);
    useEffect(() => { load(); }, [load]);

    const setEdit = (key: string, v: number | null) => { setEdits((p) => ({ ...p, [key]: v == null ? '' : String(v) })); setSavedAt(0); };

    // строки, у которых значение отличается от сохранённого
    const dirtyKeys = (() => {
        const keys = Array.from(new Set([...Object.keys(edits), ...Object.keys(baseline)]));
        return keys.filter((k) => (edits[k] ?? '') !== (baseline[k] ?? ''));
    })();
    const dirty = dirtyKeys.length > 0;

    const saveAll = async () => {
        if (!dirty || saving) return;
        setSaving(true);
        try {
            for (const key of dirtyKeys) {
                const managerId = key === 'dept' ? null : Number(key);
                const raw = edits[key];
                const res = await fetch('/api/salary/plans', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, month, managerId, target: raw === '' || raw == null ? null : Number(raw) }) });
                const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Ошибка');
            }
            setBaseline({ ...edits });
            setSavedAt(Date.now());
            toast({ title: `Сохранено: планов — ${dirtyKeys.length}` });
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setSaving(false); }
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-8 border px-2">{MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}</select>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-8 border px-2">{[year - 1, year, year + 1].map((yy) => <option key={yy} value={yy}>{yy}</option>)}</select>
                <span className="text-muted-foreground">План в выручке без НДС, ₽. Личные и общий независимы.</span>
            </div>
            {loading || !data ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
                <>
                    <div className="overflow-x-auto border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-2 py-1.5">Кто</th><th className="px-2 py-1.5">План, ₽</th></tr></thead>
                            <tbody>
                                <tr className={`border-t ${dirtyKeys.includes('dept') ? 'bg-amber-50' : 'bg-muted/20'}`}>
                                    <td className="px-2 py-1 font-semibold">Общий план отдела {dirtyKeys.includes('dept') && <span className="ml-1 text-[11px] font-normal text-amber-600">• не сохранено</span>}</td>
                                    <td className="px-2 py-1"><NumberInput value={edits['dept'] == null || edits['dept'] === '' ? null : Number(edits['dept'])} onChange={(v) => setEdit('dept', v)} className="h-8 w-40 border px-2 text-right" placeholder="—" /></td>
                                </tr>
                                {(data.managers ?? []).filter((m: any) => m.active).map((m: any) => {
                                    const k = String(m.id); const rowDirty = dirtyKeys.includes(k);
                                    return (
                                        <tr key={m.id} className={`border-t ${rowDirty ? 'bg-amber-50' : ''}`}>
                                            <td className="px-2 py-1">{m.name} <span className="text-[11px] text-muted-foreground">#{m.id}</span>{rowDirty && <span className="ml-1 text-[11px] text-amber-600">• не сохранено</span>}</td>
                                            <td className="px-2 py-1"><NumberInput value={edits[k] == null || edits[k] === '' ? null : Number(edits[k])} onChange={(v) => setEdit(k, v)} className="h-8 w-40 border px-2 text-right" placeholder="—" /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                        <Button size="sm" className="h-9 bg-slate-900 px-4 text-white hover:bg-slate-700 disabled:bg-slate-300 disabled:text-white" onClick={saveAll} disabled={!dirty || saving}>
                            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                            {saving ? 'Сохранение…' : dirty ? `Сохранить изменения (${dirtyKeys.length})` : 'Сохранить'}
                        </Button>
                        {!dirty && savedAt > 0 && <span className="flex items-center gap-1 text-xs text-green-600"><Check className="h-4 w-4" /> Все изменения сохранены</span>}
                        {dirty && !saving && <span className="text-xs text-muted-foreground">Есть несохранённые изменения</span>}
                    </div>
                </>
            )}
        </div>
    );
}

// ── Инженеры-расчётчики ОП ────────────────────────────────────────────────────
// Роли инженеров — в общем конструкторе SchemesTab (kind='engineer', drag-drop из
// той же палитры). Здесь — только реестр людей (для вкладки «Реестр ОП»): инженеры
// не пользователи CRM, а элементы справочника; опт-ин + назначение роли пофамильно.
const firstOfThisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

// Реестр инженеров-расчётчиков — ЛЮДИ ОП: опт-ин + назначение роли пофамильно.
// Живёт во вкладке «Реестр ОП» (инженеры — сотрудники ОП, но не пользователи CRM).
export function EngineerRosterSection() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [fieldCode, setFieldCode] = useState('');
    const [schemes, setSchemes] = useState<{ code: string; name: string }[]>([]);
    const [roster, setRoster] = useState<{ itemCode: string; name: string; inRoster: boolean; schemeCode: string | null }[]>([]);
    const [effectiveFrom, setEffectiveFrom] = useState(firstOfThisMonth);
    const [savingRoster, setSavingRoster] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/salary/engineers');
            const e = await res.json(); if (e.error) throw new Error(e.error);
            setFieldCode(e.fieldCode || '');
            setSchemes((e.schemes ?? []).map((s: any) => ({ code: s.code, name: s.name })));
            setRoster((e.roster ?? []).map((r: any) => ({ itemCode: r.itemCode, name: r.name, inRoster: !!r.inRoster, schemeCode: r.schemeCode ?? null })));
        } catch (err: any) { toast({ title: 'Ошибка', description: err.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const saveRoster = async () => {
        if (roster.some((r) => r.inRoster && !r.schemeCode)) { toast({ title: 'У отмеченных инженеров не выбрана роль', variant: 'destructive' }); return; }
        setSavingRoster(true);
        try {
            const rows = roster.filter((r) => r.inRoster && r.schemeCode).map((r) => ({ itemCode: r.itemCode, schemeCode: r.schemeCode }));
            const res = await fetch('/api/salary/engineers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'roster', rows, effectiveFrom }) });
            const j = await res.json(); if (j.error) throw new Error(j.error);
            toast({ title: 'Реестр инженеров сохранён' });
            await load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setSavingRoster(false); }
    };

    if (loading) return <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;

    const inputCls = 'border px-2 py-1 text-sm';
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-sm font-semibold">Инженеры-расчётчики</div>
                    <div className="text-[11px] text-muted-foreground">Сотрудники ОП из справочника «Инженера ОП» (не пользователи CRM). Отметьте, кто в ЗП, и выберите роль. Роли настраиваются во вкладке «Схемы (роли)».</div>
                </div>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">назначить с <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={inputCls} /></label>
            </div>
            {roster.length === 0 ? (
                <div className="border bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Справочник инженеров не синхронизирован (поле <code>{fieldCode || 'inzhener_zakaza'}</code> ещё не подтянулось в базу). Запустите синхронизацию справочников <code>/api/sync/dictionaries</code> — список появится здесь автоматически.
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="w-10 px-2 py-1.5">В ЗП</th><th className="px-2 py-1.5">Инженер</th><th className="px-2 py-1.5">Код</th><th className="px-2 py-1.5">Роль</th></tr></thead>
                            <tbody>
                                {roster.map((r, i) => (
                                    <tr key={r.itemCode} className={`border-t ${r.inRoster ? '' : 'opacity-60'}`}>
                                        <td className="px-2 py-1 text-center"><input type="checkbox" checked={r.inRoster} onChange={(e) => setRoster((rr) => rr.map((x, j) => (j === i ? { ...x, inRoster: e.target.checked } : x)))} className="h-4 w-4 accent-primary" /></td>
                                        <td className="px-2 py-1">{r.name}</td>
                                        <td className="px-2 py-1 text-muted-foreground">{r.itemCode}</td>
                                        <td className="px-2 py-1">
                                            <select value={r.schemeCode ?? ''} onChange={(e) => setRoster((rr) => rr.map((x, j) => (j === i ? { ...x, schemeCode: e.target.value || null } : x)))} disabled={!r.inRoster} className={`${inputCls} w-56 disabled:bg-muted`}>
                                                <option value="">— выберите роль —</option>
                                                {schemes.map((s) => <option key={s.code} value={s.code}>{s.name || s.code}</option>)}
                                                {r.schemeCode && !schemes.some((s) => s.code === r.schemeCode) && <option value={r.schemeCode}>{r.schemeCode} (архив)</option>}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Button size="sm" className="h-9 bg-slate-900 px-4 text-white hover:bg-slate-700" onClick={saveRoster} disabled={savingRoster}>
                        {savingRoster ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Сохранить
                    </Button>
                </>
            )}
        </div>
    );
}
