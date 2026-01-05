'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const VIOLATION_LABELS: Record<string, string> = {
    'short_call': 'Короткий звонок',
    'missed_call': 'Пропущенный',
    'fake_qualification': 'Фейк-квалификация',
    'illegal_cancel_from_new': 'Отмена из "Нового"',
    'no_comment_on_status_change': 'Нет комментария',
    'timer_reset_attempt': 'Сброс таймера (SLA)',
    'critical_status_overdue': 'Просрочка статуса',
    'no_call_before_qualification': 'Квалификация без звонка',
    'call_impersonation': 'Имитация звонка',
    'high_call_imitation_rate': 'Высокая доля имитаций',
    'order_dragging': 'Затягивание заказа',
    'order_exit_without_result': 'Отказ без причины'
};

const SEVERITY_COLORS: Record<string, string> = {
    'high': 'bg-red-50 text-red-700 ring-red-600/20',
    'medium': 'bg-amber-50 text-amber-700 ring-amber-600/20',
    'low': 'bg-blue-50 text-blue-700 ring-blue-600/20'
};

import { Suspense } from 'react';

function ViolationsContent() {
    const searchParams = useSearchParams();
    const [violations, setViolations] = useState<any[]>([]);
    const [rules, setRules] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState<string>('all');
    const [viewMode, setViewMode] = useState<'list' | 'group'>('group');

    const from = searchParams.get('from');
    const to = searchParams.get('to');

    // ... (rest of the component logic) ...

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const url = new URL('/api/analysis/violations', window.location.origin);
                if (from) url.searchParams.set('start', from);
                if (to) url.searchParams.set('end', to);

                // Fetch rules and violations in parallel
                const [resViolations, activeRules] = await Promise.all([
                    fetch(url.toString()).then(r => r.json()),
                    getRules()
                ]);

                if (resViolations.violations) {
                    setViolations(resViolations.violations);
                }
                if (activeRules) {
                    setRules(activeRules);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [from, to]);

    // Filtered by type
    const filtered = useMemo(() => {
        return filterType === 'all'
            ? violations
            : violations.filter(v => v.violation_type === filterType);
    }, [violations, filterType]);

    // Grouping logic (Type -> Manager -> Count)
    const groupedData = useMemo(() => {
        const groups: Record<string, Record<string, { count: number, manager_id: any, details: any[] }>> = {};

        filtered.forEach(v => {
            const typeKey = v.violation_type;
            const managerKey = v.manager_name || 'Не определен';

            if (!groups[typeKey]) groups[typeKey] = {};
            if (!groups[typeKey][managerKey]) {
                groups[typeKey][managerKey] = {
                    count: 0,
                    manager_id: v.manager_id,
                    details: []
                };
            }

            groups[typeKey][managerKey].count++;
            groups[typeKey][managerKey].details.push(v);
        });

        return groups;
    }, [filtered]);

    const availableTypes = Array.from(new Set(violations.map(v => v.violation_type)));

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <div className="text-gray-500 font-medium font-sans italic">Собираем данные по нарушениям...</div>
        </div>
    );

    return (
        <div className="p-8 max-w-7xl mx-auto font-sans bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                <div>
                    <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">Нарушения Регламента</h1>
                    <p className="text-gray-500 mt-2 text-lg">Контроль качества работы с заказами и звонками</p>
                </div>

                <div className="flex items-center gap-4 bg-white p-2 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex bg-gray-50 p-1 rounded-xl">
                        <button
                            onClick={() => setViewMode('group')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'group' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Группировка
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Список
                        </button>
                    </div>

                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="bg-white border-0 text-gray-700 text-sm font-bold rounded-xl focus:ring-0 block p-2 outline-none cursor-pointer"
                    >
                        <option value="all">Все нарушения</option>
                        {rules.map(r => (
                            <option key={r.code} value={r.code}>{r.name}</option>
                        ))}
                    </select>

                    <div className="bg-blue-600 h-10 px-4 flex items-center rounded-xl shadow-lg shadow-blue-100">
                        <span className="text-white font-black text-lg">{filtered.length}</span>
                    </div>
                </div>
            </div>

            {viewMode === 'group' ? (
                <div className="grid gap-8">
                    {Object.entries(groupedData).map(([type, managers]) => (
                        <div key={type} className="bg-white rounded-3xl shadow-xl shadow-gray-200/40 border border-gray-100 overflow-hidden">
                            <div className="bg-gray-50/50 p-6 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-xl font-black text-gray-800 flex items-center gap-3">
                                    <span className="w-2 h-8 bg-blue-600 rounded-full"></span>
                                    {VIOLATION_LABELS[type] || type}
                                </h2>
                                <span className="bg-gray-200 text-gray-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-tight">
                                    {Object.values(managers).reduce((acc, curr) => acc + curr.count, 0)} нарушений
                                </span>
                            </div>
                            <div className="p-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {Object.entries(managers)
                                        .sort((a, b) => b[1].count - a[1].count)
                                        .map(([manager, data]) => (
                                            <Link
                                                href={data.manager_id ? `/analytics/managers/${data.manager_id}` : '#'}
                                                key={manager}
                                                className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-blue-400 hover:bg-blue-50/10 transition-all group"
                                            >
                                                <div>
                                                    <div className="text-sm font-black text-gray-800 group-hover:text-blue-600 transition-colors uppercase tracking-tight flex items-center gap-2">
                                                        {manager}
                                                        {data.manager_id && <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>}
                                                    </div>
                                                    <div className="text-xs text-gray-400 mt-1 font-medium italic">Статистика менеджера</div>
                                                </div>
                                                <div className="bg-white px-3 py-2 rounded-xl border border-gray-200 font-black text-blue-600 shadow-sm min-w-[3rem] text-center">
                                                    {data.count}
                                                </div>
                                            </Link>
                                        ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-400 text-xs uppercase tracking-widest font-bold">
                                    <th className="p-6">Дата и Менеджер</th>
                                    <th className="p-6">Тип нарушения</th>
                                    <th className="p-6">Детали</th>
                                    <th className="p-6 text-right">Заказ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filtered.map((v, idx) => (
                                    <tr key={v.call_id || idx} className="hover:bg-blue-50/20 transition-all duration-200">
                                        <td className="p-6">
                                            <div className="font-bold text-gray-900 tabular-nums">
                                                {new Date(v.created_at).toLocaleString('ru-RU', {
                                                    day: '2-digit',
                                                    month: '2-digit',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </div>
                                            <Link
                                                href={v.manager_id ? `/analytics/managers/${v.manager_id}` : '#'}
                                                className={`text-xs font-black mt-1 uppercase tracking-tight inline-block ${v.manager_id ? 'text-blue-600 hover:text-blue-800 hover:underline' : 'text-gray-300'}`}
                                            >
                                                {v.manager_name || 'Система'}
                                            </Link>
                                        </td>
                                        <td className="p-6">
                                            <span className={`inline-flex items-center px-4 py-1 rounded-full text-[0.65rem] font-black uppercase tracking-widest ring-1 ring-inset ${SEVERITY_COLORS[v.severity] || SEVERITY_COLORS.low
                                                }`}>
                                                {VIOLATION_LABELS[v.violation_type] || v.violation_type}
                                            </span>
                                        </td>
                                        <td className="p-6 text-gray-600 text-sm leading-relaxed max-w-md font-medium">
                                            {v.details}
                                        </td>
                                        <td className="p-6 text-right">
                                            {v.order_id ? (
                                                <a
                                                    href={`https://zmktlt.retailcrm.ru/orders/${v.order_id}/edit`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-gray-700 rounded-2xl hover:bg-blue-600 hover:text-white hover:border-blue-600 hover:shadow-lg hover:shadow-blue-200 transition-all duration-300 font-black text-xs border-2 border-gray-100"
                                                >
                                                    # {v.order_id}
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                    </svg>
                                                </a>
                                            ) : (
                                                <span className="text-gray-300 italic text-xs font-bold uppercase tracking-widest">Без заказа</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {filtered.length === 0 && (
                <div className="p-32 text-center bg-white rounded-3xl border-2 border-dashed border-gray-100 mt-8">
                    <div className="flex flex-col items-center">
                        <div className="bg-blue-50 p-6 rounded-full mb-6">
                            <svg className="w-16 h-16 text-blue-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tight">Идеальная работа!</h3>
                        <p className="text-gray-400 mt-2 max-w-sm mx-auto text-sm font-medium">
                            По выбранным критериям нарушений не обнаружено. Продолжайте в том же духе.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function ViolationsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>}>
            <ViolationsContent />
        </Suspense>
    );
}
