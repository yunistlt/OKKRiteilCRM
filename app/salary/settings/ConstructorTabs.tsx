'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Trash2, GripVertical, Save, ChevronRight, ChevronDown, Code2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

type Catalog = { code: string; name: string; methodology: string; kind: string; group: string; requiredMetrics: string[]; defaultParams: any; available: boolean }[];
type SchemeBlock = { block_code: string; params: any; raw: boolean; rawText: string; enabled: boolean };
type EditScheme = { code: string; name: string; effectiveFrom: string; blocks: SchemeBlock[] };

// ── Цвета блоков (нежные: белый + тон). Один код → один цвет в палитре и в роли ──
const BLOCK_TINTS = [
    { bg: '#f3f6ff', bar: '#3b82f6' }, // синий
    { bg: '#f1faf3', bar: '#16a34a' }, // зелёный
    { bg: '#fff6f1', bar: '#ea580c' }, // оранжевый
    { bg: '#faf2fb', bar: '#a21caf' }, // пурпурный
    { bg: '#eefafd', bar: '#0891b2' }, // циан
    { bg: '#fdf9ee', bar: '#ca8a04' }, // янтарный
    { bg: '#f4f3fb', bar: '#7c3aed' }, // фиолетовый
    { bg: '#fdf1f3', bar: '#e11d48' }, // розовый
];
function tintFor(code: string) {
    let h = 0;
    for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
    return BLOCK_TINTS[h % BLOCK_TINTS.length];
}

// ── RU-лейблы технических ключей параметров ──
const PARAM_LABELS: Record<string, string> = {
    oklad: 'Оклад, ₽', prorate: 'Пропорция по отработанным дням',
    rates: 'Ставки по типам заявок', new: 'Новый', permanent: 'Постоянный', pech_vto: 'Печь / ВТО',
    tiers: 'Пороги', min: 'От', k: 'Коэффициент ×', bonus: 'Бонус, ₽',
    minZayavki: 'Мин. входящих', metric: 'Метрика', comparator: 'Сравнение', threshold: 'Порог',
    rate: 'Ставка за смену, ₽',
};
const labelFor = (k: string) => PARAM_LABELS[k] ?? k;
const COMPARATORS: Record<string, string> = { lte: '≤ не больше', gte: '≥ не меньше' };

// Короткая сводка параметров для свёрнутого блока.
function summarize(params: any): string {
    if (params == null || typeof params !== 'object') return '';
    return Object.entries(params).map(([k, v]) => {
        if (Array.isArray(v)) return `${labelFor(k)}: ${v.length}`;
        if (v && typeof v === 'object') return labelFor(k);
        return `${labelFor(k)} ${v}`;
    }).join(' · ');
}

// ── Редактор параметров блока (поля вместо сырого JSON) ──────────────────────
const inputCls = 'h-7 border px-2 text-xs';

