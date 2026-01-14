'use client';

import { getRules } from '@/app/actions/rules';

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
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState<string>('all');
    const [filterManager, setFilterManager] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'group'>('group');

    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const getRuleName = (code: string) => {
        const rule = rules.find(r => r.code === code);
        return rule?.name || VIOLATION_LABELS[code] || code;
    };

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const url = new URL('/api/analysis/violations', window.location.origin);
                if (from) url.searchParams.set('start', from);
                if (to) url.searchParams.set('end', to);

                // Fetch rules and violations in parallel
                const [resViolations, activeRules] = await Promise.all([
                    fetch(url.toString()).then(r => r.json()),
                    getRules()
                ]);

                if (resViolations.error) {
                    throw new Error(resViolations.error);
                }

                if (resViolations.violations) {
                    setViolations(resViolations.violations);
                }
                if (activeRules) {
                    setRules(activeRules);
                }
            } catch (e: any) {
                console.error(e);
                setError(e.message || 'Unknown error occurred');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [from, to]);

    // Filtered by type and manager
    const filtered = useMemo(() => {
        let result = violations;
        if (filterType !== 'all') {
            result = result.filter(v => v.violation_type === filterType);
        }
        if (filterManager) {
            result = result.filter(v => (v.manager_name || 'Не определен') === filterManager);
        }
        return result;
    }, [violations, filterType, filterManager]);

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

    if (error) return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg">
                <h3 className="font-bold">Ошибка загрузки данных</h3>
                <p className="font-mono text-sm mt-2">{error}</p>
            </div>
        </div>
    );

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto font-sans bg-gray-50 min-h-screen">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8 md:mb-10">
                <div>
                    <h1 className="text-2xl md:text-3xl lg:text-4xl font-extrabold text-gray-900 tracking-tight leading-tight">Нарушения Регламента</h1>
                    <p className="text-gray-500 mt-1 md:mt-2 text-sm md:text-lg">Контроль качества работы с заказами</p>
                </div>

                <div className="w-full lg:w-auto flex flex-col sm:flex-row items-center gap-3 md:gap-4 bg-white p-3 md:p-2 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100">
                    {filterManager && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest border border-blue-100">
                            👤 {filterManager}
                            <button onClick={() => setFilterManager(null)} className="ml-1 hover:text-red-500">✕</button>
                        </div>
                    )}

                    <div className="w-full sm:w-auto flex bg-gray-50 p-1 rounded-xl shrink-0">
                        <button
                            onClick={() => setViewMode('group')}
                            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] md:text-sm font-black uppercase tracking-widest transition-all ${viewMode === 'group' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Группы
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] md:text-sm font-black uppercase tracking-widest transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Список
                        </button>
                    </div>

                    <select
                        value={filterType}
                        onChange={(e) => {
                            setFilterType(e.target.value);
                            setFilterManager(null); // Reset manager filter when rule changes manually
                        }}
                        className="w-full sm:w-auto bg-gray-50 md:bg-white border-0 text-gray-700 text-[10px] md:text-sm font-black uppercase tracking-widest rounded-xl focus:ring-0 block p-2 md:p-3 outline-none cursor-pointer"
                    >
                        <option value="all">Все нарушения</option>
                        {rules.map(r => (
                            <option key={r.code} value={r.code}>{r.name}</option>
                        ))}
                    </select>

                    <div className="hidden sm:flex bg-blue-600 h-10 px-4 items-center rounded-xl shadow-lg shadow-blue-100 shrink-0">
                        <span className="text-white font-black text-lg">{filtered.length}</span>
                    </div>

                    {viewMode === 'list' && (
                        <button
                            onClick={() => {
                                setViewMode('group');
                                setFilterType('all');
                                setFilterManager(null);
                            }}
                            className="text-[10px] md:text-sm font-black uppercase tracking-widest text-blue-600 hover:text-blue-800 px-4 py-2 bg-blue-50 rounded-xl border border-blue-100 transition-all"
                        >
                            Сбросить и назад
                        </button>
                    )}
                </div>
            </div>

            {viewMode === 'group' ? (
                <div className="grid gap-6 md:gap-8">
                    {Object.entries(groupedData).map(([type, managers]) => (
                        <div key={type} className="bg-white rounded-3xl shadow-xl shadow-gray-200/40 border border-gray-100 overflow-hidden">
                            <div
                                onClick={() => {
                                    setFilterType(type);
                                    setFilterManager(null);
                                    setViewMode('list');
                                }}
                                className="bg-gray-50/50 p-4 md:p-6 border-b border-gray-100 flex justify-between items-center gap-4 cursor-pointer hover:bg-gray-100 transition-colors group"
                            >
                                <h2 className="text-lg md:text-xl font-black text-gray-800 flex items-center gap-3 leading-tight group-hover:text-blue-600 transition-colors">
                                    <span className="w-1.5 h-6 md:h-8 bg-blue-600 rounded-full shrink-0"></span>
                                    {getRuleName(type)}
                                </h2>
                                <span className="bg-gray-200 text-gray-600 px-3 py-1 rounded-full text-[9px] md:text-xs font-black uppercase tracking-widest shrink-0">
                                    {Object.values(managers).reduce((acc, curr) => acc + curr.count, 0)} шт
                                </span>
                            </div>
                            <div className="p-4 md:p-6">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                                    {Object.entries(managers)
                                        .sort((a, b) => b[1].count - a[1].count)
                                        .map(([manager, data]) => (
                                            <div
                                                key={manager}
                                                onClick={() => {
                                                    setFilterType(type);
                                                    setFilterManager(manager);
                                                    setViewMode('list');
                                                }}
                                                className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-blue-400 hover:bg-blue-50/10 transition-all group cursor-pointer"
                                            >
                                                <div className="min-w-0">
                                                    <div className="text-[10px] md:text-sm font-black text-gray-800 group-hover:text-blue-600 transition-colors uppercase tracking-widest flex items-center gap-2 truncate whitespace-nowrap">
                                                        {manager}
                                                        <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                                                    </div>
                                                    <div className="text-[8px] md:text-[10px] text-gray-400 mt-1 font-bold uppercase tracking-widest truncate">Показать список</div>
                                                </div>
                                                <div className="bg-white ml-3 px-3 py-2 rounded-xl border border-gray-200 font-black text-blue-600 shadow-sm min-w-[2.5rem] md:min-w-[3rem] text-center text-xs md:text-sm shrink-0">
                                                    {data.count}
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead>
                                <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-400 text-[10px] md:text-xs uppercase tracking-widest font-black">
                                    <th className="p-4 md:p-6">Дата и Менеджер</th>
                                    <th className="p-4 md:p-6">Тип нарушения</th>
                                    <th className="p-4 md:p-6">Детали</th>
                                    <th className="p-4 md:p-6 text-right">Заказ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filtered.map((v, idx) => (
                                    <tr key={v.call_id || idx} className="hover:bg-blue-50/20 transition-all duration-200">
                                        <td className="p-4 md:p-6">
                                            <div className="font-bold text-gray-900 tabular-nums text-xs md:text-sm">
                                                {new Date(v.created_at).toLocaleString('ru-RU', {
                                                    day: '2-digit',
                                                    month: '2-digit',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </div>
                                            <Link
                                                href={v.manager_id ? `/analytics/managers/${v.manager_id}` : '#'}
                                                className={`text-[9px] md:text-xs font-black mt-1 uppercase tracking-widest inline-block ${v.manager_id ? 'text-blue-600 hover:text-blue-800' : 'text-gray-300'}`}
                                            >
                                                {v.manager_name || 'Система'}
                                            </Link>
                                        </td>
                                        <td className="p-4 md:p-6">
                                            <span className={`inline-flex items-center px-3 md:px-4 py-1 rounded-full text-[8px] md:text-[9px] font-black uppercase tracking-widest ring-1 ring-inset ${SEVERITY_COLORS[v.severity] || SEVERITY_COLORS.low
                                                }`}>
                                                {getRuleName(v.violation_type)}
                                            </span>
                                        </td>
                                        <td className="p-4 md:p-6 text-gray-600 text-xs md:text-sm leading-relaxed max-w-xs md:max-w-md font-medium">
                                            {v.details}
                                        </td>
                                        <td className="p-4 md:p-6 text-right">
                                            {v.order_id ? (
                                                <div className="flex flex-col items-end gap-1">
                                                    <div className="flex items-center gap-2">
                                                        {v.order_sum && (
                                                            <span className="text-gray-900 font-bold text-xs md:text-sm">
                                                                {v.order_sum.toLocaleString('ru-RU')} ₽
                                                            </span>
                                                        )}
                                                        <a
                                                            href={`https://zmktlt.retailcrm.ru/orders/${v.order_id}/edit`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-white text-gray-700 rounded-lg hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all duration-300 font-black text-[10px] md:text-xs border border-gray-200"
                                                        >
                                                            #{v.order_number || v.order_id}
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                            </svg>
                                                        </a>
                                                    </div>
                                                    {v.order_status && (
                                                        <span
                                                            className="inline-block px-2 py-0.5 text-[9px] rounded font-mono uppercase tracking-wide border border-transparent shadow-sm"
                                                            style={{
                                                                backgroundColor: v.order_status_color || '#f3f4f6',
                                                                color: v.order_status_color ? '#ffffff' : '#6b7280',
                                                                borderColor: v.order_status_color ? 'transparent' : '#e5e7eb',
                                                                textShadow: v.order_status_color ? '0 1px 1px rgba(0,0,0,0.1)' : 'none'
                                                            }}
                                                        >
                                                            {v.order_status}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-gray-300 italic text-[9px] md:text-xs font-black uppercase tracking-widest">Нет №</span>
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
                <div className="p-16 md:p-32 text-center bg-white rounded-3xl border-2 border-dashed border-gray-100 mt-8">
                    <div className="flex flex-col items-center">
                        <div className="bg-blue-50 p-6 rounded-full mb-6">
                            <svg className="w-12 h-12 md:w-16 md:h-16 text-blue-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <h3 className="text-xl md:text-2xl font-black text-gray-900 uppercase tracking-tight">Нарушений нет</h3>
                        <p className="text-gray-400 mt-2 max-w-sm mx-auto text-xs md:text-sm font-medium">
                            По выбранным критериям нарушений не обнаружено.
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
