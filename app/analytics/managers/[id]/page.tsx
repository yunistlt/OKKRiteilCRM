'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

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

const PRIORITY_STYLES: Record<string, string> = {
    'red': 'bg-red-100 text-red-700 ring-red-600/20',
    'yellow': 'bg-amber-100 text-amber-700 ring-amber-600/20',
    'green': 'bg-green-100 text-green-700 ring-green-600/20',
    'black': 'bg-gray-100 text-gray-700 ring-gray-600/20'
};

const PRIORITY_ICON_BG: Record<string, string> = {
    'red': 'bg-red-50 text-red-600',
    'yellow': 'bg-amber-50 text-amber-600',
    'green': 'bg-green-50 text-green-600',
    'black': 'bg-gray-50 text-gray-400'
};

const STATUS_COLORS: Record<string, string> = {
    'new': 'bg-blue-100 text-blue-700',
    'send-to-delivery': 'bg-purple-100 text-purple-700',
    'delivering': 'bg-indigo-100 text-indigo-700',
    'complete': 'bg-green-100 text-green-700',
    'cancel-other': 'bg-red-100 text-red-700',
    'rosten': 'bg-amber-100 text-amber-700'
};

function getStatusColor(code: string): string {
    if (!code) return 'bg-gray-100 text-gray-600';
    if (code.includes('cancel')) return 'bg-red-50 text-red-700';
    if (code.includes('complete')) return 'bg-green-50 text-green-700';
    if (code.includes('new')) return 'bg-blue-50 text-blue-700';
    return 'bg-gray-50 text-gray-600';
}

