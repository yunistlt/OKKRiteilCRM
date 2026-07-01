'use client';

import { useEffect, useState } from 'react';

interface Manager { id: number; name: string; }
interface Absence { id: number; manager_id: number; start_date: string; end_date: string; note: string | null; }

function fmt(d: string) {
    const [y, m, day] = d.split('-');
    return day && m && y ? `${day}.${m}.${y}` : d;
}
function todayMsk(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
}
function isActive(a: Absence): boolean {
    const t = todayMsk();
    return a.start_date <= t && t <= a.end_date;
}

export default function AbsencesSettings({ canEdit }: { canEdit: boolean }) {
    const [managers, setManagers] = useState<Manager[]>([]);
    const [absences, setAbsences] = useState<Absence[]>([]);
    const [managerId, setManagerId] = useState<number | ''>('');
    const [start, setStart] = useState(todayMsk());
    const [end, setEnd] = useState(todayMsk());
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    async function load() {
        try {
            const res = await fetch('/api/agents/katerina/absences');
            const data = await res.json();
            if (res.ok) {
                setManagers(data.managers || []);
                setAbsences(data.absences || []);
                if (managerId === '' && data.managers?.[0]) setManagerId(data.managers[0].id);
            }
        } catch { /* ignore */ }
    }
    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    async function add() {
        if (managerId === '') return;
        setBusy(true); setMsg(null);
        try {
            const res = await fetch('/api/agents/katerina/absences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ manager_id: Number(managerId), start_date: start, end_date: end }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Ошибка');
            setMsg({ kind: 'ok', text: 'Добавлено' });
            await load();
        } catch (e: any) {
            setMsg({ kind: 'err', text: e?.message || 'Ошибка' });
        } finally { setBusy(false); }
    }

    async function remove(id: number) {
        setBusy(true); setMsg(null);
        try {
            const res = await fetch(`/api/agents/katerina/absences?id=${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Ошибка');
            await load();
        } catch (e: any) {
            setMsg({ kind: 'err', text: e?.message || 'Ошибка' });
        } finally { setBusy(false); }
    }

    const nameOf = (id: number) => managers.find((m) => m.id === id)?.name || String(id);

    return (
        <section className="mt-6 border border-slate-200 bg-white p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Отпуска / отсутствия менеджеров</div>
            <p className="mt-1 text-xs text-slate-500">
                В период отсутствия менеджеру НЕ распределяются новые клиенты (уходят остальным из пула).
                Его постоянные клиенты (по истории заказов) продолжают идти к нему. Даты включительно.
            </p>

            <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                            <th className="py-2 pr-4">Менеджер</th>
                            <th className="py-2 pr-4">С</th>
                            <th className="py-2 pr-4">По</th>
                            <th className="py-2 pr-4">Статус</th>
                            {canEdit ? <th className="py-2 pr-4"></th> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {absences.map((a) => (
                            <tr key={a.id} className="border-b border-slate-50">
                                <td className="py-2 pr-4 font-bold text-slate-800">{nameOf(a.manager_id)}</td>
                                <td className="py-2 pr-4 text-slate-700">{fmt(a.start_date)}</td>
                                <td className="py-2 pr-4 text-slate-700">{fmt(a.end_date)}</td>
                                <td className="py-2 pr-4">
                                    {isActive(a)
                                        ? <span className="border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-900">в отпуске сейчас</span>
                                        : <span className="text-[11px] text-slate-400">{a.start_date > todayMsk() ? 'запланирован' : 'завершён'}</span>}
                                </td>
                                {canEdit ? (
                                    <td className="py-2 pr-4">
                                        <button onClick={() => remove(a.id)} disabled={busy}
                                            className="border border-slate-300 px-2 py-0.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Убрать</button>
                                    </td>
                                ) : null}
                            </tr>
                        ))}
                        {absences.length === 0 ? (
                            <tr><td colSpan={canEdit ? 5 : 4} className="py-4 text-sm text-slate-400">Отпусков не задано.</td></tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {canEdit ? (
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                    <label className="flex flex-col text-xs font-bold text-slate-500">
                        Менеджер
                        <select value={managerId} onChange={(e) => setManagerId(Number(e.target.value))}
                            className="mt-1 border border-slate-300 px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500">
                            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col text-xs font-bold text-slate-500">
                        С
                        <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                            className="mt-1 border border-slate-300 px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500" />
                    </label>
                    <label className="flex flex-col text-xs font-bold text-slate-500">
                        По
                        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                            className="mt-1 border border-slate-300 px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500" />
                    </label>
                    <button onClick={add} disabled={busy || managerId === ''}
                        className="border border-slate-900 bg-slate-900 px-5 py-2 text-sm font-black uppercase tracking-wider text-white hover:bg-slate-800 disabled:opacity-50">
                        {busy ? '…' : 'Добавить отпуск'}
                    </button>
                    {msg ? <span className={`text-sm font-bold ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</span> : null}
                </div>
            ) : (
                <p className="mt-3 text-xs text-slate-400">Изменять могут администратор и РОП.</p>
            )}
        </section>
    );
}
