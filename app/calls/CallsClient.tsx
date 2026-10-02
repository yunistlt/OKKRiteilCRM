'use client';

// Все звонки компании: кто звонил, кому, по какому заказу, с записью и расшифровкой.
import { useCallback, useEffect, useState } from 'react';
import OrderNumberLink from '@/components/ui/OrderNumberLink';

type Call = {
    id: number;
    date: string | null;
    direction: string;
    phone: string | null;
    managerName: string | null;
    orderNumber: string | null;
    missed: boolean;
    durationSec: number;
    recordingUrl: string | null;
    hasTranscript: boolean;
    transcript: string | null;
};

const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const formatDuration = (sec: number) => {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

export default function CallsClient() {
    const [calls, setCalls] = useState<Call[]>([]);
    const [direction, setDirection] = useState('all');
    const [missed, setMissed] = useState(false);
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openId, setOpenId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ direction, limit: '200' });
            if (missed) params.set('missed', '1');
            if (query) params.set('search', query);
            const res = await fetch(`/api/calls/list?${params.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось получить звонки');
            setCalls(data.calls || []);
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [direction, missed, query]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="p-6">
            <div className="mb-4">
                <h1 className="text-xl font-semibold text-gray-900">Звонки</h1>
                <p className="mt-1 text-sm text-gray-500">
                    Разговоры отдела продаж: кто звонил, по какому заказу, с записью и расшифровкой.
                    Привязка к заказу — из RetailCRM.
                </p>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
                {[
                    { code: 'all', label: 'Все' },
                    { code: 'in', label: 'Входящие' },
                    { code: 'out', label: 'Исходящие' },
                ].map((d) => (
                    <button
                        key={d.code}
                        type="button"
                        onClick={() => setDirection(d.code)}
                        className={`px-3 py-1.5 text-sm font-semibold ${
                            direction === d.code ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
                        }`}
                    >
                        {d.label}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => setMissed((v) => !v)}
                    className={`px-3 py-1.5 text-sm font-semibold ${
                        missed ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
                    }`}
                >
                    Только без ответа
                </button>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        setQuery(search.trim());
                    }}
                    className="flex items-center gap-2"
                >
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Телефон, заказ или менеджер"
                        className="w-60 border border-gray-200 px-3 py-1.5 text-sm"
                    />
                    <button type="submit" className="border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700">
                        Найти
                    </button>
                </form>
            </div>

            {error && <p className="mb-3 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {loading && <p className="text-sm text-gray-500">Загружаю…</p>}
            {!loading && calls.length === 0 && <p className="bg-white px-4 py-6 text-sm text-gray-500">Звонков не найдено.</p>}

            <div className="overflow-x-auto border border-gray-200 bg-white">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-widest text-gray-500">
                            <th className="px-3 py-2">Когда</th>
                            <th className="px-3 py-2">Направление</th>
                            <th className="px-3 py-2">Телефон</th>
                            <th className="px-3 py-2">Менеджер</th>
                            <th className="px-3 py-2">Заказ</th>
                            <th className="px-3 py-2">Длительность</th>
                            <th className="px-3 py-2">Запись</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {calls.map((call) => (
                            <>
                                <tr key={call.id} className="align-top">
                                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{formatDate(call.date)}</td>
                                    <td className="px-3 py-2">
                                        <span className={call.direction === 'Входящий' ? 'text-green-700' : 'text-blue-700'}>
                                            {call.direction}
                                        </span>
                                        {call.missed && <span className="ml-2 text-red-700">без ответа</span>}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-gray-800">{call.phone || '—'}</td>
                                    <td className="px-3 py-2 text-gray-700">{call.managerName || '—'}</td>
                                    <td className="px-3 py-2"><OrderNumberLink number={call.orderNumber} /></td>
                                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{formatDuration(call.durationSec)}</td>
                                    <td className="whitespace-nowrap px-3 py-2">
                                        {call.recordingUrl ? (
                                            <a href={call.recordingUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                                                слушать
                                            </a>
                                        ) : (
                                            <span className="text-gray-400">нет</span>
                                        )}
                                        {call.hasTranscript && (
                                            <button
                                                type="button"
                                                onClick={() => setOpenId(openId === call.id ? null : call.id)}
                                                className="ml-3 font-semibold text-blue-700"
                                            >
                                                расшифровка
                                            </button>
                                        )}
                                    </td>
                                </tr>
                                {openId === call.id && call.transcript && (
                                    <tr key={`${call.id}-text`}>
                                        <td colSpan={7} className="bg-gray-50 px-3 py-3">
                                            <p className="whitespace-pre-line text-sm text-gray-800">{call.transcript}</p>
                                        </td>
                                    </tr>
                                )}
                            </>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
