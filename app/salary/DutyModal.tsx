'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAsyncAction } from '@/components/ui/useAsyncAction';

interface DutyRow {
    id: number;
    manager_id: number;
    work_date: string;
    kind: string;
    shifts: number;
    note: string | null;
}
interface Manager { id: number; name: string }

const KIND_LABEL: Record<string, string> = { worked_day: 'Отработанный день' };

export default function DutyModal({ period, monthLabel, onClose }: { period: string; monthLabel: string; onClose: () => void }) {
    const [rows, setRows] = useState<DutyRow[]>([]);
    const [managers, setManagers] = useState<Manager[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { toast } = useToast();
    // Мгновенный отклик на клик (golds/GOLD_DESIGN_UX.md §2)
    const { run, isPending } = useAsyncAction();

    const [mgr, setMgr] = useState<number | ''>('');
    const [date, setDate] = useState('');
    const [kind, setKind] = useState('worked_day');
    const [shifts, setShifts] = useState(1);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/salary/duty?period=${period}`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setRows(json.rows ?? []);
            setManagers(json.managers ?? []);
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [period, toast]);

    useEffect(() => { load(); }, [load]);

    const add = async () => {
        if (!mgr || !date) {
            toast({ title: 'Заполните менеджера и дату', variant: 'destructive' });
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/salary/duty', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ manager_id: mgr, work_date: date, kind, shifts }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось добавить');
            setDate('');
            load();
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id: number) => {
        try {
            const res = await fetch(`/api/salary/duty?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Не удалось удалить');
            load();
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        }
    };

    const nameById = (id: number) => managers.find((m) => m.id === id)?.name || `#${id}`;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
            <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto border border-border bg-background p-5" onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex items-center">
                    <h2 className="text-lg font-semibold">Табель отработанных дней — {monthLabel}</h2>
                    <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-2 border p-3 md:grid-cols-5">
                    <select value={mgr} onChange={(e) => setMgr(e.target.value === '' ? '' : Number(e.target.value))} className="col-span-2 h-9 border border-input bg-background px-2 text-sm md:col-span-1">
                        <option value="">Менеджер…</option>
                        {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
                    <div className="flex items-center text-sm text-muted-foreground px-2 bg-muted/20 border border-input rounded-md h-9">
                        Отработанный день
                    </div>
                    <Input type="number" min={0} step={0.5} value={shifts} onChange={(e) => setShifts(Number(e.target.value))} className="h-9" title="Смен/дней" />
                    <Button size="sm" onClick={add} disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Добавить
                    </Button>
                </div>

                {loading ? (
                    <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : rows.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">Записей за период нет.</div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="text-left text-xs text-muted-foreground">
                            <tr><th className="p-2">Дата</th><th className="p-2">Менеджер</th><th className="p-2">Тип</th><th className="p-2 text-right">Смен</th><th></th></tr>
                        </thead>
                        <tbody>
                            {rows.map((d) => (
                                <tr key={d.id} className="border-t">
                                    <td className="p-2">{d.work_date}</td>
                                    <td className="p-2">{nameById(d.manager_id)}</td>
                                    <td className="p-2">{KIND_LABEL[d.kind] || d.kind}</td>
                                    <td className="p-2 text-right">{d.shifts}</td>
                                    <td className="p-2 text-right">
                                        <button
                                            onClick={() => run(`del:${d.id}`, () => remove(d.id))}
                                            disabled={isPending(`del:${d.id}`)}
                                            aria-busy={isPending(`del:${d.id}`) || undefined}
                                            title="Удалить запись"
                                            className="text-muted-foreground hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isPending(`del:${d.id}`) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                    «Отработанный день» используется для пропорции оклада. После изменений нажмите «Пересчитать» на дашборде.
                </p>
            </div>
        </div>
    );
}
