'use client';

import { useState, useEffect, useCallback } from 'react';

interface FunnelData {
    sessions: number;
    with_contacts: number;
    with_proposal: number;
    with_invoice: number;
    paid: number;
}

interface ProposalStats {
    total: number;
    sent: number;
    viewed: number;
    avg_amount: number;
}

interface InvoiceStats {
    total: number;
    sent: number;
    paid: number;
    total_revenue: number;
    avg_amount: number;
}

interface AnalyticsData {
    period: number;
    since: string;
    funnel: FunnelData;
    proposals: ProposalStats;
    invoices: InvoiceStats;
    top_utm: { source: string; count: number }[];
    top_products: { product: string; count: number }[];
    daily_chart: { date: string; sessions: number; proposals: number; paid: number }[];
}

function pct(a: number, b: number) {
    if (!b) return 0;
    return Math.round((a / b) * 100);
}

function formatMoney(n: number) {
    return n.toLocaleString('ru-RU') + ' ₽';
}

function formatDate(d: string) {
    const date = new Date(d);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

const PERIOD_OPTIONS = [
    { label: '7 дней',  value: '7' },
    { label: '30 дней', value: '30' },
    { label: '90 дней', value: '90' },
    { label: '365 дней', value: '365' },
];

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
    const w = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden flex-1">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
        </div>
    );
}

