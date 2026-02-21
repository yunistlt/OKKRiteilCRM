'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function PriorityWidget() {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<string | null>(null);
    const [crmUrl, setCrmUrl] = useState<string>('');
    const [analyzingOrderId, setAnalyzingOrderId] = useState<number | null>(null);
    const [analysisResults, setAnalysisResults] = useState<Record<number, any>>({});

    useEffect(() => {
        fetch('/api/analysis/priorities')
            .then(res => res.json())
            .then(data => {
                if (data.ok) {
                    setOrders(data.priorities);
                    setCrmUrl(data.retailCrmUrl || '');
                }
                setLoading(false);
            })
            .catch(e => setLoading(false));
    }, []);

    const handleAnalyze = async (e: any, orderId: number) => {
        e.stopPropagation();
        if (analyzingOrderId) return;

        setAnalyzingOrderId(orderId);
        try {
            const res = await fetch(`/api/analysis/order/${orderId}`);
            const data = await res.json();
            if (data.success) {
                setAnalysisResults(prev => ({ ...prev, [orderId]: data.insights }));
            }
        } catch (e) {
            console.error('Analysis failed', e);
        } finally {
            setAnalyzingOrderId(null);
        }
    };

    const formatMoney = (val: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(val);

    if (loading) return (
        <div className="w-full max-w-5xl mb-12 bg-white rounded-[40px] p-8 border border-gray-100 shadow-xl shadow-blue-100/50 animate-pulse">
            <div className="h-8 bg-gray-100 w-1/3 rounded-xl mb-6"></div>
            <div className="flex gap-4 mb-6">
                <div className="h-20 bg-gray-50 flex-1 rounded-2xl"></div>
                <div className="h-20 bg-gray-50 flex-1 rounded-2xl"></div>
                <div className="h-20 bg-gray-50 flex-1 rounded-2xl"></div>
                <div className="h-20 bg-gray-50 flex-1 rounded-2xl"></div>
            </div>
        </div>
    );

    if (orders.length === 0) return null;

    const stats = {
        red: {
            count: orders.filter(o => o.level === 'red').length,
            sum: orders.filter(o => o.level === 'red').reduce((a, b) => a + b.totalSum, 0)
        },
        yellow: {
            count: orders.filter(o => o.level === 'yellow').length,
            sum: orders.filter(o => o.level === 'yellow').reduce((a, b) => a + b.totalSum, 0)
        },
        green: {
            count: orders.filter(o => o.level === 'green').length,
            sum: orders.filter(o => o.level === 'green').reduce((a, b) => a + b.totalSum, 0)
        },
        black: {
            count: orders.filter(o => o.level === 'black').length,
            sum: orders.filter(o => o.level === 'black').reduce((a, b) => a + b.totalSum, 0)
        }
    };

    const filteredOrders = activeTab ? orders.filter(o => o.level === activeTab) : [];

    return (
        <div className="w-full max-w-5xl mb-12 bg-white rounded-[32px] md:rounded-[40px] p-5 md:p-8 border border-gray-100 shadow-2xl shadow-gray-200/50 relative overflow-hidden">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-gray-900 text-white rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-2xl shadow-lg flex-shrink-0">
                        🚦
                    </div>
                    <div>
                        <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">Приоритеты</h2>
                        <p className="text-gray-400 font-bold uppercase text-[9px] md:text-[10px] tracking-widest">
                            AI-анализ состояния сделок ({orders.length} всего)
                        </p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
                {/* Red Tab */}
                <button
                    onClick={() => setActiveTab(activeTab === 'red' ? null : 'red')}
                    className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all duration-300 text-left group overflow-hidden ${activeTab === 'red'
                        ? 'bg-red-50 border-red-200 shadow-lg shadow-red-100'
                        : 'bg-white border-gray-100 hover:border-red-100 hover:bg-red-50/50'
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'red' ? 'text-red-600' : 'text-gray-400 group-hover:text-red-500'}`}>Критичные</span>
                        <div className={`w-2 h-2 rounded-full ${activeTab === 'red' ? 'bg-red-500 animate-pulse' : 'bg-red-200'}`}></div>
                    </div>
                    <div className="text-2xl md:text-3xl font-black text-gray-900 mb-1">{stats.red.count}</div>
                    <div className="text-[10px] md:text-xs font-medium text-gray-500">{formatMoney(stats.red.sum)}</div>
                </button>

                {/* Yellow Tab */}
                <button
                    onClick={() => setActiveTab(activeTab === 'yellow' ? null : 'yellow')}
                    className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all duration-300 text-left group overflow-hidden ${activeTab === 'yellow'
                        ? 'bg-yellow-50 border-yellow-200 shadow-lg shadow-yellow-100'
                        : 'bg-white border-gray-100 hover:border-yellow-100 hover:bg-yellow-50/50'
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'yellow' ? 'text-yellow-600' : 'text-gray-400 group-hover:text-yellow-500'}`}>Внимание</span>
                        <div className={`w-2 h-2 rounded-full ${activeTab === 'yellow' ? 'bg-yellow-400' : 'bg-yellow-200'}`}></div>
                    </div>
                    <div className="text-2xl md:text-3xl font-black text-gray-900 mb-1">{stats.yellow.count}</div>
                    <div className="text-[10px] md:text-xs font-medium text-gray-500">{formatMoney(stats.yellow.sum)}</div>
                </button>

                {/* Green Tab */}
                <button
                    onClick={() => setActiveTab(activeTab === 'green' ? null : 'green')}
                    className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all duration-300 text-left group overflow-hidden ${activeTab === 'green'
                        ? 'bg-green-50 border-green-200 shadow-lg shadow-green-100'
                        : 'bg-white border-gray-100 hover:border-green-100 hover:bg-green-50/50'
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'green' ? 'text-green-600' : 'text-gray-400 group-hover:text-green-500'}`}>В работе</span>
                        <div className={`w-2 h-2 rounded-full ${activeTab === 'green' ? 'bg-green-500' : 'bg-green-200'}`}></div>
                    </div>
                    <div className="text-2xl md:text-3xl font-black text-gray-900 mb-1">{stats.green.count}</div>
                    <div className="text-[10px] md:text-xs font-medium text-gray-500">{formatMoney(stats.green.sum)}</div>
                </button>

                {/* Black Tab */}
                <button
                    onClick={() => setActiveTab(activeTab === 'black' ? null : 'black')}
                    className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all duration-300 text-left group overflow-hidden ${activeTab === 'black'
                        ? 'bg-gray-900 border-gray-700 shadow-lg shadow-gray-400'
                        : 'bg-white border-gray-100 hover:border-gray-400 hover:bg-gray-50'
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'black' ? 'text-gray-200' : 'text-gray-400 group-hover:text-gray-600'}`}>Нераспред.</span>
                        <div className={`w-2 h-2 rounded-full ${activeTab === 'black' ? 'bg-gray-200' : 'bg-gray-300'}`}></div>
                    </div>
                    <div className={`text-2xl md:text-3xl font-black mb-1 ${activeTab === 'black' ? 'text-white' : 'text-gray-900'}`}>{stats.black.count}</div>
                    <div className={`text-[10px] md:text-xs font-medium ${activeTab === 'black' ? 'text-gray-400' : 'text-gray-500'}`}>{formatMoney(stats.black.sum)}</div>
                </button>
            </div>

            {/* List */}
            {activeTab && (
                <div className="space-y-3 min-h-[200px]">
                    {filteredOrders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-2xl text-gray-300">
                                ✨
                            </div>
                            <p className="text-gray-400 font-medium">Нет сделок в этой категории</p>
                        </div>
                    ) : (
                        filteredOrders.map((order) => (
                            <div key={order.orderId} className="group p-4 md:p-5 rounded-2xl md:rounded-3xl border border-gray-100 hover:border-blue-200 bg-gray-50/30 hover:bg-white transition-all duration-300 hover:shadow-lg cursor-pointer">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:mb-2">
                                    <div className="flex items-center gap-3 md:gap-4">
                                        <div className={`w-1.5 md:w-2 h-10 md:h-12 rounded-full flex-shrink-0 ${order.level === 'red' ? 'bg-red-500' :
                                            order.level === 'yellow' ? 'bg-yellow-400' :
                                                order.level === 'green' ? 'bg-green-500' : 'bg-gray-800'
                                            }`}></div>
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-1">
                                                <a
                                                    href={crmUrl ? `${crmUrl}/orders/${order.orderId}/edit` : '#'}
                                                    target={crmUrl ? '_blank' : undefined}
                                                    className="font-black text-gray-900 text-base md:text-lg hover:text-blue-600 hover:underline decoration-2 underline-offset-2 transition-colors"
                                                    onClick={e => !crmUrl && e.preventDefault()}
                                                >
                                                    #{order.orderNumber}
                                                </a>
                                                <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-white px-2 py-0.5 rounded-lg border border-gray-100">
                                                    {order.managerName}
                                                </span>
                                            </div>
                                            <div className="text-xs md:text-sm font-medium text-gray-500">
                                                {formatMoney(order.totalSum)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-row md:flex-col items-center md:items-end flex-wrap gap-2">
                                        <button
                                            onClick={(e) => handleAnalyze(e, order.orderId)}
                                            disabled={analyzingOrderId === order.orderId}
                                            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md active:scale-95 ${analyzingOrderId === order.orderId
                                                ? 'bg-gray-100 text-gray-400 animate-pulse'
                                                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
                                                }`}
                                        >
                                            {analyzingOrderId === order.orderId ? 'Анализ...' : '🤖 ИИ разбор'}
                                        </button>
                                        <div className="flex flex-row md:flex-col items-center md:items-end flex-wrap gap-1.5">
                                            {order.reasons.filter((r: string) => !r.startsWith('AI:')).map((r: string, i: number) => (
                                                <div key={i} className={`text-[9px] md:text-[10px] font-bold px-2 py-0.5 md:py-1 rounded-lg ${order.level === 'red' ? 'text-red-500 bg-red-50' :
                                                    order.level === 'yellow' ? 'text-yellow-600 bg-yellow-50' :
                                                        order.level === 'green' ? 'text-green-500 bg-green-50' :
                                                            'text-gray-500 bg-gray-100'
                                                    }`}>
                                                    {r}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* AI Resume & Recommendation Section */}
                                <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {order.summary && order.summary !== 'Ожидание анализа' && (
                                        <div className="flex items-start gap-3">
                                            <span className="text-lg">🤖</span>
                                            <div>
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-purple-500 mb-1">AI Резюме</p>
                                                <p className="text-sm font-medium text-gray-700 italic">"{order.summary}"</p>
                                            </div>
                                        </div>
                                    )}

                                    {order.recommendedAction && (
                                        <div className="flex items-start gap-3">
                                            <span className="text-lg">💡</span>
                                            <div>
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-1">Рекомендация</p>
                                                <p className="text-sm font-medium text-gray-700">{order.recommendedAction}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Deep Analysis Result (if available) */}
                                {analysisResults[order.orderId] && (
                                    <div className="mt-4 p-4 md:p-5 bg-indigo-50/50 rounded-2xl md:rounded-3xl border border-indigo-100 animate-in fade-in slide-in-from-top-2 duration-500">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                            {/* LPR & Core */}
                                            <div className="space-y-4">
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">ЛПР / Роль</p>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-bold text-gray-900">
                                                            {analysisResults[order.orderId].lpr?.name || 'Не выявлен'}
                                                        </span>
                                                        {analysisResults[order.orderId].lpr?.role && (
                                                            <span className="text-[10px] bg-white px-2 py-0.5 rounded-md border border-indigo-100 text-indigo-600 font-bold">
                                                                {analysisResults[order.orderId].lpr.role}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">Бюджет / Сроки</p>
                                                    <p className="text-xs font-medium text-gray-600">
                                                        💰 {analysisResults[order.orderId].budget?.status || 'Неизвестно'}
                                                        {analysisResults[order.orderId].budget?.constraints && ` (${analysisResults[order.orderId].budget.constraints})`}
                                                    </p>
                                                    <p className="text-xs font-medium text-gray-600 mt-1">
                                                        ⏳ {analysisResults[order.orderId].timeline?.urgency === 'hot' ? '🔥 Срочно' : analysisResults[order.orderId].timeline?.urgency === 'low' ? '💨 Не горит' : '📅 Нормально'}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Pain Points & Technical */}
                                            <div className="space-y-4">
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">Боли клиента</p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {analysisResults[order.orderId].pain_points?.map((p: string, i: number) => (
                                                            <span key={i} className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-md font-medium border border-red-100 italic">
                                                                {p}
                                                            </span>
                                                        )) || <span className="text-xs text-gray-400">Не указаны</span>}
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">Требования / Конкуренты</p>
                                                    <p className="text-[11px] text-gray-700 leading-relaxed line-clamp-2">
                                                        {analysisResults[order.orderId].technical_requirements?.join(', ') || 'Стандартные'}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* AI Advice (Recommendations) */}
                                            <div className="bg-white/80 p-4 rounded-2xl border border-indigo-100 shadow-sm self-start">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-3 flex items-center gap-2">
                                                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                                                    Советы Консультанта
                                                </p>
                                                <ul className="space-y-2">
                                                    {analysisResults[order.orderId].recommendations?.map((r: string, i: number) => (
                                                        <li key={i} className="text-xs font-bold text-gray-900 flex items-start gap-2">
                                                            <span className="text-emerald-500 text-sm">✓</span>
                                                            {r}
                                                        </li>
                                                    )) || <li className="text-xs text-gray-400 italic">Анализируем историю...</li>}
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

function HomeContent() {
    const searchParams = useSearchParams();
    const q = searchParams.toString();
    const suffix = q ? `?${q}` : '';

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] py-10 md:py-20">
            <h1 className="text-3xl md:text-5xl font-black text-gray-900 mb-2 tracking-tight text-center">Центр Управления</h1>
            <p className="text-gray-400 font-bold uppercase text-[10px] md:text-xs tracking-[0.2em] mb-8 md:mb-12 text-center">OKKRiteilCRM v1.3 + AI</p>

            <PriorityWidget />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 w-full max-w-6xl">

                {/* Morning Sprint Card */}
                <Link href="/efficiency"
                    className="group relative block p-8 md:p-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-orange-500/30 hover:shadow-orange-500/50 transition-all duration-300 transform hover:-translate-y-1"
                >
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-white/20 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                    </div>
                    <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">Утренний Спринт</h2>
                    <p className="text-sm md:text-base text-white/70 font-medium leading-relaxed">Ключевые заказы на сегодня. Обработка до 14:00.</p>
                </Link>

                {/* Settings Card */}
                <Link href="/settings"
                    className="group relative block p-8 md:p-10 bg-white border border-gray-100 rounded-[32px] md:rounded-[40px] shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300"
                >
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-blue-50 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-blue-600 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        </svg>
                    </div>
                    <h2 className="text-xl md:text-2xl font-black text-gray-900 mb-3 tracking-tight">Настройки</h2>
                    <p className="text-sm md:text-base text-gray-400 font-medium leading-relaxed">Управление статусами, системные настройки и интеграции.</p>
                </Link>

                {/* Analytics Card */}
                <Link href={`/analytics${suffix}`}
                    className="group relative block p-8 md:p-10 bg-gray-900 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-gray-900/20 hover:bg-blue-600 transition-all duration-300 transform hover:-translate-y-1"
                >
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-white/10 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                        </svg>
                    </div>
                    <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">Аналитика</h2>
                    <p className="text-sm md:text-base text-white/40 font-medium leading-relaxed">Отчеты по эффективности, нарушениям и контроль качества.</p>
                </Link>

            </div>
        </div>
    );
}

export default function HomePage() {
    return (
        <Suspense fallback={<div>Загрузка...</div>}>
            <HomeContent />
        </Suspense>
    );
}