export default function ManagerProfilePage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'violations' | 'calls'>('violations');
    const [callFilter, setCallFilter] = useState<'all' | 'real' | 'am'>('all');
    const [isGroupedByOrder, setIsGroupedByOrder] = useState(false);

    // New Filter States
    const [filterDateStart, setFilterDateStart] = useState('');
    const [filterDateEnd, setFilterDateEnd] = useState('');
    const [filterOrderNumber, setFilterOrderNumber] = useState('');
    const [filterDurationMin, setFilterDurationMin] = useState('');
    const [filterDurationMax, setFilterDurationMax] = useState('');

    const from = searchParams.get('from');
    const to = searchParams.get('to');

    // ... (useEffect remains same) ...

    const { manager, stats, violations, calls } = data || { manager: {}, stats: {}, violations: [], calls: [] };

    const filteredCalls = (calls || []).filter((c: any) => {
        // 1. Basic Type Filter
        if (callFilter === 'real' && c.is_answering_machine !== false) return false;
        if (callFilter === 'am' && c.is_answering_machine !== true) return false;

        // 2. Date Filter
        if (filterDateStart) {
            const callDate = new Date(c.timestamp);
            const start = new Date(filterDateStart);
            start.setHours(0, 0, 0, 0);
            if (callDate < start) return false;
        }
        if (filterDateEnd) {
            const callDate = new Date(c.timestamp);
            const end = new Date(filterDateEnd);
            end.setHours(23, 59, 59, 999);
            if (callDate > end) return false;
        }

        // 3. Duration Filter
        if (filterDurationMin && c.duration < Number(filterDurationMin)) return false;
        if (filterDurationMax && c.duration > Number(filterDurationMax)) return false;

        // 4. Order Number Filter
        if (filterOrderNumber) {
            const orderNum = c.call_order_matches?.[0]?.orders?.number;
            if (!orderNum || !String(orderNum).includes(filterOrderNumber)) return false;
        }

        return true;
    });

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto font-sans min-h-screen bg-gray-50 uppercase-none">
            {/* Header */}
            <div className="mb-6 md:mb-10 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <button onClick={() => router.back()} className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100 text-gray-400 hover:text-blue-600 transition-all shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div>
                    <h1 className="text-2xl md:text-3xl lg:text-4xl font-black text-gray-900 tracking-tight leading-tight">{manager.first_name} {manager.last_name}</h1>
                    <p className="text-gray-400 font-bold uppercase text-[10px] md:text-xs tracking-widest mt-1">Профиль Менеджера • ID {manager.id}</p>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-8 md:mb-12">
                <div className="bg-white p-4 md:p-8 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100">
                    <div className="text-gray-400 text-[10px] md:text-xs font-black uppercase tracking-widest mb-2">Звонки</div>
                    <div className="text-2xl md:text-4xl font-black text-gray-900 tabular-nums">{stats.total_calls}</div>
                </div>
                <div className="bg-white p-4 md:p-8 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100">
                    <div className="text-gray-400 text-[10px] md:text-xs font-black uppercase tracking-widest mb-2">Нарушения</div>
                    <div className="text-2xl md:text-4xl font-black text-red-600 tabular-nums">{stats.total_violations}</div>
                </div>
                <div className="bg-white p-4 md:p-8 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 col-span-2 relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="text-gray-400 text-[10px] md:text-xs font-black uppercase tracking-widest mb-2">Эффективность</div>
                        <div className="text-2xl md:text-4xl font-black text-blue-600 tabular-nums">{stats.efficiency_percent}%</div>
                        <div className="mt-1 text-[8px] md:text-xs text-gray-400 font-bold uppercase tracking-wider">~{stats.work_time_minutes} мин активности</div>
                    </div>
                </div>
            </div>

            {/* Tabs Control */}
            <div className="flex gap-3 mb-6 md:mb-8 overflow-x-auto pb-2 scrollbar-hide shrink-0">
                <button
                    onClick={() => setActiveTab('violations')}
                    className={`px-6 md:px-8 py-3 md:py-4 rounded-2xl md:rounded-3xl font-black uppercase tracking-widest text-[10px] md:text-[11px] transition-all whitespace-nowrap active:scale-95 ${activeTab === 'violations'
                        ? 'bg-red-600 text-white shadow-xl shadow-red-200 -translate-y-0.5'
                        : 'bg-white text-gray-400 border border-gray-100 hover:bg-gray-50'
                        }`}
                >
                    🚩 Нарушения ({violations.length})
                </button>
                <button
                    onClick={() => setActiveTab('calls')}
                    className={`px-6 md:px-8 py-3 md:py-4 rounded-2xl md:rounded-3xl font-black uppercase tracking-widest text-[10px] md:text-[11px] transition-all whitespace-nowrap active:scale-95 ${activeTab === 'calls'
                        ? 'bg-blue-600 text-white shadow-xl shadow-blue-200 -translate-y-0.5'
                        : 'bg-white text-gray-400 border border-gray-100 hover:bg-gray-50'
                        }`}
                >
                    📞 Аудит звонков ({calls?.length || 0})
                </button>
            </div>

            {/* Content Area */}
            <div className="bg-white rounded-[24px] md:rounded-[40px] shadow-2xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                {activeTab === 'violations' ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead>
                                <tr className="bg-gray-50/50 text-gray-400 text-[10px] uppercase tracking-[0.2em] font-black border-b border-gray-100">
                                    <th className="p-4 md:p-8">Дата и Время</th>
                                    <th className="p-4 md:p-8">Тип Нарушения</th>
                                    <th className="p-4 md:p-8">Описание ошибки</th>
                                    <th className="p-4 md:p-8 text-right">CRM Заказ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {violations.map((v: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-red-50/10 transition-colors group">
                                        <td className="p-4 md:p-8 font-bold text-gray-900 tabular-nums text-xs md:text-sm">
                                            {new Date(v.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                        <td className="p-4 md:p-8">
                                            <span className={`inline-flex items-center px-3 md:px-4 py-1.5 rounded-2xl text-[9px] md:text-[10px] font-black uppercase tracking-widest ring-1 ring-inset ${SEVERITY_COLORS[v.severity] || SEVERITY_COLORS.low}`}>
                                                {VIOLATION_LABELS[v.violation_type] || v.violation_type}
                                            </span>
                                        </td>
                                        <td className="p-4 md:p-8 text-gray-600 text-xs md:text-sm font-medium leading-relaxed group-hover:text-gray-900 transition-colors">
                                            {v.details}
                                        </td>
                                        <td className="p-4 md:p-8 text-right">
                                            <a
                                                href={`https://zmktlt.retailcrm.ru/orders/${v.order_id}/edit`}
                                                target="_blank"
                                                className="inline-flex items-center gap-2 font-black text-blue-600 hover:text-blue-800 transition-all text-xs md:text-sm group-hover:scale-105"
                                            >
                                                #{v.order_id}
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div>

                        {/* Filters Container */}
                        <div className="p-4 md:p-8 border-b border-gray-100 bg-gray-50/30 space-y-4 md:space-y-6">

                            {/* Top Row: Type Toggles & View Toggles */}
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-hide">
                                    {(['all', 'real', 'am'] as const).map(f => (
                                        <button
                                            key={f}
                                            onClick={() => setCallFilter(f)}
                                            className={`shrink-0 px-4 md:px-6 py-2 rounded-xl md:rounded-2xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${callFilter === f
                                                ? 'bg-gray-900 text-white shadow-lg'
                                                : 'bg-white text-gray-400 border border-gray-100 hover:border-gray-300'
                                                }`}
                                        >
                                            {f === 'all' ? 'Все' : f === 'real' ? 'Живые' : 'А/О'}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex items-center justify-between md:justify-end gap-4">
                                    <div className="flex items-center gap-1 md:gap-2 bg-gray-100 p-1 rounded-xl">
                                        <button
                                            onClick={() => setIsGroupedByOrder(false)}
                                            className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${!isGroupedByOrder ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                                        >
                                            Список
                                        </button>
                                        <button
                                            onClick={() => setIsGroupedByOrder(true)}
                                            className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${isGroupedByOrder ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                                        >
                                            Заказы
                                        </button>
                                    </div>
                                    <div className="text-[9px] md:text-[10px] font-black text-gray-300 uppercase tracking-widest px-3 md:px-4 border-l border-gray-200">
                                        {filteredCalls.length}
                                    </div>
                                </div>
                            </div>

                            {/* Bottom Row: Detailed Filters */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100/50">
                                {/* Date Range */}
                                <div className="flex gap-2 items-center">
                                    <div className="relative w-full">
                                        <input
                                            type="date"
                                            className="w-full bg-white border border-gray-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-600 focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all uppercase"
                                            value={filterDateStart}
                                            onChange={(e) => setFilterDateStart(e.target.value)}
                                            placeholder="С"
                                        />
                                        <label className="absolute -top-2 left-2 px-1 bg-gray-50/30 text-[8px] font-black text-gray-400 uppercase tracking-widest">С даты</label>
                                    </div>
                                    <div className="relative w-full">
                                        <input
                                            type="date"
                                            className="w-full bg-white border border-gray-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-600 focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all uppercase"
                                            value={filterDateEnd}
                                            onChange={(e) => setFilterDateEnd(e.target.value)}
                                        />
                                        <label className="absolute -top-2 left-2 px-1 bg-gray-50/30 text-[8px] font-black text-gray-400 uppercase tracking-widest">По дату</label>
                                    </div>
                                </div>

                                {/* Order Number */}
                                <div className="relative">
                                    <input
                                        type="text"
                                        className="w-full bg-white border border-gray-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 placeholder-gray-300 focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all"
                                        placeholder="Например: 50123"
                                        value={filterOrderNumber}
                                        onChange={(e) => setFilterOrderNumber(e.target.value)}
                                    />
                                    <label className="absolute -top-2 left-2 px-1 bg-gray-50/30 text-[8px] font-black text-gray-400 uppercase tracking-widest max-w-full truncate">Номер заказа</label>
                                </div>

                                {/* Duration Range */}
                                <div className="flex gap-2 items-center col-span-1 md:col-span-2">
                                    <div className="relative w-full">
                                        <input
                                            type="number"
                                            className="w-full bg-white border border-gray-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 placeholder-gray-300 focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all"
                                            placeholder="0"
                                            value={filterDurationMin}
                                            onChange={(e) => setFilterDurationMin(e.target.value)}
                                        />
                                        <label className="absolute -top-2 left-2 px-1 bg-gray-50/30 text-[8px] font-black text-gray-400 uppercase tracking-widest">Мин. сек</label>
                                    </div>
                                    <div className="relative w-full">
                                        <input
                                            type="number"
                                            className="w-full bg-white border border-gray-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 placeholder-gray-300 focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all"
                                            placeholder="∞"
                                            value={filterDurationMax}
                                            onChange={(e) => setFilterDurationMax(e.target.value)}
                                        />
                                        <label className="absolute -top-2 left-2 px-1 bg-gray-50/30 text-[8px] font-black text-gray-400 uppercase tracking-widest">Макс. сек</label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Grouped View */}
                        {
                            isGroupedByOrder ? (
                                <div className="divide-y divide-gray-100">
                                    {Object.values(
                                        filteredCalls.reduce((acc: any, call: any) => {
                                            const order = call.call_order_matches?.[0]?.orders;
                                            const key = order ? order.order_id : 'unmatched';

                                            if (!acc[key]) {
                                                acc[key] = {
                                                    order,
                                                    calls: []
                                                };
                                            }
                                            acc[key].calls.push(call);
                                            return acc;
                                        }, {})
                                    )
                                        // Sort: Unmatched last, otherwise by most recent call date in group
                                        .sort((a: any, b: any) => {
                                            if (!a.order) return 1;
                                            if (!b.order) return -1;
                                            // Sort by latest call in the group
                                            const latestA = Math.max(...a.calls.map((c: any) => new Date(c.timestamp).getTime()));
                                            const latestB = Math.max(...b.calls.map((c: any) => new Date(c.timestamp).getTime()));
                                            return latestB - latestA;
                                        })
                                        .map((group: any) => (
                                            <div key={group.order ? group.order.order_id : 'unmatched'} className="bg-white hover:bg-gray-50/30 transition-colors">
                                                {/* Group Header */}
                                                <div className="p-4 md:p-8 flex items-center justify-between gap-4">
                                                    <div className="flex items-center gap-3">
                                                        {group.order ? (
                                                            <a
                                                                href={`https://zmktlt.retailcrm.ru/orders/${group.order.order_id}/edit`}
                                                                target="_blank"
                                                                className="flex items-center gap-3 group/link"
                                                            >
                                                                <div className={`w-8 h-8 md:w-10 md:h-10 rounded-xl flex items-center justify-center text-sm md:text-lg font-black group-hover/link:scale-110 transition-transform shrink-0 ${PRIORITY_ICON_BG[group.order.priority] || PRIORITY_ICON_BG.black}`}>
                                                                    📦
                                                                </div>
                                                                <div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`text-base md:text-xl font-black transition-colors ${group.order.priority === 'red' ? 'text-red-700' : 'text-gray-900 group-hover/link:text-blue-600'}`}>#{group.order.number}</span>
                                                                        <svg className="w-3 md:w-4 h-3 md:h-4 text-gray-300 group-hover/link:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 mt-1">
                                                                        <span className={`px-2 py-0.5 rounded text-[9px] md:text-[10px] font-black uppercase tracking-widest ${getStatusColor(group.order.status)}`}>
                                                                            {group.order.status_name || group.order.status}
                                                                        </span>
                                                                        <span className="text-gray-200">|</span>
                                                                        <span className="text-gray-900 font-extrabold text-xs md:text-sm tracking-tight">
                                                                            {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(group.order.totalsumm || 0)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </a>
                                                        ) : (
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 md:w-10 md:h-10 bg-gray-100 text-gray-400 rounded-xl flex items-center justify-center text-sm md:text-lg font-black shrink-0">
                                                                    🚫
                                                                </div>
                                                                <div>
                                                                    <div className="text-base md:text-xl font-black text-gray-400">Без заказа</div>
                                                                    <div className="text-[8px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                                                        Не определен
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <div className="text-xl md:text-2xl font-black text-gray-900 leading-none">{group.calls.length}</div>
                                                        <div className="text-[8px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Звонков</div>
                                                    </div>
                                                </div>

                                                {/* Calls List inside Group */}
                                                <div className="px-4 md:px-8 pb-6 md:pb-8">
                                                    <div className="border-l-2 border-gray-100 ml-4 md:ml-5 pl-6 md:pl-8 space-y-4 md:space-y-6">
                                                        {group.calls.map((c: any) => (
                                                            <div key={c.id} className="relative">
                                                                {/* Timeline dot */}
                                                                <div className="absolute -left-[31px] md:-left-[39px] top-6 w-3 h-3 md:w-4 md:h-4 rounded-full border-2 md:border-4 border-white bg-gray-200"></div>

                                                                <div className="bg-gray-50/50 rounded-2xl p-4 md:p-6 border border-gray-100 hover:border-blue-200 transition-colors">
                                                                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-4">
                                                                        <div className="flex items-center gap-2 md:gap-3">
                                                                            <div className="text-xs md:text-sm font-bold text-gray-900 tabular-nums">
                                                                                {new Date(c.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                                            </div>
                                                                            <span className="text-gray-300">|</span>
                                                                            <div className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">
                                                                                {c.duration}с
                                                                            </div>
                                                                            {c.is_answering_machine && (
                                                                                <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[8px] md:text-[10px] font-black uppercase tracking-widest">А/О</span>
                                                                            )}
                                                                        </div>
                                                                        {c.record_url && (
                                                                            <audio controls className="h-8 w-full md:w-[200px] opacity-70 hover:opacity-100 transition-opacity">
                                                                                <source src={`/api/proxy/audio?url=${encodeURIComponent(c.record_url)}`} type="audio/mpeg" />
                                                                            </audio>
                                                                        )}
                                                                    </div>

                                                                    {c.transcript ? (
                                                                        <div className="text-gray-700 text-[11px] md:text-xs leading-relaxed font-medium italic">
                                                                            "{c.transcript}"
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-gray-300 text-[9px] md:text-[10px] font-bold uppercase tracking-widest italic">
                                                                            Нет записи
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    {filteredCalls.length === 0 && (
                                        <div className="p-16 md:p-32 text-center">
                                            <p className="text-gray-400 font-black uppercase tracking-widest text-[10px] md:text-xs">Нет звонков</p>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse min-w-[800px]">
                                        <thead>
                                            <tr className="bg-gray-50/50 text-gray-400 text-[10px] uppercase tracking-[0.2em] font-black border-b border-gray-100">
                                                <th className="p-4 md:p-8">Время</th>
                                                <th className="p-4 md:p-8">Статус & Аудио</th>
                                                <th className="p-4 md:p-8">Стенограмма</th>
                                                <th className="p-4 md:p-8 text-right">Заказ</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50 text-sm">
                                            {filteredCalls.map((c: any) => (
                                                <tr key={c.id} className="hover:bg-blue-50/5 transition-colors">
                                                    <td className="p-4 md:p-8 align-top whitespace-nowrap">
                                                        <div className="font-bold text-gray-900 tabular-nums text-xs md:text-sm">
                                                            {new Date(c.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                        </div>
                                                        <div className="text-gray-400 font-bold uppercase text-[9px] md:text-[10px] mt-1">
                                                            {c.duration} сек
                                                        </div>
                                                    </td>
                                                    <td className="p-4 md:p-8 align-top space-y-4">
                                                        <div className="flex items-center gap-3">
                                                            {c.is_answering_machine === true ? (
                                                                <span className="bg-amber-100 text-amber-700 px-3 md:px-4 py-1.5 rounded-xl md:rounded-2xl text-[9px] md:text-[10px] font-black uppercase tracking-widest ring-1 ring-amber-600/20">Автоответчик</span>
                                                            ) : c.is_answering_machine === false ? (
                                                                <span className="bg-green-100 text-green-700 px-3 md:px-4 py-1.5 rounded-xl md:rounded-2xl text-[9px] md:text-[10px] font-black uppercase tracking-widest ring-1 ring-green-600/20">Живой голос</span>
                                                            ) : (
                                                                <span className="text-gray-300 text-[9px] md:text-[10px] font-bold uppercase tracking-widest italic">Ожидает</span>
                                                            )}
                                                        </div>
                                                        {c.record_url && (
                                                            <div className="pt-2">
                                                                <audio controls className="h-8 md:h-10 w-full max-w-[200px] md:max-w-[240px] opacity-80 hover:opacity-100 transition-opacity">
                                                                    <source src={`/api/proxy/audio?url=${encodeURIComponent(c.record_url)}`} type="audio/mpeg" />
                                                                </audio>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-4 md:p-8 align-top max-w-lg">
                                                        {c.transcript ? (
                                                            <div className="bg-gray-50/50 p-4 md:p-6 rounded-2xl md:rounded-3xl border border-gray-100 text-gray-700 leading-relaxed font-medium text-[11px] md:text-xs italic relative group">
                                                                "{c.transcript}"
                                                            </div>
                                                        ) : (
                                                            <div className="h-20 md:h-24 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-2xl md:rounded-3xl text-gray-300 font-bold uppercase text-[9px] md:text-[10px] tracking-widest text-center px-4">
                                                                В обработке
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-4 md:p-8 align-top text-right whitespace-nowrap">
                                                        {c.call_order_matches && c.call_order_matches[0]?.orders && (
                                                            <div className="flex flex-col items-end gap-1.5">
                                                                <a
                                                                    href={`https://zmktlt.retailcrm.ru/orders/${c.call_order_matches[0].orders.order_id}/edit`}
                                                                    target="_blank"
                                                                    className={`inline-flex items-center gap-1.5 md:gap-2 font-black transition-all text-sm md:text-base group-hover:scale-105 ${c.call_order_matches[0].orders.priority === 'red' ? 'text-red-700 hover:text-red-800' :
                                                                        c.call_order_matches[0].orders.priority === 'yellow' ? 'text-amber-700 hover:text-amber-800' :
                                                                            c.call_order_matches[0].orders.priority === 'green' ? 'text-green-700 hover:text-green-800' :
                                                                                'text-blue-700 hover:text-blue-800'
                                                                        }`}
                                                                >
                                                                    #{c.call_order_matches[0].orders.number}
                                                                    <svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                                </a>
                                                                <div className="flex items-center gap-2">
                                                                    <span className={`px-2 py-0.5 rounded text-[9px] md:text-[10px] font-black uppercase tracking-widest ${getStatusColor(c.call_order_matches[0].orders.status)}`}>
                                                                        {c.call_order_matches[0].orders.status_name || c.call_order_matches[0].orders.status}
                                                                    </span>
                                                                    <span className="text-gray-200">|</span>
                                                                    <span className="text-gray-900 font-extrabold text-xs md:text-sm tracking-tight">
                                                                        {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(c.call_order_matches[0].orders.totalsumm || 0)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {filteredCalls.length === 0 && (
                                        <div className="p-16 md:p-32 text-center bg-gray-50/10">
                                            <p className="text-gray-400 font-black uppercase tracking-widest text-[10px] md:text-xs">Нет звонков</p>
                                        </div>
                                    )}
                                </div>
                            )
                        }

                        {/* Summary Footer */}
                        {
                            filteredCalls.length > 0 && (
                                <div className="bg-white border-t border-gray-100 p-4 md:p-6 flex flex-col md:flex-row items-center justify-between gap-4 text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wider">
                                    <div>
                                        {filteredCalls.length} элементов
                                    </div>
                                    <div className="flex flex-col md:flex-row gap-2 md:gap-8 text-center md:text-right">
                                        <div>
                                            Средняя длительность: <span className="text-gray-900 ml-1">
                                                {(() => {
                                                    const total = filteredCalls.reduce((acc: number, c: any) => acc + (c.duration || 0), 0);
                                                    const avg = Math.round(total / filteredCalls.length);
                                                    const m = Math.floor(avg / 60);
                                                    const s = avg % 60;
                                                    return m > 0 ? `${m} мин. ${s} с.` : `${s} с.`;
                                                })()}
                                            </span>
                                        </div>
                                        <div>
                                            Общая длительность: <span className="text-gray-900 ml-1">
                                                {(() => {
                                                    const total = filteredCalls.reduce((acc: number, c: any) => acc + (c.duration || 0), 0);
                                                    const h = Math.floor(total / 3600);
                                                    const m = Math.floor((total % 3600) / 60);
                                                    const s = total % 60;
                                                    const parts = [];
                                                    if (h > 0) parts.push(`${h} ч.`);
                                                    if (m > 0) parts.push(`${m} мин.`);
                                                    parts.push(`${s} с.`);
                                                    return parts.join(' ');
                                                })()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )
                        }
                    </div >
                )
                }
            </div >
        </div >
    );
}
