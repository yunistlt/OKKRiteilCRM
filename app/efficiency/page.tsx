'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PriorityDashboard } from '../components/PriorityDashboard';

interface EfficiencyReport {
    manager_id: number;
    manager_name: string;
    total_minutes: number;
    processed_orders: number;
}

function EfficiencyContent() {
    const searchParams = useSearchParams();
    const [report, setReport] = useState<EfficiencyReport[]>([]);
    const [loading, setLoading] = useState(false);

    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const fetchEfficiency = async () => {
        setLoading(true);
        try {
            let start = from;
            let end = to;
            if (!start || !end) {
                const d = new Date();
                end = d.toISOString().split('T')[0];
                d.setDate(d.getDate() - 30);
                start = d.toISOString().split('T')[0];
            }

            const res = await fetch(`/api/analysis/efficiency?from=${start}T00:00:00&to=${end}T23:59:59`);
            const json = await res.json();
            if (json.success) {
                setReport(json.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEfficiency();
    }, [from, to]);

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto font-sans bg-gray-50 min-h-screen">
            <div className="flex justify-between items-center mb-6 md:mb-10">
                <div>
                    <h1 className="text-2xl md:text-4xl font-black text-gray-900 tracking-tight">Эффективность Менеджеров</h1>
                    <p className="text-gray-500 mt-1 md:mt-2 text-sm md:text-lg">Анализ рабочего времени и производительности</p>
                </div>
            </div>

            <div className="mb-12">
                <PriorityDashboard />
            </div>

            <div className="mt-12">
                <h2 className="text-xl md:text-2xl font-black text-gray-900 mb-4 px-4 md:px-0">Детальный отчет</h2>

                {loading ? (
                    <div className="flex flex-col items-center py-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                        <div className="text-gray-400 font-bold uppercase text-[10px] tracking-widest animate-pulse">Пересчитываем эффективность...</div>
                    </div>
                ) : report.length === 0 ? (
                    <div className="p-10 md:p-20 text-center bg-white rounded-2xl md:rounded-3xl border-2 border-dashed border-gray-100">
                        <h3 className="text-lg md:text-xl font-black text-gray-900">Данные не найдены</h3>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[700px] md:min-w-0">
                                <thead>
                                    <tr className="bg-gray-50/50 text-gray-400 text-[9px] md:text-[10px] uppercase tracking-[0.2em] font-black border-b border-gray-100">
                                        <th className="p-4 md:p-6">Менеджер</th>
                                        <th className="p-4 md:p-6">Время в работе (Σ)</th>
                                        <th className="p-4 md:p-6">Заказов обработано</th>
                                        <th className="p-4 md:p-6">Среднее время / заказ</th>
                                        <th className="p-4 md:p-6 text-right">Действие</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {report.map((row) => (
                                        <tr key={row.manager_id} className="hover:bg-blue-50/20 transition-all duration-200 group">
                                            <td className="p-4 md:p-6">
                                                <Link
                                                    href={`/analytics/managers/${row.manager_id}`}
                                                    className="text-base md:text-lg font-black text-gray-900 hover:text-blue-600 transition-colors uppercase tracking-tight"
                                                >
                                                    {row.manager_name}
                                                </Link>
                                            </td>
                                            <td className="p-4 md:p-6">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg md:text-xl font-black text-gray-900 tabular-nums">
                                                        {Math.floor(row.total_minutes / 60)}ч {row.total_minutes % 60}м
                                                    </span>
                                                    <span className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase hidden md:inline">({row.total_minutes} мин)</span>
                                                </div>
                                            </td>
                                            <td className="p-4 md:p-6 text-gray-600 font-bold tabular-nums text-sm md:text-base">
                                                {row.processed_orders}
                                            </td>
                                            <td className="p-4 md:p-6">
                                                <div className="inline-flex items-center px-2 py-0.5 md:px-3 md:py-1 bg-green-50 text-green-700 rounded-lg text-[10px] md:text-xs font-black uppercase tracking-wider">
                                                    {row.processed_orders > 0
                                                        ? Math.round(row.total_minutes / row.processed_orders)
                                                        : 0} мин
                                                </div>
                                            </td>
                                            <td className="p-4 md:p-6 text-right">
                                                <Link
                                                    href={`/analytics/managers/${row.manager_id}`}
                                                    className="px-4 py-1.5 md:px-6 md:py-2 bg-gray-50 text-gray-900 rounded-lg md:rounded-xl hover:bg-gray-900 hover:text-white transition-all font-black text-[9px] md:text-[10px] uppercase tracking-wider border border-gray-100"
                                                >
                                                    Профиль
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function EfficiencyDashboard() {
    return (
        <Suspense fallback={<div className="flex justify-center p-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>}>
            <EfficiencyContent />
        </Suspense>
    );
}
