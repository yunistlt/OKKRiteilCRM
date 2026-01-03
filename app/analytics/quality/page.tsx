'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface ManagerStats {
    id: string;
    name: string;
    d1: { count: number; duration: number };
    d7: { count: number; duration: number };
    d30: { count: number; duration: number };
}

function QualityContent() {
    const [data, setData] = useState<ManagerStats[]>([]);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const searchParams = useSearchParams();
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';

    const fetchData = async () => {
        try {
            const res = await fetch('/api/analysis/quality');
            const json = await res.json();
            if (json.data) setData(json.data);
            if (json.lastUpdated) setLastUpdated(json.lastUpdated);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            const res = await fetch('/api/analysis/quality/refresh', { method: 'POST' });
            const json = await res.json();
            if (json.success) {
                await fetchData();
            }
        } catch (e) {
            console.error(e);
        } finally {
            setRefreshing(false);
        }
    };

    const formatDuration = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        if (h > 0) return `${h}ч ${m}м`;
        if (m > 0) return `${m}м ${s}с`;
        return `${s}с`;
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <div className="text-gray-500 font-bold font-sans tracking-tight">Загружаем аналитику диалогов...</div>
        </div>
    );

    return (
        <div className="p-8 max-w-7xl mx-auto font-sans min-h-screen bg-gray-50">
            {/* Header */}
            <div className="mb-10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href={`/analytics${suffix}`} className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100 text-gray-400 hover:text-blue-600 transition-all">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                    </Link>
                    <div>
                        <h1 className="text-4xl font-black text-gray-900 tracking-tight">Качество Звонков</h1>
                        <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mt-1">
                            Отчет по диалогам (без автоответчиков)
                            {lastUpdated && (
                                <span className="ml-2 text-blue-400 font-black italic">
                                    • Обновлено: {new Date(lastUpdated).toLocaleTimeString('ru-RU')}
                                </span>
                            )}
                            <Link href="/settings/status" className="ml-4 text-gray-300 hover:text-blue-500 transition-colors uppercase italic underline decoration-dotted">
                                Статус систем →
                            </Link>
                        </p>
                    </div>
                </div>

                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={`flex items-center gap-2 px-8 py-4 bg-white border border-gray-100 rounded-3xl text-[11px] font-black uppercase tracking-widest transition-all shadow-xl shadow-gray-200/50 hover:bg-gray-50 active:scale-95 disabled:opacity-50 ${refreshing ? 'animate-pulse' : ''}`}
                >
                    <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {refreshing ? 'Обновляем базy...' : 'Обновить данные'}
                </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-[40px] shadow-2xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50 text-gray-400 text-[10px] uppercase tracking-[0.2em] font-black border-b border-gray-100">
                                <th className="p-8 sticky left-0 bg-gray-50/50 z-10">Менеджер</th>
                                <th className="p-8 text-center bg-blue-50/20">Сегодня (24ч)</th>
                                <th className="p-8 text-center bg-indigo-50/20 border-l border-gray-100">Неделя (7дн)</th>
                                <th className="p-8 text-center bg-violet-50/20 border-l border-gray-100">Месяц (30дн)</th>
                                <th className="p-8 text-right">Профиль</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {data.map((m) => (
                                <tr key={m.id} className="hover:bg-gray-50/50 transition-colors group">
                                    <td className="p-8 font-black text-gray-900 sticky left-0 bg-white group-hover:bg-gray-50/50 z-10">
                                        {m.name}
                                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">ID {m.id}</div>
                                    </td>

                                    {/* 1 Day */}
                                    <td className="p-8 text-center">
                                        <div className="text-xl font-black text-blue-600">{m.d1.count}</div>
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{formatDuration(m.d1.duration)}</div>
                                    </td>

                                    {/* 7 Days */}
                                    <td className="p-8 text-center border-l border-gray-50">
                                        <div className="text-xl font-black text-indigo-600">{m.d7.count}</div>
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{formatDuration(m.d7.duration)}</div>
                                    </td>

                                    {/* 30 Days */}
                                    <td className="p-8 text-center border-l border-gray-50">
                                        <div className="text-xl font-black text-violet-600">{m.d30.count}</div>
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{formatDuration(m.d30.duration)}</div>
                                    </td>

                                    <td className="p-8 text-right">
                                        <Link
                                            href={`/analytics/managers/${m.id}${suffix}`}
                                            className="inline-flex items-center gap-2 px-6 py-2 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all shadow-lg shadow-gray-200"
                                        >
                                            Детали
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {data.length === 0 && (
                        <div className="p-32 text-center bg-gray-50/10">
                            <p className="text-gray-400 font-black uppercase tracking-widest text-xs">Нет данных по диалогам для выбранных менеджеров</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function QualityPage() {
    return (
        <Suspense fallback={<div>Загрузка...</div>}>
            <QualityContent />
        </Suspense>
    );
}