function DailyChart({ data }: { data: AnalyticsData['daily_chart'] }) {
    const maxSessions = Math.max(...data.map(d => d.sessions), 1);
    const last = data.slice(-30);

    return (
        <div className="overflow-x-auto">
            <div className="flex items-end gap-0.5 h-28 min-w-[500px]">
                {last.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative" title={`${d.date}\nЛиды: ${d.sessions}\nКП: ${d.proposals}\nОплат: ${d.paid}`}>
                        {/* paid */}
                        {d.paid > 0 && (
                            <div
                                className="w-full bg-emerald-500 rounded-sm"
                                style={{ height: `${Math.round((d.paid / maxSessions) * 80)}px` }}
                            />
                        )}
                        {/* proposals */}
                        {d.proposals > 0 && (
                            <div
                                className="w-full bg-blue-400 rounded-sm"
                                style={{ height: `${Math.round((d.proposals / maxSessions) * 80)}px` }}
                            />
                        )}
                        {/* sessions */}
                        <div
                            className="w-full bg-gray-200 rounded-sm"
                            style={{ height: `${Math.max(Math.round((d.sessions / maxSessions) * 80), 2)}px` }}
                        />
                        {/* tooltip */}
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
                            {formatDate(d.date)}: {d.sessions} лидов, {d.proposals} КП, {d.paid} оплат
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1 min-w-[500px]">
                <span>{last[0] ? formatDate(last[0].date) : ''}</span>
                <span>{last[Math.floor(last.length / 2)] ? formatDate(last[Math.floor(last.length / 2)].date) : ''}</span>
                <span>{last[last.length - 1] ? formatDate(last[last.length - 1].date) : ''}</span>
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-gray-200 inline-block rounded" />Лиды</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-blue-400 inline-block rounded" />КП</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-emerald-500 inline-block rounded" />Оплаты</span>
            </div>
        </div>
    );
}

export default function LeadCatcherAnalytics() {
    const [period, setPeriod] = useState('30');
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/lead-catcher/analytics?period=${period}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setData(await res.json());
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => { load(); }, [load]);

    const exportCSV = (type: string) => {
        window.open(`/api/lead-catcher/export?type=${type}&period=${period}`, '_blank');
    };

    return (
        <div className="space-y-6">
            {/* Шапка */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-black text-gray-900">Аналитика Ловца Лидов</h1>
                    <p className="text-xs text-gray-400 mt-0.5">
                        {data ? `c ${new Date(data.since).toLocaleDateString('ru-RU')} по сегодня` : ''}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {PERIOD_OPTIONS.map(o => (
                        <button
                            key={o.value}
                            onClick={() => setPeriod(o.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                                period === o.value
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
            )}

            {loading ? (
                <div className="flex items-center justify-center h-40 text-gray-400">Загрузка...</div>
            ) : data ? (
                <>
                    {/* Воронка */}
                    <div className="bg-white rounded-2xl border p-5">
                        <h2 className="text-sm font-bold text-gray-700 mb-4">Воронка конверсии</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            {[
                                { label: 'Все лиды',    value: data.funnel.sessions,      color: 'bg-gray-400',    key: 'sessions' },
                                { label: 'С контактом', value: data.funnel.with_contacts, color: 'bg-blue-400',    key: 'contacts' },
                                { label: 'С КП',        value: data.funnel.with_proposal, color: 'bg-violet-400',  key: 'proposal' },
                                { label: 'Со счётом',   value: data.funnel.with_invoice,  color: 'bg-amber-400',   key: 'invoice' },
                                { label: '💰 Оплачено', value: data.funnel.paid,           color: 'bg-emerald-500', key: 'paid' },
                            ].map((item, i, arr) => (
                                <div key={item.key} className="text-center bg-gray-50 rounded-xl p-3">
                                    <div className={`text-2xl font-black ${i === arr.length - 1 ? 'text-emerald-600' : 'text-gray-900'}`}>
                                        {item.value}
                                    </div>
                                    <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                                    <div className={`text-xs font-bold ${i === arr.length - 1 ? 'text-emerald-600' : 'text-gray-400'}`}>
                                        {i > 0
                                            ? `${pct(item.value, data.funnel.sessions)}% от лидов`
                                            : `за ${period} дней`}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* КП + Счета */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-white rounded-2xl border p-5">
                            <h2 className="text-sm font-bold text-gray-700 mb-4">Коммерческие предложения</h2>
                            <div className="space-y-2">
                                {[
                                    { label: 'Создано',     value: data.proposals.total },
                                    { label: 'Отправлено',  value: data.proposals.sent },
                                    { label: 'Просмотрено', value: data.proposals.viewed },
                                ].map(r => (
                                    <div key={r.label} className="flex items-center gap-3">
                                        <span className="text-xs text-gray-500 w-28 shrink-0">{r.label}</span>
                                        <MiniBar value={r.value} max={data.proposals.total} color="bg-violet-400" />
                                        <span className="text-sm font-bold text-gray-900 w-8 text-right">{r.value}</span>
                                    </div>
                                ))}
                                <div className="pt-2 border-t mt-2">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-500">Средний чек</span>
                                        <span className="font-bold text-violet-700">{formatMoney(data.proposals.avg_amount)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white rounded-2xl border p-5">
                            <h2 className="text-sm font-bold text-gray-700 mb-4">Счета на оплату</h2>
                            <div className="space-y-2">
                                {[
                                    { label: 'Создано',    value: data.invoices.total },
                                    { label: 'Отправлено', value: data.invoices.sent },
                                    { label: 'Оплачено',   value: data.invoices.paid },
                                ].map(r => (
                                    <div key={r.label} className="flex items-center gap-3">
                                        <span className="text-xs text-gray-500 w-28 shrink-0">{r.label}</span>
                                        <MiniBar value={r.value} max={Math.max(data.invoices.total, 1)} color="bg-emerald-400" />
                                        <span className="text-sm font-bold text-gray-900 w-8 text-right">{r.value}</span>
                                    </div>
                                ))}
                                <div className="pt-2 border-t mt-2 space-y-1">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-500">Выручка (оплачено)</span>
                                        <span className="font-black text-emerald-700">{formatMoney(data.invoices.total_revenue)}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-500">Средний счёт</span>
                                        <span className="font-bold text-emerald-600">{formatMoney(data.invoices.avg_amount)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* График */}
                    {data.daily_chart.length > 0 && (
                        <div className="bg-white rounded-2xl border p-5">
                            <h2 className="text-sm font-bold text-gray-700 mb-4">Динамика по дням</h2>
                            <DailyChart data={data.daily_chart} />
                        </div>
                    )}

                    {/* UTM + Товары */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {data.top_utm.length > 0 && (
                            <div className="bg-white rounded-2xl border p-5">
                                <h2 className="text-sm font-bold text-gray-700 mb-4">Топ источников (UTM)</h2>
                                <div className="space-y-2">
                                    {data.top_utm.map((u, i) => (
                                        <div key={i} className="flex items-center gap-3">
                                            <span className="text-xs text-gray-600 truncate flex-1" title={u.source}>{u.source}</span>
                                            <MiniBar value={u.count} max={data.top_utm[0].count} color="bg-blue-400" />
                                            <span className="text-sm font-bold text-gray-900 w-8 text-right">{u.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {data.top_products.length > 0 && (
                            <div className="bg-white rounded-2xl border p-5">
                                <h2 className="text-sm font-bold text-gray-700 mb-4">Топ товаров (по интересу)</h2>
                                <div className="space-y-2">
                                    {data.top_products.map((p, i) => (
                                        <div key={i} className="flex items-center gap-3">
                                            <span className="text-xs text-gray-600 truncate flex-1" title={p.product}>{p.product}</span>
                                            <MiniBar value={p.count} max={data.top_products[0].count} color="bg-amber-400" />
                                            <span className="text-sm font-bold text-gray-900 w-8 text-right">{p.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Экспорт */}
                    <div className="bg-white rounded-2xl border p-5">
                        <h2 className="text-sm font-bold text-gray-700 mb-4">Экспорт данных (CSV)</h2>
                        <div className="flex flex-wrap gap-3">
                            {[
                                { type: 'leads',     label: '📋 Лиды',   color: 'bg-gray-100 hover:bg-gray-200 text-gray-700' },
                                { type: 'proposals', label: '📄 КП',     color: 'bg-violet-50 hover:bg-violet-100 text-violet-700' },
                                { type: 'invoices',  label: '🧾 Счета',  color: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700' },
                            ].map(e => (
                                <button
                                    key={e.type}
                                    onClick={() => exportCSV(e.type)}
                                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${e.color}`}
                                >
                                    {e.label} (за {period} дней)
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-gray-400 mt-2">CSV с BOM — открывается напрямую в Excel с кириллицей</p>
                    </div>
                </>
            ) : null}
        </div>
    );
}