function ScalarField({ pkey, value, onChange }: { pkey: string; value: any; onChange: (v: any) => void }) {
    if (pkey === 'comparator' && typeof value === 'string') {
        return (
            <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
                {Object.entries(COMPARATORS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
        );
    }
    if (typeof value === 'boolean') {
        return <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-primary" />;
    }
    if (typeof value === 'number') {
        return <input type="number" value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} className={`${inputCls} w-28 text-right`} />;
    }
    return <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={`${inputCls} w-full`} />;
}

// Таблица для массива объектов вида {min,k} / {min,bonus} (пороги).
function TierTable({ value, onChange }: { value: any[]; onChange: (v: any[]) => void }) {
    const keys = Array.from(new Set(value.flatMap((r) => Object.keys(r ?? {}))));
    const setCell = (i: number, k: string, v: any) => onChange(value.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    const addRow = () => onChange([...value, keys.reduce((a, k) => ({ ...a, [k]: 0 }), {})]);
    const delRow = (i: number) => onChange(value.filter((_, j) => j !== i));
    return (
        <div className="border">
            <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>{keys.map((k) => <th key={k} className="px-2 py-1 font-medium">{labelFor(k)}</th>)}<th className="w-8" /></tr>
                </thead>
                <tbody>
                    {value.map((row, i) => (
                        <tr key={i} className="border-t">
                            {keys.map((k) => (
                                <td key={k} className="px-1 py-0.5">
                                    <ScalarField pkey={k} value={row?.[k]} onChange={(v) => setCell(i, k, v)} />
                                </td>
                            ))}
                            <td className="px-1 text-center"><button onClick={() => delRow(i)} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <button onClick={addRow} className="flex w-full items-center justify-center gap-1 border-t py-1 text-[11px] text-muted-foreground hover:bg-accent"><Plus className="h-3 w-3" /> Добавить порог</button>
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
                    return <div key={k}><div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{labelFor(k)}</div><TierTable value={v} onChange={(nv) => set(k, nv)} /></div>;
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
    const [loading, setLoading] = useState(true);
    const [drag, setDrag] = useState<{ fromPalette?: string; schemeIdx?: number; blockIdx?: number } | null>(null);
    const [saving, setSaving] = useState<string | null>(null);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const toggleOpen = (key: string) => setOpen((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [bRes, sRes] = await Promise.all([fetch('/api/salary/blocks'), fetch('/api/salary/schemes')]);
            const bJson = await bRes.json();
            const sJson = await sRes.json();
            if (bJson.error) throw new Error(bJson.error);
            if (sJson.error) throw new Error(sJson.error);
            setCatalog(bJson.blocks ?? []);
            setSchemes((sJson.schemes ?? []).map((s: any) => ({
                code: s.code, name: s.name, effectiveFrom: String(s.effectiveFrom).slice(0, 10),
                blocks: (s.blocks ?? []).map((b: any) => ({ block_code: b.block_code, params: b.params ?? {}, raw: false, rawText: '', enabled: b.enabled !== false })),
            })));
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const byCode = (code: string) => catalog.find((c) => c.code === code);
    const addBlock = (si: number, code: string) => setSchemes((prev) => prev.map((s, i) => {
        if (i !== si || s.blocks.some((b) => b.block_code === code)) return s;
        return { ...s, blocks: [...s.blocks, { block_code: code, params: byCode(code)?.defaultParams ?? {}, raw: false, rawText: '', enabled: true }] };
    }));
    const removeBlock = (si: number, bi: number) => setSchemes((p) => p.map((s, i) => (i === si ? { ...s, blocks: s.blocks.filter((_, j) => j !== bi) } : s)));
    const reorder = (si: number, from: number, to: number) => setSchemes((p) => p.map((s, i) => {
        if (i !== si) return s; const arr = [...s.blocks]; const [m] = arr.splice(from, 1); arr.splice(to, 0, m); return { ...s, blocks: arr };
    }));
    const setField = (si: number, patch: Partial<EditScheme>) => setSchemes((p) => p.map((s, i) => (i === si ? { ...s, ...patch } : s)));
    const patchBlock = (si: number, bi: number, patch: Partial<SchemeBlock>) =>
        setSchemes((p) => p.map((s, i) => (i === si ? { ...s, blocks: s.blocks.map((b, j) => (j === bi ? { ...b, ...patch } : b)) } : s)));
    // Переключение режима «поля ↔ сырой JSON» с сохранением значения.
    const toggleRaw = (si: number, bi: number, b: SchemeBlock) => {
        if (b.raw) {
            try { patchBlock(si, bi, { params: JSON.parse(b.rawText || '{}'), raw: false }); }
            catch { toast({ title: 'Ошибка', description: 'Проверьте JSON', variant: 'destructive' }); }
        } else {
            patchBlock(si, bi, { raw: true, rawText: JSON.stringify(b.params, null, 2) });
        }
    };

    const save = async (s: EditScheme) => {
        let blocks;
        try { blocks = s.blocks.map((b) => ({ block_code: b.block_code, params: b.raw ? JSON.parse(b.rawText || '{}') : b.params, enabled: b.enabled })); }
        catch { toast({ title: 'Ошибка', description: 'Проверьте JSON параметров', variant: 'destructive' }); return; }
        setSaving(s.code);
        try {
            const res = await fetch('/api/salary/schemes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: s.code, name: s.name, effectiveFrom: s.effectiveFrom, blocks }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            toast({ title: 'Схема сохранена', description: s.name }); load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setSaving(null); }
    };
    const addScheme = () => {
        const code = prompt('Код новой схемы (латиницей):')?.trim();
        if (!code) return;
        if (schemes.some((s) => s.code === code)) { toast({ title: 'Такая схема уже есть', variant: 'destructive' }); return; }
        setSchemes((p) => [...p, { code, name: code, effectiveFrom: new Date().toISOString().slice(0, 10), blocks: [] }]);
    };

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

    return (
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <div>
                <div className="mb-0.5 text-xs font-semibold uppercase tracking-tight">Палитра блоков</div>
                <div className="mb-1.5 text-[10px] text-muted-foreground">Перетащите в схему. Серые — нет данных.</div>
                <div className="divide-y border">
                    {catalog.map((b) => {
                        const tint = tintFor(b.code);
                        return (
                            <div key={b.code} draggable={b.available} onDragStart={() => setDrag({ fromPalette: b.code })} title={b.methodology}
                                style={b.available ? { backgroundColor: tint.bg, borderLeft: `3px solid ${tint.bar}` } : undefined}
                                className={`px-2 py-1.5 text-xs ${b.available ? 'cursor-grab hover:brightness-95' : 'cursor-not-allowed border-l-[3px] border-transparent bg-muted text-muted-foreground'}`}>
                                <div className="font-medium leading-tight">{b.name}</div>
                                <div className="text-[10px] text-muted-foreground">{b.group}{b.available ? '' : ' · нет данных'}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="space-y-3">
                <div className="flex justify-end"><Button size="sm" variant="outline" className="h-8" onClick={addScheme}><Plus className="mr-1 h-3.5 w-3.5" /> Новая схема</Button></div>
                {schemes.map((s, si) => (
                    <div key={s.code} className="border" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag?.fromPalette) addBlock(si, drag.fromPalette); setDrag(null); }}>
                        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1.5">
                            <input value={s.name} onChange={(e) => setField(si, { name: e.target.value })} className="h-8 border px-2 text-sm font-semibold" />
                            <span className="text-[10px] text-muted-foreground">{s.code}</span>
                            <label className="ml-auto text-[11px] text-muted-foreground">с</label>
                            <input type="date" value={s.effectiveFrom} onChange={(e) => setField(si, { effectiveFrom: e.target.value })} className="h-8 border px-2 text-xs" />
                            <Button size="sm" className="h-8" onClick={() => save(s)} disabled={saving === s.code}>{saving === s.code ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />} Сохранить</Button>
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
                                            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); if (drag && drag.schemeIdx === si && drag.blockIdx != null) reorder(si, drag.blockIdx, bi); setDrag(null); }}
                                            style={{ backgroundColor: tint.bg, borderLeft: `3px solid ${tint.bar}` }}>
                                            <div className="flex items-center gap-1.5 px-2 py-1.5">
                                                <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
                                                <button onClick={() => toggleOpen(key)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                                                    <span className="shrink-0 text-xs font-semibold">{meta?.name ?? b.block_code}</span>
                                                    {!isOpen && <span className="truncate text-[10px] text-muted-foreground">{summarize(b.params)}</span>}
                                                </button>
                                                <button onClick={() => toggleRaw(si, bi, b)} title="Сырой JSON" className={`shrink-0 ${b.raw ? 'text-primary' : 'text-muted-foreground'} hover:text-foreground`}><Code2 className="h-3.5 w-3.5" /></button>
                                                <button onClick={() => removeBlock(si, bi)} className="shrink-0 text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                                            </div>
                                            {isOpen && (
                                                <div className="space-y-1.5 px-2 pb-2 pl-7">
                                                    {meta && <div className="text-[10px] leading-snug text-muted-foreground">{meta.methodology}</div>}
                                                    {b.raw
                                                        ? <textarea value={b.rawText} onChange={(e) => patchBlock(si, bi, { rawText: e.target.value })} rows={5} className="w-full border bg-white p-1 font-mono text-[10px]" spellCheck={false} />
                                                        : <div className="border bg-white p-2"><ParamsForm params={b.params} onChange={(nv) => patchBlock(si, bi, { params: nv })} /></div>}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Реестр ОП ────────────────────────────────────────────────────────────────
export function RosterTab() {
    const { toast } = useToast();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [eff, setEff] = useState(new Date().toISOString().slice(0, 10));

    const load = useCallback(async () => {
        setLoading(true);
        try { const res = await fetch('/api/salary/schemes'); const j = await res.json(); if (j.error) throw new Error(j.error); setData(j); }
        catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const assignment = (id: number) => data?.assignments?.find((a: any) => a.managerId === id)?.schemeCode ?? '';
    const act = async (managerId: number, schemeCode: string) => {
        try {
            const body = schemeCode ? { action: 'assign', managerId, schemeCode, effectiveFrom: eff } : { action: 'unassign', managerId, effectiveFrom: eff };
            const res = await fetch('/api/salary/schemes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Ошибка');
            toast({ title: 'Сохранено' }); load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
    };

    if (loading || !data) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
    const schemeCodes: { code: string; name: string }[] = (data.schemes ?? []).map((s: any) => ({ code: s.code, name: s.name }));

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Назначения с</span>
                <input type="date" value={eff} onChange={(e) => setEff(e.target.value)} className="h-8 border px-2" />
                <span className="text-muted-foreground">Только менеджеры со схемой попадают в расчёт ЗП.</span>
            </div>
            <div className="overflow-x-auto border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-2 py-1.5">ID</th><th className="px-2 py-1.5">Менеджер</th><th className="px-2 py-1.5">Активен</th><th className="px-2 py-1.5">Схема</th></tr></thead>
                    <tbody>
                        {(data.managers ?? []).map((m: any) => (
                            <tr key={m.id} className="border-t">
                                <td className="px-2 py-1 text-muted-foreground">{m.id}</td>
                                <td className="px-2 py-1">{m.name}</td>
                                <td className="px-2 py-1">{m.active ? '✓' : '—'}</td>
                                <td className="px-2 py-1">
                                    <select defaultValue={assignment(m.id)} onChange={(e) => act(m.id, e.target.value)} className="h-8 border px-2 text-sm">
                                        <option value="">— не в реестре —</option>
                                        {schemeCodes.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                                    </select>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
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

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/salary/plans?period=${year}-${month}`); const j = await res.json(); if (j.error) throw new Error(j.error);
            setData(j); const e: Record<string, string> = {}; for (const p of j.plans ?? []) e[p.manager_id == null ? 'dept' : String(p.manager_id)] = String(p.target); setEdits(e);
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [year, month, toast]);
    useEffect(() => { load(); }, [load]);

    const save = async (managerId: number | null) => {
        const key = managerId == null ? 'dept' : String(managerId); const raw = edits[key];
        try {
            const res = await fetch('/api/salary/plans', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, month, managerId, target: raw === '' || raw == null ? null : Number(raw) }) });
            const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Ошибка'); toast({ title: 'План сохранён' });
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-8 border px-2">{MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}</select>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-8 border px-2">{[year - 1, year, year + 1].map((yy) => <option key={yy} value={yy}>{yy}</option>)}</select>
                <span className="text-muted-foreground">План в выручке без НДС, ₽. Личные и общий независимы.</span>
            </div>
            {loading || !data ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
                <div className="overflow-x-auto border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-2 py-1.5">Кто</th><th className="px-2 py-1.5">План, ₽</th><th className="px-2 py-1.5"></th></tr></thead>
                        <tbody>
                            <tr className="border-t bg-muted/20">
                                <td className="px-2 py-1 font-semibold">Общий план отдела</td>
                                <td className="px-2 py-1"><input value={edits['dept'] ?? ''} onChange={(e) => setEdits((p) => ({ ...p, dept: e.target.value }))} className="h-8 w-40 border px-2 text-right" placeholder="—" /></td>
                                <td className="px-2 py-1"><Button size="sm" variant="outline" className="h-8" onClick={() => save(null)}>Сохранить</Button></td>
                            </tr>
                            {(data.managers ?? []).filter((m: any) => m.active).map((m: any) => (
                                <tr key={m.id} className="border-t">
                                    <td className="px-2 py-1">{m.name} <span className="text-[11px] text-muted-foreground">#{m.id}</span></td>
                                    <td className="px-2 py-1"><input value={edits[String(m.id)] ?? ''} onChange={(e) => setEdits((p) => ({ ...p, [m.id]: e.target.value }))} className="h-8 w-40 border px-2 text-right" placeholder="—" /></td>
                                    <td className="px-2 py-1"><Button size="sm" variant="outline" className="h-8" onClick={() => save(m.id)}>Сохранить</Button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
