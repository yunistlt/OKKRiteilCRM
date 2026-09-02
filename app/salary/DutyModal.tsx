'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAsyncAction } from '@/components/ui/useAsyncAction';

// ============================================================================
// Табель отработанных дней. Ручной ввод ПЕРЕБИВАЕТ автоматический расчёт по
// отпускам (email_intake_absences): если по менеджеру есть записи за месяц,
// оклад считается строго по ним. Стили — явными цветами: семантических токенов
// (bg-card / text-muted-foreground и т.п.) в конфиге Tailwind этого проекта нет.
// ============================================================================

interface DutyRow {
    id: number;
    manager_id: number;
    work_date: string;
    kind: string;
    shifts: number;
    note: string | null;
}
interface Manager { id: number; name: string }

const KIND_LABEL: Record<string, string> = { worked_day: 'Отработанный день', duty: 'Дежурство' };

export default function DutyModal({ period, monthLabel, onClose }: { period: string; monthLabel: string; onClose: () => void }) {
    const [rows, setRows] = useState<DutyRow[]>([]);
    const [managers, setManagers] = useState<Manager[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { toast } = useToast();
    const { run, isPending } = useAsyncAction();

    const [mgr, setMgr] = useState<number | ''>('');
    const [date, setDate] = useState('');
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

    // Esc закрывает окно (клавиатурная навигация — golds §2).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

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
                body: JSON.stringify({ manager_id: mgr, work_date: date, kind: 'worked_day', shifts }),
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

    // Итог по менеджерам — сразу видно, у кого табель ведётся (и перебивает отпуск).
    const totals = rows.reduce<Record<number, number>>((acc, r) => {
        if (r.kind === 'worked_day') acc[r.manager_id] = (acc[r.manager_id] ?? 0) + Number(r.shifts);
        return acc;
    }, {});

    const fieldClass = 'h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:outline-2 focus:outline-blue-600 focus:-outline-offset-1';
    const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div
                className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden border border-slate-300 bg-white text-slate-900"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                {/* Шапка */}
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                    <div>
                        <div className="text-base font-semibold">Табель отработанных дней</div>
                        <div className="text-xs text-slate-500">{monthLabel} · ручной ввод перебивает расчёт по отпускам</div>
                    </div>
                    <button onClick={onClose} className="p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Закрыть">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Форма добавления */}
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_auto_auto]">
                        <div>
                            <label className={labelClass} htmlFor="duty-mgr">Менеджер</label>
                            <select
                                id="duty-mgr"
                                value={mgr}
                                onChange={(e) => setMgr(e.target.value === '' ? '' : Number(e.target.value))}
                                className={fieldClass}
                            >
                                <option value="">Выберите менеджера</option>
                                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelClass} htmlFor="duty-date">Дата</label>
                            <input id="duty-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
                        </div>
                        <div className="w-24">
                            <label className={labelClass} htmlFor="duty-shifts">Дней</label>
                            <input id="duty-shifts" type="number" min={0} step={0.5} value={shifts}
                                onChange={(e) => setShifts(Number(e.target.value))} className={`${fieldClass} text-right tabular-nums`} />
                        </div>
                        <div className="flex items-end">
                            <button
                                onClick={add}
                                disabled={saving}
                                aria-busy={saving || undefined}
                                className="flex h-9 min-w-[124px] items-center justify-center gap-1.5 border border-blue-600 bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                {saving ? 'Добавляем…' : 'Добавить день'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Список */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                    ) : rows.length === 0 ? (
                        <div className="px-4 py-10 text-center text-sm text-slate-500">
                            Записей за период нет — оклады считаются по отпускам из модуля распределения заявок,
                            а у кого отпусков нет — за полный месяц.
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-4 py-2">Дата</th>
                                    <th className="px-4 py-2">Менеджер</th>
                                    <th className="px-4 py-2">Тип</th>
                                    <th className="px-4 py-2 text-right">Дней</th>
                                    <th className="w-10 px-4 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((d) => (
                                    <tr key={d.id} className="border-t border-slate-200 hover:bg-slate-50">
                                        <td className="px-4 py-2 tabular-nums">{String(d.work_date).slice(0, 10).split('-').reverse().join('.')}</td>
                                        <td className="px-4 py-2">{nameById(d.manager_id)}</td>
                                        <td className="px-4 py-2 text-slate-500">{KIND_LABEL[d.kind] || d.kind}</td>
                                        <td className="px-4 py-2 text-right tabular-nums">{d.shifts}</td>
                                        <td className="px-4 py-2 text-right">
                                            <button
                                                onClick={() => run(`del:${d.id}`, () => remove(d.id))}
                                                disabled={isPending(`del:${d.id}`)}
                                                aria-busy={isPending(`del:${d.id}`) || undefined}
                                                title="Удалить запись"
                                                className="text-slate-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {isPending(`del:${d.id}`) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Подвал */}
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    {Object.keys(totals).length > 0 && (
                        <div className="mb-1 text-slate-900">
                            Проставлено дней:{' '}
                            {Object.entries(totals).map(([id, n], i) => (
                                <span key={id}>{i > 0 && ' · '}<b>{nameById(Number(id))}</b> — {n}</span>
                            ))}
                        </div>
                    )}
                    Оклад считается пропорционально отработанным дням. Если по менеджеру записей здесь нет,
                    дни берутся из отпусков в модуле распределения заявок. Открытый период пересчитывается сам,
                    закрытый — нет.
                </div>
            </div>
        </div>
    );
}
