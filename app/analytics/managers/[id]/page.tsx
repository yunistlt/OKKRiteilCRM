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

export default function ManagerProfilePage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'violations' | 'calls'>('violations');
    const [callFilter, setCallFilter] = useState<'all' | 'real' | 'am'>('all');
    const [isGroupedByOrder, setIsGroupedByOrder] = useState(false);

    const from = searchParams.get('from');
    const to = searchParams.get('to');

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const url = new URL(`/api/analysis/managers/${params.id}`, window.location.origin);
                if (from) url.searchParams.set('from', from);
                if (to) url.searchParams.set('to', to);

                const res = await fetch(url.toString());
                const json = await res.json();
                if (json.error) throw new Error(json.error);
                setData(json);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [params.id, from, to]);

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <div className="text-gray-500 font-bold font-sans tracking-tight">Загружаем профиль менеджера...</div>
        </div>
    );

    if (!data) return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
            <div className="bg-white p-12 rounded-3xl shadow-xl text-center border border-gray-100">
                <h1 className="text-3xl font-black text-gray-900 mb-4">Менеджер не найден</h1>
                <button onClick={() => router.back()} className="px-8 py-3 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-blue-700 transition-all">Вернуться назад</button>
            </div>
        </div>
    );

    const { manager, stats, violations, calls } = data;

    const filteredCalls = (calls || []).filter((c: any) => {
        if (callFilter === 'real') return c.is_answering_machine === false;
        if (callFilter === 'am') return c.is_answering_machine === true;
        return true;
    });

    return (
        <div className="p-8 max-w-7xl mx-auto font-sans min-h-screen bg-gray-50">
            {/* Header */}
            <div className="mb-10 flex items-center gap-4">
                <button onClick={() => router.back()} className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100 text-gray-400 hover:text-blue-600 transition-all">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight">{manager.first_name} {manager.last_name}</h1>
                    <p className="text-gray-400 font-bold uppercase text-xs tracking-widest mt-1">Профиль Менеджера • ID {manager.id}</p>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
                <div className="bg-white p-8 rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100">
                    <div className="text-gray-400 text-xs font-black uppercase tracking-widest mb-2">Звонки (30 дн)</div>
                    <div className="text-4xl font-black text-gray-900 tabular-nums">{stats.total_calls}</div>
                </div>
                <div className="bg-white p-8 rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100">
                    <div className="text-gray-400 text-xs font-black uppercase tracking-widest mb-2">Нарушения</div>
                    <div className="text-4xl font-black text-red-600 tabular-nums">{stats.total_violations}</div>
                </div>
                <div className="bg-white p-8 rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 col-span-2 relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="text-gray-400 text-xs font-black uppercase tracking-widest mb-2">Эффективность</div>
                        <div className="text-4xl font-black text-blue-600 tabular-nums">{stats.efficiency_percent}%</div>
                        <div className="mt-1 text-xs text-gray-400 font-bold uppercase tracking-wider">~{stats.work_time_minutes} мин активного времени</div>
                    </div>
                </div>
            </div>

            {/* Tabs Control */}
            <div className="flex flex-wrap gap-4 mb-8">
                <button
                    onClick={() => setActiveTab('violations')}
                    className={`px-8 py-4 rounded-3xl font-black uppercase tracking-widest text-[11px] transition-all duration-300 transform active:scale-95 ${activeTab === 'violations'
                        ? 'bg-red-600 text-white shadow-2xl shadow-red-200 translate-y-[-2px]'
                        : 'bg-white text-gray-400 border border-gray-100 hover:bg-gray-50'
                        }`}
                >
                    🚩 Нарушения ({violations.length})
                </button>
                <button
                    onClick={() => setActiveTab('calls')}
                    className={`px-8 py-4 rounded-3xl font-black uppercase tracking-widest text-[11px] transition-all duration-300 transform active:scale-95 ${activeTab === 'calls'
                        ? 'bg-blue-600 text-white shadow-2xl shadow-blue-200 translate-y-[-2px]'
                        : 'bg-white text-gray-400 border border-gray-100 hover:bg-gray-50'
                        }`}
                >
                    📞 Аудит звонков ({calls?.length || 0})
                </button>
            </div>

            {/* Content Area */}
            <div className="bg-white rounded-[40px] shadow-2xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                {activeTab === 'violations' ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50/50 text-gray-400 text-[10px] uppercase tracking-[0.2em] font-black border-b border-gray-100">
                                    <th className="p-8">Дата и Время</th>
                                    <th className="p-8">Тип Нарушения</th>
                                    <th className="p-8">Описание ошибки</th>
                                    <th className="p-8 text-right">CRM Заказ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {violations.map((v: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-red-50/10 transition-colors group">
                                        <td className="p-8 font-bold text-gray-900 tabular-nums text-sm">
                                            {new Date(v.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                        <td className="p-8">
                                            <span className={`inline-flex items-center px-4 py-1.5 rounded-2xl text-[10px] font-black uppercase tracking-widest ring-1 ring-inset ${SEVERITY_COLORS[v.severity] || SEVERITY_COLORS.low}`}>
                                                {VIOLATION_LABELS[v.violation_type] || v.violation_type}
                                            </span>
                                        </td>
                                        <td className="p-8 text-gray-600 text-sm font-medium leading-relaxed group-hover:text-gray-900 transition-colors">
                                            {v.details}
                                        </td>
                                        <td className="p-8 text-right">
                                            <a
                                                href={`https://zmktlt.retailcrm.ru/orders/${v.order_id}/edit`}
                                                target="_blank"
                                                className="inline-flex items-center gap-2 font-black text-blue-600 hover:text-blue-800 transition-all text-sm group-hover:scale-105"
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
                        {/* Sub-Filters for Calls */}
                        <div className="p-8 border-b border-gray-100 bg-gray-50/30 flex items-center justify-between">
                            <div className="flex gap-2">
                                {(['all', 'real', 'am'] as const).map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setCallFilter(f)}
                                        className={`px-6 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${callFilter === f
                                            ? 'bg-gray-900 text-white shadow-lg'
                                            : 'bg-white text-gray-400 border border-gray-100 hover:border-gray-300'
                                            }`}
                                    >
                                        {f === 'all' ? 'Все' : f === 'real' ? 'Живые' : 'Автоответчики'}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl">
                                    <button
                                        onClick={() => setIsGroupedByOrder(false)}
                                        className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${!isGroupedByOrder ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                        Список
                                    </button>
                                    <button
                                        onClick={() => setIsGroupedByOrder(true)}
                                        className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${isGroupedByOrder ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                        По заказам
                                    </button>
                                </div>
                                <div className="text-[10px] font-black text-gray-300 uppercase tracking-widest pl-4 border-l border-gray-100">
                                    Найдено: {filteredCalls.length}
                                </div>
                            </div>
                        </div>

                        {/* Grouped View */}
                        {isGroupedByOrder ? (
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
                                            <div className="p-8 pb-4 flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                    {group.order ? (
                                                        <a
                                                            href={`https://zmktlt.retailcrm.ru/orders/${group.order.order_id}/edit`}
                                                            target="_blank"
                                                            className="flex items-center gap-3 group/link"
                                                        >
                                                            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center text-lg font-black group-hover/link:scale-110 transition-transform">
                                                                📦
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xl font-black text-gray-900 group-hover/link:text-blue-600 transition-colors">#{group.order.number}</span>
                                                                    <svg className="w-4 h-4 text-gray-300 group-hover/link:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                                </div>
                                                                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                                                    История коммуникаций
                                                                </div>
                                                            </div>
                                                        </a>
                                                    ) : (
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 bg-gray-100 text-gray-400 rounded-xl flex items-center justify-center text-lg font-black">
                                                                🚫
                                                            </div>
                                                            <div>
                                                                <div className="text-xl font-black text-gray-400">Без заказа</div>
                                                                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                                                    Не удалось определить
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-2xl font-black text-gray-900">{group.calls.length}</div>
                                                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Звонков</div>
                                                </div>
                                            </div>

                                            {/* Calls List inside Group */}
                                            <div className="px-8 pb-8">
                                                <div className="border-l-2 border-gray-100 pl-8 space-y-6">
                                                    {group.calls.map((c: any) => (
                                                        <div key={c.id} className="relative">
                                                            {/* Timeline dot */}
                                                            <div className="absolute -left-[39px] top-6 w-4 h-4 rounded-full border-4 border-white bg-gray-200"></div>

                                                            <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:border-blue-200 transition-colors">
                                                                <div className="flex items-start justify-between mb-4">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="font-bold text-gray-900 tabular-nums">
                                                                            {new Date(c.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                                        </div>
                                                                        <span className="text-gray-300">|</span>
                                                                        <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                                                                            {c.duration} сек
                                                                        </div>
                                                                        {c.is_answering_machine && (
                                                                            <span className="ml-2 bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">Автоответчик</span>
                                                                        )}
                                                                    </div>
                                                                    {c.record_url && (
                                                                        <audio controls className="h-8 w-[200px] opacity-70 hover:opacity-100 transition-opacity">
                                                                            <source src={`/api/proxy/audio?url=${encodeURIComponent(c.record_url)}`} type="audio/mpeg" />
                                                                        </audio>
                                                                    )}
                                                                </div>

                                                                {c.transcript ? (
                                                                    <div className="text-gray-700 text-xs leading-relaxed font-medium">
                                                                        "{c.transcript}"
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-gray-300 text-[10px] font-bold uppercase tracking-widest italic">
                                                                        Нет стенограммы
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
                                    <div className="p-32 text-center">
                                        <p className="text-gray-400 font-black uppercase tracking-widest text-xs">Нет звонков</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50/50 text-gray-400 text-[10px] uppercase tracking-[0.2em] font-black border-b border-gray-100">
                                            <th className="p-8">Время</th>
                                            <th className="p-8">Вердикт ИИ & Плеер</th>
                                            <th className="p-8">Стенограмма звонка</th>
                                            <th className="p-8 text-right">Заказ</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 text-sm">
                                        {filteredCalls.map((c: any) => (
                                            <tr key={c.id} className="hover:bg-blue-50/5 transition-colors">
                                                <td className="p-8 align-top">
                                                    <div className="font-bold text-gray-900 tabular-nums">
                                                        {new Date(c.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                    <div className="text-gray-400 font-bold uppercase text-[10px] mt-1 pr-4">
                                                        Длительность: {c.duration} сек
                                                    </div>
                                                </td>
                                                <td className="p-8 align-top space-y-4">
                                                    <div className="flex items-center gap-3">
                                                        {c.is_answering_machine === true ? (
                                                            <span className="bg-amber-100 text-amber-700 px-4 py-1.5 rounded-2xl text-[10px] font-black uppercase tracking-widest ring-1 ring-amber-600/20">Автоответчик</span>
                                                        ) : c.is_answering_machine === false ? (
                                                            <span className="bg-green-100 text-green-700 px-4 py-1.5 rounded-2xl text-[10px] font-black uppercase tracking-widest ring-1 ring-green-600/20">Живой голос</span>
                                                        ) : (
                                                            <span className="text-gray-300 text-[10px] font-bold uppercase tracking-widest italic">Ожидает проверки</span>
                                                        )}
                                                    </div>
                                                    {c.record_url && (
                                                        <div className="pt-2">
                                                            <audio controls className="h-10 w-full max-w-[240px] opacity-80 hover:opacity-100 transition-opacity">
                                                                <source src={`/api/proxy/audio?url=${encodeURIComponent(c.record_url)}`} type="audio/mpeg" />
                                                                Ваш браузер не поддерживает аудио.
                                                            </audio>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-8 align-top max-w-lg">
                                                    {c.transcript ? (
                                                        <div className="bg-gray-50/50 p-6 rounded-3xl border border-gray-100 text-gray-700 leading-relaxed font-medium text-xs italic relative group">
                                                            <span className="text-blue-400 absolute top-2 right-4 text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Whisper AI</span>
                                                            "{c.transcript}"
                                                        </div>
                                                    ) : (
                                                        <div className="h-24 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-3xl text-gray-300 font-bold uppercase text-[10px] tracking-widest">
                                                            Разговор еще не обработан
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-8 align-top text-right">
                                                    {c.call_order_matches && c.call_order_matches[0]?.orders && (
                                                        <a
                                                            href={`https://zmktlt.retailcrm.ru/orders/${c.call_order_matches[0].orders.order_id}/edit`}
                                                            target="_blank"
                                                            className="inline-flex items-center gap-2 font-black text-blue-600 hover:text-blue-800 transition-all text-sm group-hover:scale-105"
                                                        >
                                                            #{c.call_order_matches[0].orders.number}
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                        </a>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {filteredCalls.length === 0 && (
                                    <div className="p-32 text-center bg-gray-50/10">
                                        <p className="text-gray-400 font-black uppercase tracking-widest text-xs">Нет звонков, соответствующих фильтру</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
