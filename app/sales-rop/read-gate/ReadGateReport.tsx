'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * «Чтение разборов» — кто открыл, когда подтвердил, сколько читал.
 *
 * Время чтения не идёт в баллы менеджера и не влияет на зарплату: это повод
 * для разговора, а не метрика. Поэтому здесь нет ни рейтинга, ни оценок —
 * только факты и два сигнала, которые стоит заметить.
 */
type Row = {
    name: string;
    openedAt: string | null;
    confirmedAt: string | null;
    readSeconds: number;
    requiredSeconds: number;
    scrolledToEnd: boolean;
    deferredAt: string | null;
    deferReason: string | null;
    formal: boolean;
    formalDays: number;
    deferDays: number;
};

const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';

export default function ReadGateReport() {
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/read-gate/report?date=${date}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось загрузить');
            setRows(json.rows ?? []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => { void load(); }, [load]);

    return (
        <div className="p-4">
            <div className="mb-3 flex items-center gap-3">
                <h1 className="text-xl font-black">Чтение разборов</h1>
                <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-9 border border-input bg-background px-2 text-sm"
                />
            </div>

            {error && <div className="mb-3 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {loading ? (
                <div className="p-6 text-sm text-gray-500">Загружаю…</div>
            ) : rows.length === 0 ? (
                <div className="border border-dashed p-8 text-center text-sm text-gray-500">
                    За эту дату разборы никто не открывал.
                </div>
            ) : (
                <div className="border bg-white">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                                <th className="px-3 py-2 font-semibold">Менеджер</th>
                                <th className="px-3 py-2 font-semibold">Открыл</th>
                                <th className="px-3 py-2 font-semibold">Подтвердил</th>
                                <th className="px-3 py-2 font-semibold">Читал</th>
                                <th className="px-3 py-2 font-semibold">Отсрочка</th>
                                <th className="px-3 py-2 font-semibold">На что посмотреть</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr key={i} className="border-b last:border-b-0 align-top">
                                    <td className="px-3 py-2 font-semibold">{r.name}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">{time(r.openedAt)}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        {r.confirmedAt
                                            ? time(r.confirmedAt)
                                            : <span className="text-amber-700">не прочитан</span>}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                                        {r.readSeconds} сек
                                        <span className="ml-1 text-xs text-gray-500">из {r.requiredSeconds}</span>
                                    </td>
                                    <td className="px-3 py-2">
                                        {r.deferredAt ? `${time(r.deferredAt)} · ${r.deferReason ?? ''}` : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-xs">
                                        {r.formal && r.formalDays >= 3 && (
                                            <div className="text-amber-700">
                                                Третий день подтверждает на самом пороге — похоже, пролистывает.
                                            </div>
                                        )}
                                        {r.deferDays >= 3 && (
                                            <div className="text-amber-700">Откладывает третий день подряд.</div>
                                        )}
                                        {!r.confirmedAt && new Date().getHours() >= 12 && (
                                            <div className="text-amber-700">Не прочитан к полудню.</div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="mt-3 text-xs text-gray-500">
                Время чтения — не оценка работы. В баллы менеджера оно не идёт и на зарплату не влияет.
            </p>
        </div>
    );
}
