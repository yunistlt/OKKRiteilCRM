'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Trash2, GripVertical, Save, ArrowLeft } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import Link from 'next/link';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

type Catalog = { code: string; name: string; methodology: string; kind: string; group: string; requiredMetrics: string[]; defaultParams: any; available: boolean }[];
type SchemeBlock = { block_code: string; paramsText: string; enabled: boolean };
type EditScheme = { code: string; name: string; effectiveFrom: string; blocks: SchemeBlock[]; isNew?: boolean };

export default function SalaryModelsPage() {
    const now = new Date();
    const [tab, setTab] = useState<'schemes' | 'roster' | 'plans'>('schemes');
    return (
        <div className="mx-auto max-w-5xl space-y-4 p-4">
            <div className="flex items-center gap-3">
                <Link href="/salary"><Button variant="outline" size="sm"><ArrowLeft className="mr-2 h-4 w-4" /> К зарплате</Button></Link>
                <h1 className="text-2xl font-semibold">Модели мотивации</h1>
            </div>
            <div className="flex gap-2 border-b">
                {([['schemes', 'Схемы (роли)'], ['roster', 'Реестр ОП'], ['plans', 'Планы']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm ${tab === k ? 'border-b-2 border-primary font-semibold' : 'text-muted-foreground'}`}>{label}</button>
                ))}
            </div>
            {tab === 'schemes' && <SchemesTab />}
            {tab === 'roster' && <RosterTab />}
            {tab === 'plans' && <PlansTab year={now.getFullYear()} month={now.getMonth() + 1} />}
        </div>
    );
}

// ── Конструктор схем ─────────────────────────────────────────────────────────
function SchemesTab() {
    const { toast } = useToast();
    const [catalog, setCatalog] = useState<Catalog>([]);
    const [schemes, setSchemes] = useState<EditScheme[]>([]);
    const [loading, setLoading] = useState(true);
    const [drag, setDrag] = useState<{ fromPalette?: string; schemeIdx?: number; blockIdx?: number } | null>(null);
    const [saving, setSaving] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [bRes, sRes] = await Promise.all([fetch('/api/salary/blocks'), fetch('/api/salary/schemes')]);
            const bJson = await bRes.json();
            const sJson = await sRes.json();
            if (bJson.error) throw new Error(bJson.error);
            if (sJson.error) throw new Error(sJson.error);
            setCatalog(bJson.blocks ?? []);
            setSchemes(
                (sJson.schemes ?? []).map((s: any) => ({
                    code: s.code,
                    name: s.name,
                    effectiveFrom: String(s.effectiveFrom).slice(0, 10),
                    blocks: (s.blocks ?? []).map((b: any) => ({ block_code: b.block_code, paramsText: JSON.stringify(b.params, null, 0), enabled: b.enabled !== false })),
                })),
            );
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const byCode = (code: string) => catalog.find((c) => c.code === code);

    const addBlock = (schemeIdx: number, code: string) => {
        setSchemes((prev) => prev.map((s, i) => {
            if (i !== schemeIdx) return s;
            if (s.blocks.some((b) => b.block_code === code)) return s; // один блок одного типа на схему
            const def = byCode(code)?.defaultParams ?? {};
            return { ...s, blocks: [...s.blocks, { block_code: code, paramsText: JSON.stringify(def), enabled: true }] };
        }));
    };
    const removeBlock = (si: number, bi: number) => setSchemes((p) => p.map((s, i) => (i === si ? { ...s, blocks: s.blocks.filter((_, j) => j !== bi) } : s)));
    const reorder = (si: number, from: number, to: number) => setSchemes((p) => p.map((s, i) => {
        if (i !== si) return s;
        const arr = [...s.blocks];
        const [m] = arr.splice(from, 1);
        arr.splice(to, 0, m);
        return { ...s, blocks: arr };
    }));
    const setField = (si: number, patch: Partial<EditScheme>) => setSchemes((p) => p.map((s, i) => (i === si ? { ...s, ...patch } : s)));
    const setParams = (si: number, bi: number, text: string) => setSchemes((p) => p.map((s, i) => (i === si ? { ...s, blocks: s.blocks.map((b, j) => (j === bi ? { ...b, paramsText: text } : b)) } : s)));

    const save = async (s: EditScheme) => {
        let blocks;
        try {
            blocks = s.blocks.map((b) => ({ block_code: b.block_code, params: JSON.parse(b.paramsText || '{}'), enabled: b.enabled }));
        } catch {
            toast({ title: 'Ошибка', description: 'Проверьте JSON параметров блоков', variant: 'destructive' });
            return;
        }
        setSaving(s.code);
        try {
            const res = await fetch('/api/salary/schemes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: s.code, name: s.name, effectiveFrom: s.effectiveFrom, blocks }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            toast({ title: 'Схема сохранена', description: s.name });
            load();
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setSaving(null);
        }
    };

    const addScheme = () => {
        const code = prompt('Код новой схемы (латиницей, напр. senior_seller):')?.trim();
        if (!code) return;
        if (schemes.some((s) => s.code === code)) { toast({ title: 'Такая схема уже есть', variant: 'destructive' }); return; }
        setSchemes((p) => [...p, { code, name: code, effectiveFrom: new Date().toISOString().slice(0, 10), blocks: [], isNew: true }]);
    };

    if (loading) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

    return (
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            {/* Палитра */}
            <div className="space-y-2">
                <div className="text-sm font-semibold">Палитра блоков</div>
                <div className="text-[11px] text-muted-foreground">Перетащите блок в схему. Серые — нет данных в БД.</div>
                <div className="space-y-1">
                    {catalog.map((b) => (
                        <div
                            key={b.code}
                            draggable={b.available}
                            onDragStart={() => setDrag({ fromPalette: b.code })}
                            title={b.methodology}
                            className={`rounded-md border p-2 text-xs ${b.available ? 'cursor-grab bg-white hover:border-primary' : 'cursor-not-allowed bg-muted text-muted-foreground'}`}
                        >
                            <div className="font-medium">{b.name}</div>
                            <div className="text-[10px] text-muted-foreground">{b.kind} · {b.group}{b.available ? '' : ' · нет данных'}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Схемы */}
            <div className="space-y-4">
                <div className="flex justify-end"><Button size="sm" variant="outline" onClick={addScheme}><Plus className="mr-2 h-4 w-4" /> Новая схема</Button></div>
                {schemes.map((s, si) => (
                    <div key={s.code} className="rounded-lg border p-3" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag?.fromPalette) addBlock(si, drag.fromPalette); setDrag(null); }}>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <input value={s.name} onChange={(e) => setField(si, { name: e.target.value })} className="h-8 rounded border px-2 text-sm font-semibold" />
                            <span className="text-xs text-muted-foreground">код: {s.code}</span>
                            <label className="ml-auto text-xs text-muted-foreground">действует с</label>
                            <input type="date" value={s.effectiveFrom} onChange={(e) => setField(si, { effectiveFrom: e.target.value })} className="h-8 rounded border px-2 text-sm" />
                            <Button size="sm" onClick={() => save(s)} disabled={saving === s.code}>{saving === s.code ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Сохранить</Button>
                        </div>
                        {s.blocks.length === 0 && <div className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">Перетащите сюда блоки из палитры</div>}
                        <div className="space-y-2">
                            {s.blocks.map((b, bi) => {
                                const meta = byCode(b.block_code);
                                return (
                                    <div
                                        key={b.block_code}
                                        draggable
                                        onDragStart={(e) => { e.stopPropagation(); setDrag({ schemeIdx: si, blockIdx: bi }); }}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => { e.stopPropagation(); if (drag && drag.schemeIdx === si && drag.blockIdx != null) reorder(si, drag.blockIdx, bi); setDrag(null); }}
                                        className="rounded-md border bg-muted/20 p-2"
                                    >
                                        <div className="flex items-center gap-2">
                                            <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />
                                            <span className="text-sm font-medium">{meta?.name ?? b.block_code}</span>
                                            <button onClick={() => removeBlock(si, bi)} className="ml-auto text-muted-foreground hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                                        </div>
                                        {meta && <div className="mb-1 text-[11px] text-muted-foreground">{meta.methodology}</div>}
                                        <textarea value={b.paramsText} onChange={(e) => setParams(si, bi, e.target.value)} rows={2} className="w-full rounded border p-1 font-mono text-[11px]" spellCheck={false} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Реестр ОП (назначения) ───────────────────────────────────────────────────
function RosterTab() {
    const { toast } = useToast();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [eff, setEff] = useState(new Date().toISOString().slice(0, 10));

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/salary/schemes');
            const j = await res.json();
            if (j.error) throw new Error(j.error);
            setData(j);
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const assignment = (id: number) => data?.assignments?.find((a: any) => a.managerId === id)?.schemeCode ?? '';

    const act = async (managerId: number, schemeCode: string) => {
        try {
            const body = schemeCode ? { action: 'assign', managerId, schemeCode, effectiveFrom: eff } : { action: 'unassign', managerId, effectiveFrom: eff };
            const res = await fetch('/api/salary/schemes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            toast({ title: 'Сохранено' });
            load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
    };

    if (loading || !data) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    const schemeCodes: { code: string; name: string }[] = (data.schemes ?? []).map((s: any) => ({ code: s.code, name: s.name }));

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Назначения действуют с</span>
                <input type="date" value={eff} onChange={(e) => setEff(e.target.value)} className="h-8 rounded border px-2" />
                <span className="text-xs text-muted-foreground">Только менеджеры со схемой попадают в расчёт ЗП.</span>
            </div>
            <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">ID</th><th className="p-2">Менеджер</th><th className="p-2">Активен</th><th className="p-2">Схема</th></tr></thead>
                    <tbody>
                        {(data.managers ?? []).map((m: any) => (
                            <tr key={m.id} className="border-t">
                                <td className="p-2 text-muted-foreground">{m.id}</td>
                                <td className="p-2">{m.name}</td>
                                <td className="p-2">{m.active ? '✓' : '—'}</td>
                                <td className="p-2">
                                    <select defaultValue={assignment(m.id)} onChange={(e) => act(m.id, e.target.value)} className="h-8 rounded border px-2 text-sm">
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
function PlansTab({ year: y0, month: m0 }: { year: number; month: number }) {
    const { toast } = useToast();
    const [year, setYear] = useState(y0);
    const [month, setMonth] = useState(m0);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [edits, setEdits] = useState<Record<string, string>>({}); // key: managerId|'dept' → target

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/salary/plans?period=${year}-${month}`);
            const j = await res.json();
            if (j.error) throw new Error(j.error);
            setData(j);
            const e: Record<string, string> = {};
            for (const p of j.plans ?? []) e[p.manager_id == null ? 'dept' : String(p.manager_id)] = String(p.target);
            setEdits(e);
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [year, month, toast]);
    useEffect(() => { load(); }, [load]);

    const save = async (managerId: number | null) => {
        const key = managerId == null ? 'dept' : String(managerId);
        const raw = edits[key];
        try {
            const res = await fetch('/api/salary/plans', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, month, managerId, target: raw === '' || raw == null ? null : Number(raw) }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            toast({ title: 'План сохранён' });
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 rounded-md border px-2 text-sm">{MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}</select>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 rounded-md border px-2 text-sm">{[year - 1, year, year + 1].map((yy) => <option key={yy} value={yy}>{yy}</option>)}</select>
                <span className="text-xs text-muted-foreground">План в выручке без НДС, ₽. Личные и общий — независимы.</span>
            </div>
            {loading || !data ? <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Кто</th><th className="p-2">План, ₽</th><th className="p-2"></th></tr></thead>
                        <tbody>
                            <tr className="border-t bg-muted/20">
                                <td className="p-2 font-semibold">Общий план отдела</td>
                                <td className="p-2"><input value={edits['dept'] ?? ''} onChange={(e) => setEdits((p) => ({ ...p, dept: e.target.value }))} className="h-8 w-40 rounded border px-2 text-right" placeholder="—" /></td>
                                <td className="p-2"><Button size="sm" variant="outline" onClick={() => save(null)}>Сохранить</Button></td>
                            </tr>
                            {(data.managers ?? []).filter((m: any) => m.active).map((m: any) => (
                                <tr key={m.id} className="border-t">
                                    <td className="p-2">{m.name} <span className="text-xs text-muted-foreground">#{m.id}</span></td>
                                    <td className="p-2"><input value={edits[String(m.id)] ?? ''} onChange={(e) => setEdits((p) => ({ ...p, [m.id]: e.target.value }))} className="h-8 w-40 rounded border px-2 text-right" placeholder="—" /></td>
                                    <td className="p-2"><Button size="sm" variant="outline" onClick={() => save(m.id)}>Сохранить</Button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
