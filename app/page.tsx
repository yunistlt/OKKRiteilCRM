'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

function PriorityWidget() {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<string | null>(null);
    const [crmUrl, setCrmUrl] = useState<string>('');
    const [analyzingOrderId, setAnalyzingOrderId] = useState<number | null>(null);
    const [analysisResults, setAnalysisResults] = useState<Record<number, any>>({});
    const [queuedAnalyses, setQueuedAnalyses] = useState<Record<number, { message: string; cachedAt?: string | null }>>({});

    // Chat state
    const [chatInput, setChatInput] = useState('');
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'agent', agent?: string, text: string }[]>([]);
    const [chatLoading, setChatLoading] = useState(false);

    const handleChatSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim() || chatLoading) return;

        const userText = chatInput;
        setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
        setChatInput('');
        setChatLoading(true);

        try {
            // Prepare history to send (limit to last 10 messages to avoid huge payload)
            const historyObj = chatMessages.slice(-10).map(m => ({
                role: m.role,
                text: m.text
            }));

            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userText, history: historyObj })
            });
            const data = await res.json();

            if (data.success) {
                setChatMessages(prev => [...prev, { role: 'agent', agent: data.agent, text: data.text }]);
                // If it's a specific order analysis, we could show it below or we rely on the text response
                if (data.action?.type === 'analyze_order' && data.action.orderId) {
                    // Automatically click analyze button effectively or show insights
                    // We'll just append it to the analysisResults to show in UI if tab switches back
                    if (data.action.result) {
                        setAnalysisResults(prev => ({ ...prev, [data.action.orderId]: data.action.result }));
                    }
                }
            } else {
                setChatMessages(prev => [...prev, { role: 'agent', agent: 'Система', text: 'Ошибка: ' + data.error }]);
            }
        } catch (error: any) {
            setChatMessages(prev => [...prev, { role: 'agent', agent: 'Система', text: 'Ошибка связи с сервером.' }]);
        } finally {
            setChatLoading(false);
        }
    };


    useEffect(() => {
        fetch('/api/analysis/priorities')
            .then(res => res.json())
            .then(data => {
                if (data.ok) {
                    setOrders(Array.isArray(data.priorities) ? data.priorities : []);
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
                if (data.insights) {
                    setAnalysisResults(prev => ({ ...prev, [orderId]: data.insights }));
                }

                if (data.mode === 'queued') {
                    setQueuedAnalyses(prev => ({
                        ...prev,
                        [orderId]: {
                            message: data.reason || 'Анализ поставлен в очередь realtime pipeline.',
                            cachedAt: data.cachedAt || null,
                        },
                    }));
                } else {
                    setQueuedAnalyses(prev => {
                        const next = { ...prev };
                        delete next[orderId];
                        return next;
                    });
                }
            }
        } catch (e) {
            console.error('Analysis failed', e);
        } finally {
            setAnalyzingOrderId(null);
        }
    };

    const formatMoney = (val: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(val);

    const safeOrders = useMemo(() => Array.isArray(orders) ? orders : [], [orders]);

    // PERF: считаем сводку одним проходом по заказам и только при изменении данных,
    // а не 12+ раз .filter/.reduce на каждый ре-рендер.
    const stats = useMemo(() => {
        const acc = {
            red: { count: 0, sum: 0 },
            yellow: { count: 0, sum: 0 },
            green: { count: 0, sum: 0 },
            black: { count: 0, sum: 0 },
        };
        for (const o of safeOrders) {
            const bucket = (acc as any)[o.level];
            if (bucket) {
                bucket.count += 1;
                bucket.sum += o.totalSum;
            }
        }
        return acc;
    }, [safeOrders]);

    const filteredOrders = useMemo(
        () => activeTab ? safeOrders.filter(o => o.level === activeTab) : [],
        [safeOrders, activeTab]
    );

    if (loading) return (
        <div className="mb-12 w-full bg-white rounded-[40px] p-8 border border-gray-100 shadow-xl shadow-blue-100/50 animate-pulse">
            <div className="h-8 bg-gray-100 w-1/3 rounded-xl mb-6"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="h-64 bg-gray-100 rounded-[32px]"></div>
                <div className="h-64 bg-gray-100 rounded-[32px]"></div>
                <div className="h-64 bg-gray-100 rounded-[32px]"></div>
            </div>
        </div>
    );

    if (safeOrders.length === 0) return null;

    return (
        <div className="mb-12 w-full bg-white rounded-[32px] md:rounded-[40px] p-5 md:p-8 border border-gray-100 shadow-2xl shadow-gray-200/50 relative overflow-hidden">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-gray-900 text-white rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-2xl shadow-lg flex-shrink-0">
                        🚦
                    </div>
                    <div>
                        <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">Центр Управления</h2>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1">🚥 Приоритеты</div>
                    </div>
                </div>
            </div>

            {/* In priorities view, filteredOrders list is shown below the tabs */}
            <>
                {/* Tabs */}
                <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
                    {/* ... (Existing Tabs Code) */}
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
                                                        {order.status && (
                                                            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">
                                                                {order.status}
                                                            </span>
                                                        )}
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
                                                    className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md active:scale-95 flex items-center gap-2 ${analyzingOrderId === order.orderId
                                                        ? 'bg-gray-100 text-gray-400 animate-pulse'
                                                        : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
                                                        }`}
                                                >
                                                    {analyzingOrderId === order.orderId ? (
                                                        'Анализ...'
                                                    ) : (
                                                        <>
                                                            <img src="/images/agents/anna.png" alt="Anna" className="w-5 h-5 rounded-full border border-white/30" />
                                                            <span>Анна: ИИ разбор</span>
                                                        </>
                                                    )}
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
                                                <div className="flex items-center gap-2">
                                                    <img src="/images/agents/anna.png" alt="Anna" className="w-8 h-8 rounded-full border-2 border-purple-100 shadow-sm" />
                                                    <div>
                                                        <p className="text-[10px] font-bold uppercase tracking-widest text-purple-500 mb-0.5">Анна: Резюме</p>
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
                                        {queuedAnalyses[order.orderId] && (
                                            <div className="mt-4 p-3 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 animate-in fade-in slide-in-from-top-2 duration-500">
                                                <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-1">Анна: обновление поставлено в очередь</div>
                                                <div className="text-xs font-medium leading-relaxed">{queuedAnalyses[order.orderId].message}</div>
                                                {queuedAnalyses[order.orderId].cachedAt && (
                                                    <div className="text-[10px] text-amber-700/80 mt-1">
                                                        Показываем последний сохранённый анализ от {new Date(queuedAnalyses[order.orderId].cachedAt as string).toLocaleString('ru-RU')}.
                                                    </div>
                                                )}
                                            </div>
                                        )}

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
                                                        {analysisResults[order.orderId].dialogue_count !== undefined && (
                                                            <div className="pt-2 border-t border-indigo-100">
                                                                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-1">Коммуникация</p>
                                                                <p className="text-xs font-bold text-gray-700">
                                                                    📞 {analysisResults[order.orderId].dialogue_count} звонков
                                                                </p>
                                                                {analysisResults[order.orderId].last_contact_date && (
                                                                    <p className="text-[9px] text-gray-400 mt-0.5">
                                                                        Контакт: {new Date(analysisResults[order.orderId].last_contact_date).toLocaleDateString('ru-RU')}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
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
                                                        {analysisResults[order.orderId].dialogue_summary && (
                                                            <div>
                                                                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">История диалогов</p>
                                                                <p className="text-[11px] text-gray-600 italic leading-relaxed">
                                                                    {analysisResults[order.orderId].dialogue_summary}
                                                                </p>
                                                            </div>
                                                        )}
                                                        {analysisResults[order.orderId].last_order_changes && (
                                                            <div className="pt-2 border-t border-indigo-100">
                                                                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-1">Последние изменения</p>
                                                                <p className="text-[10px] text-gray-500 leading-snug">
                                                                    {analysisResults[order.orderId].last_order_changes}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* AI Advice (Recommendations) */}
                                                    <div className="bg-white/80 p-4 rounded-2xl border border-indigo-100 shadow-sm self-start">
                                                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-3 flex items-center gap-2">
                                                            <img src="/images/agents/anna.png" alt="Anna" className="w-6 h-6 rounded-full border border-emerald-100" />
                                                            Анна: Советы Консультанта
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

                                                {/* Customer Profile Section */}
                                                {analysisResults[order.orderId].customer_profile && (
                                                    <div className="mt-6 pt-5 border-t border-indigo-100">
                                                        <div className="flex flex-col md:flex-row gap-6">
                                                            <div className="flex-1">
                                                                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-3 flex items-center gap-2">
                                                                    👤 Профиль клиента
                                                                </p>
                                                                <div className="bg-white/40 p-3 rounded-xl border border-indigo-50 space-y-3">
                                                                    {analysisResults[order.orderId].customer_profile?.client_resume && (
                                                                        <div>
                                                                            <p className="text-[11px] text-gray-700 leading-relaxed">
                                                                                {analysisResults[order.orderId].customer_profile.client_resume}
                                                                            </p>
                                                                        </div>
                                                                    )}
                                                                    <div className="flex flex-wrap gap-4">
                                                                        <div>
                                                                            <p className="text-[9px] uppercase font-bold text-gray-400 mb-0.5">Всего заказов</p>
                                                                            <p className="text-sm font-black text-indigo-600">
                                                                                {analysisResults[order.orderId].customer_profile.total_orders || 1}
                                                                            </p>
                                                                        </div>
                                                                        {analysisResults[order.orderId].customer_profile?.perspective && (
                                                                            <div>
                                                                                <p className="text-[9px] uppercase font-bold text-gray-400 mb-0.5">Потенциал</p>
                                                                                <p className="text-sm font-bold text-gray-700">
                                                                                    {analysisResults[order.orderId].customer_profile.perspective}
                                                                                </p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {analysisResults[order.orderId].customer_profile?.cross_sell && analysisResults[order.orderId].customer_profile.cross_sell.length > 0 && (
                                                                <div className="md:w-1/3">
                                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-3 flex items-center gap-2">
                                                                        🚀 Что ещё предложить
                                                                    </p>
                                                                    <div className="flex flex-wrap gap-1.5">
                                                                        {analysisResults[order.orderId].customer_profile.cross_sell.map((item: string, i: number) => (
                                                                            <span key={i} className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg border border-emerald-100 font-bold">
                                                                                {item}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </>
        </div >
    );
}

function HomeContent() {
    return (
        <div className="flex min-h-[60vh] w-full flex-col justify-center px-4 py-6 md:px-6 md:py-8">
            <PriorityWidget />

            <div className="grid w-full grid-cols-1 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 md:grid-cols-3 md:gap-6">

                {/* Morning Sprint Card */}
                <Link href="/efficiency"
                    className="group relative block p-8 md:p-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-orange-500/30 hover:shadow-orange-500/50 transition-all duration-300 transform hover:-translate-y-1 overflow-hidden"
                >
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-150 transition-transform">
                        <svg className="w-32 h-32" fill="white" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <div className="relative z-10">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-white/20 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                            <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                        </div>
                        <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">Утренний Спринт</h2>
                        <p className="text-sm md:text-base text-white/70 font-medium leading-relaxed">Ключевые заказы на сегодня. Обработка до 14:00.</p>
                    </div>
                </Link>

                {/* OKK Dashboard Card */}
                <Link href="/okk"
                    className="group relative block p-8 md:p-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-blue-600/30 hover:shadow-blue-600/50 transition-all duration-300 transform hover:-translate-y-1 overflow-hidden"
                >
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-150 transition-transform">
                        <svg className="w-32 h-32" fill="white" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                    </div>
                    <div className="relative z-10">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-white/20 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                            <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
                            </svg>
                        </div>
                        <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">Контроль Качества</h2>
                        <p className="text-sm md:text-base text-white/70 font-medium leading-relaxed">Полная аналитика ошибок, записи звонков и ИИ оценки.</p>
                    </div>
                </Link>

                {/* Analytics Hub Card */}
                <Link href="/analytics"
                    className="group relative block p-8 md:p-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-all duration-300 transform hover:-translate-y-1 overflow-hidden"
                >
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-150 transition-transform">
                        <svg className="w-32 h-32" fill="white" viewBox="0 0 24 24"><path d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
                    </div>
                    <div className="relative z-10">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-white/20 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                            <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path>
                            </svg>
                        </div>
                        <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">Хаб Аналитики</h2>
                        <p className="text-sm md:text-base text-white/70 font-medium leading-relaxed">Дашборды по выручке, воронке продаж и эффективности.</p>
                    </div>
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
