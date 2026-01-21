
'use client';

import React, { useEffect, useState } from 'react';

// --- Types ---

interface SyncServiceStatus {
    service: string;
    cursor: string;
    last_run: string | null;
    status: 'ok' | 'warning' | 'error';
    details: string;
    reason?: string | null;
}

interface OpenAIStatus {
    status: 'ok' | 'error' | 'loading';
    message: string;
    code?: string;
}

interface DbStats {
    workingOrders: number;
    matchedCalls: number;
    transcribedCalls: number;
    pendingCalls: number;
}

interface RuleItem {
    name: string;
    is_active: boolean;
}

export default function SystemStatusPage() {
    // --- State: Sync Monitor ---
    const [syncStatuses, setSyncStatuses] = useState<SyncServiceStatus[]>([]);
    const [allRules, setAllRules] = useState<RuleItem[]>([]);
    const [loadingSync, setLoadingSync] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [lastRunError, setLastRunError] = useState<{ service: string, error: string } | null>(null);

    // --- State: Legacy Stats (DB & OpenAI) ---
    const [openai, setOpenai] = useState<OpenAIStatus>({ status: 'loading', message: 'Проверка...' });
    const [dbStats, setDbStats] = useState<DbStats | null>(null);
    const [loadingStats, setLoadingStats] = useState(true);

    // --- State: Settings & AI ---
    const [minDuration, setMinDuration] = useState(15);
    const [savingSettings, setSavingSettings] = useState(false);
    const [refreshingPriorities, setRefreshingPriorities] = useState(false);

    // --- Fetchers ---

    const fetchSyncStatus = async () => {
        setLoadingSync(true);
        try {
            const res = await fetch('/api/settings/system-status');
            const data = await res.json();

            if (data.dashboard) {
                setSyncStatuses(data.dashboard);
            }
            if (data.all_rules) {
                setAllRules(data.all_rules);
            }
            if (data.settings && data.settings.transcription_min_duration) {
                setMinDuration(data.settings.transcription_min_duration);
            }
            setLastUpdated(new Date());

        } catch (e) {
            console.error('Failed to fetch sync status', e);
        } finally {
            setLoadingSync(false);
        }
    };

    const checkOpenAI = async () => {
        setOpenai({ status: 'loading', message: 'Проверяем соединение...' });
        try {
            const res = await fetch('/api/debug/openai/status');
            const data = await res.json();
            setOpenai(data);
        } catch (e) {
            setOpenai({ status: 'error', message: 'Ошибка сети при проверке' });
        }
    };

    const fetchDbStats = async () => {
        setLoadingStats(true);
        try {
            const res = await fetch('/api/system/stats');
            const json = await res.json();
            if (json.ok) setDbStats(json.stats);
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingStats(false);
        }
    };

    // --- Actions ---

    const refreshPriorities = async () => {
        setRefreshingPriorities(true);
        try {
            const res = await fetch('/api/analysis/priorities/refresh');
            const data = await res.json();
            if (data.ok) {
                alert(`Анализ завершен: обработано ${data.count} заказов.`);
                fetchDbStats();
            } else {
                alert('Ошибка анализа: ' + data.error);
            }
        } catch (e: any) {
            console.error(e);
            alert('Ошибка сети при анализе');
        } finally {
            setRefreshingPriorities(false);
        }
    };

    const runService = async (serviceName: string) => {
        let url = '';
        if (serviceName.includes('Telphin Main')) url = '/api/sync/telphin';
        if (serviceName.includes('RetailCRM')) url = '/api/sync/retailcrm';
        if (serviceName.includes('Matching Service')) url = '/api/matching/process';
        if (serviceName.includes('History Sync')) url = '/api/sync/history';
        if (serviceName.includes('Rule Engine')) url = '/api/rules/execute';

        if (!url) return;

        setLastRunError(null);
        setSyncStatuses(prev => prev.map(s =>
            s.service === serviceName ? { ...s, details: 'Запуск...', status: 'warning' } : s
        ));

        try {
            const res = await fetch(url);
            if (!res.ok) {
                const errorText = await res.text();
                setLastRunError({ service: serviceName, error: errorText || res.statusText });
            }
            // Wait a sec then refresh status
            setTimeout(fetchSyncStatus, 2000);
        } catch (e: any) {
            console.error('Run failed', e);
            setLastRunError({ service: serviceName, error: e.message || 'Unknown network error' });
            fetchSyncStatus();
        }
    };

    const saveSettings = async () => {
        setSavingSettings(true);
        try {
            await fetch('/api/settings/system-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'transcription_min_duration', value: minDuration })
            });
            fetchSyncStatus();
        } catch (e) {
            console.error(e);
            alert('Ошибка сохранения!');
        } finally {
            setSavingSettings(false);
        }
    };

    // --- Effects ---

    useEffect(() => {
        fetchSyncStatus();
        checkOpenAI();
        fetchDbStats();

        const interval = setInterval(fetchSyncStatus, 30000);
        return () => clearInterval(interval);
    }, []);

    // --- Helpers ---

    const getStatusTheme = (s: string) => {
        switch (s) {
            case 'ok': return { bg: 'bg-green-500', text: 'text-green-600', light: 'bg-green-50', border: 'border-green-100', label: 'В НОРМЕ' };
            case 'warning': return { bg: 'bg-yellow-500', text: 'text-yellow-600', light: 'bg-yellow-50', border: 'border-yellow-100', label: 'ВНИМАНИЕ' };
            case 'error': return { bg: 'bg-red-500', text: 'text-red-600', light: 'bg-red-50', border: 'border-red-100', label: 'ОШИБКА' };
            default: return { bg: 'bg-gray-400', text: 'text-gray-600', light: 'bg-gray-50', border: 'border-gray-100', label: 'НЕИЗВЕСТНО' };
        }
    };

    const getRusServiceName = (name: string) => {
        if (name.includes('Telphin Main')) return 'Синхронизация Звонков (Телфин)';
        if (name.includes('RetailCRM')) return 'Синхронизация Заказов (RetailCRM)';
        if (name.includes('Matching Service')) return 'Служба Матчинга (Звонок + Заказ)';
        if (name.includes('History Sync')) return 'События Заказов (History API)';
        if (name.includes('Rule Engine')) return 'Движок Проверки Правил';
        return name;
    }

    const getIcon = (name: string) => {
        if (name.includes('Telphin')) return '☎️';
        if (name.includes('RetailCRM')) return '🛍️';
        if (name.includes('Matching')) return '🔗';
        if (name.includes('History')) return '⚡️';
        if (name.includes('Rule')) return '⚙️';
        return '⚙️';
    };

    // --- State: Transcription Details ---
    const [showTranscriptionModal, setShowTranscriptionModal] = useState(false);
    const [transcriptionDetails, setTranscriptionDetails] = useState<{ queue: any[], completed: any[] } | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);

    const fetchTranscriptionDetails = async () => {
        setLoadingDetails(true);
        try {
            const res = await fetch('/api/system/transcription-details');
            const data = await res.json();
            if (data.queue || data.completed) {
                setTranscriptionDetails(data);
                setShowTranscriptionModal(true);
            }
        } catch (e) { console.error(e); } finally { setLoadingDetails(false); }
    };

    return (
        <div className="max-w-7xl mx-auto py-4 px-4">

            {/* ALERT: Technical Failure Log */}
            {lastRunError && (
                <div className="mb-6 bg-red-50 border-2 border-red-500 rounded-2xl p-6 shadow-xl animate-pulse">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-red-500 text-white rounded-xl flex items-center justify-center text-2xl">🚨</div>
                        <div>
                            <h2 className="text-xl font-black text-red-900 leading-none">ОШИБКА ПРИ ЗАПУСКЕ</h2>
                            <p className="text-red-700 font-bold uppercase text-[10px] tracking-widest mt-1">Сервис: {lastRunError.service}</p>
                        </div>
                        <button onClick={() => setLastRunError(null)} className="ml-auto text-red-400 hover:text-red-600 font-bold">ЗАКРЫТЬ</button>
                    </div>
                    <div className="bg-white/50 border border-red-200 rounded-xl p-4 overflow-x-auto">
                        <code className="text-xs text-red-800 font-mono whitespace-pre-wrap">
                            {lastRunError.error}
                        </code>
                    </div>
                    <p className="text-[10px] text-red-500 font-bold mt-3 uppercase tracking-tighter">Сделайте скриншот этой ошибки и отправьте разработчику.</p>
                </div>
            )}

            {/* HEADER & GLOBAL HEALTH */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
                <div>
                    <h1 className="text-3xl font-black text-gray-900 tracking-tighter">Системный Мониторинг</h1>
                    <p className="text-sm font-medium text-gray-500 mt-1">
                        Все модули управления OKK на одном экране. Обновлено: {lastUpdated ? lastUpdated.toLocaleTimeString() : '...'}
                    </p>
                </div>

                <div className="hidden lg:flex items-center gap-6 bg-white px-8 py-4 rounded-3xl border border-gray-100 shadow-sm">
                    <div className="text-right">
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">OpenAI API</div>
                        <div className={`text-xs font-black ${openai.status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                            {openai.status === 'ok' ? 'ОНЛАЙН' : 'ОШИБКА'}
                        </div>
                    </div>
                    <div className="w-px h-8 bg-gray-100"></div>
                    <div className="text-right">
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Заказов в работе</div>
                        <div className="text-xl font-black text-gray-900">{dbStats?.workingOrders || 0}</div>
                    </div>
                    <button
                        onClick={() => { fetchSyncStatus(); checkOpenAI(); fetchDbStats(); }}
                        disabled={loadingSync}
                        className="w-12 h-12 bg-gray-900 text-white rounded-2xl flex items-center justify-center hover:bg-blue-600 transition-all active:scale-90 shadow-lg shadow-gray-200"
                    >
                        {loadingSync ? '...' : '🔄'}
                    </button>
                </div>
            </div>

            {/* CORE MONITORING TABLE */}
            <div className="bg-white rounded-[32px] border border-gray-100 shadow-2xl shadow-gray-200/50 overflow-hidden mb-8">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50 border-b border-gray-100">
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Механизм</th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Статус</th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Последний запуск</th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Диагностика / Состояние</th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Управление</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {syncStatuses.map((s, idx) => {
                                const theme = getStatusTheme(s.status);
                                return (
                                    <tr key={idx} className="hover:bg-gray-50/50 transition-colors group">
                                        <td className="px-6 py-6 whitespace-nowrap">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                                                    {getIcon(s.service)}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-black text-gray-900 tracking-tight">{getRusServiceName(s.service)}</div>
                                                    <div className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">{s.service}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-6">
                                            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${theme.light} ${theme.text} text-[10px] font-black border ${theme.border}`}>
                                                <span className={`w-2 h-2 rounded-full ${theme.bg}`}></span>
                                                {theme.label}
                                            </div>
                                        </td>
                                        <td className="px-6 py-6 whitespace-nowrap">
                                            <div className="text-xs font-bold text-gray-700">
                                                {s.last_run ? new Date(s.last_run).toLocaleString('ru-RU') : '---'}
                                            </div>
                                            <div className="text-[9px] font-bold text-gray-400 uppercase mt-1">Автономно</div>
                                        </td>
                                        <td className="px-6 py-6">
                                            <div className="max-w-xs xl:max-w-md">
                                                <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                                                    {s.service.includes('Rule') ? 'Контейнер Правил' : 'Маркер (Курсор)'}
                                                </div>
                                                <div className="text-xs font-medium text-gray-600 leading-tight">
                                                    {s.reason || s.details}
                                                </div>
                                                {!s.reason && s.cursor && (
                                                    <div className="mt-2 text-[9px] font-mono font-bold bg-gray-50 inline-block px-2 py-1 rounded border border-gray-100 text-gray-500">
                                                        {s.cursor.replace('T', ' ').replace('Z', '').split('.')[0]}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-6 text-right">
                                            <button
                                                onClick={() => runService(s.service)}
                                                className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg ${s.status === 'ok' ? 'bg-gray-900 text-white hover:bg-blue-600 shadow-gray-200' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'}`}
                                            >
                                                ▶ Запустить
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* RULES INVENTORY */}
                <div className="lg:col-span-2 bg-white rounded-[32px] border border-gray-100 shadow-xl p-8">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h3 className="text-2xl font-black text-gray-900 tracking-tight">Реестр Правил (ОКК)</h3>
                            <p className="text-sm font-medium text-gray-500">Какие именно проверки сейчас выполняются механизмом.</p>
                        </div>
                        <div className="flex gap-2">
                            <span className="px-3 py-1 bg-green-50 text-green-600 rounded-lg text-[9px] font-black border border-green-100">АКТИВНЫЕ: {allRules.filter(r => r.is_active).length}</span>
                            <span className="px-3 py-1 bg-gray-50 text-gray-400 rounded-lg text-[9px] font-black border border-gray-200">ВЫКЛЮЧЕНЫ: {allRules.filter(r => !r.is_active).length}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {allRules.length > 0 ? allRules.map((rule, idx) => (
                            <div key={idx} className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${rule.is_active ? 'bg-white border-gray-100 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${rule.is_active ? 'bg-blue-50 text-blue-600' : 'bg-gray-200 text-gray-500'}`}>
                                        {rule.is_active ? '✅' : '⚪️'}
                                    </div>
                                    <div className="truncate font-black text-gray-700 text-xs tracking-tight" title={rule.name}>{rule.name}</div>
                                </div>
                                <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${rule.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                                    {rule.is_active ? 'On' : 'Off'}
                                </div>
                            </div>
                        )) : (
                            <div className="col-span-full py-12 text-center text-gray-400 font-bold text-sm uppercase tracking-widest">Список правил пуст</div>
                        )}
                    </div>
                </div>

                {/* SIDEBAR: Utilities & Stats */}
                <div className="flex flex-col gap-8">

                    {/* Transcription Compact */}
                    <div className="bg-white rounded-[32px] border border-gray-100 shadow-xl p-6 flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-black text-gray-900 tracking-tight">Транскрибация</h3>
                                <div className="text-purple-600 text-xl">📝</div>
                            </div>
                            <div className="mb-6">
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Прогресс базы</span>
                                    <span className="text-xs font-black text-purple-600">
                                        {dbStats ? Math.round((dbStats.transcribedCalls / (dbStats.transcribedCalls + dbStats.pendingCalls || 1)) * 100) : 0}%
                                    </span>
                                </div>
                                <div className="w-full h-2 bg-purple-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-purple-500" style={{ width: `${dbStats ? Math.round((dbStats.transcribedCalls / (dbStats.transcribedCalls + dbStats.pendingCalls || 1)) * 100) : 0}%` }}></div>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={fetchTranscriptionDetails}
                            className="w-full py-4 bg-purple-50 text-purple-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-600 hover:text-white transition-all"
                        >
                            👁 Посмотреть Очередь
                        </button>
                    </div>

                    {/* Quick Settings */}
                    <div className="bg-gray-900 rounded-[32px] border border-gray-800 shadow-xl p-6 text-white overflow-hidden relative">
                        <div className="absolute top-0 right-0 p-4 text-4xl opacity-10">⚙️</div>
                        <h3 className="text-lg font-black tracking-tight mb-4">Настройки</h3>

                        <div className="space-y-4 relative z-10">
                            <div>
                                <label className="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2">Минимальная длина звонка (сек)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={minDuration}
                                        onChange={(e) => setMinDuration(Number(e.target.value))}
                                        className="w-full bg-gray-800 border-none rounded-xl px-4 py-2 text-sm font-bold text-white focus:ring-2 focus:ring-blue-500"
                                    />
                                    <button
                                        onClick={saveSettings}
                                        className="px-4 bg-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700"
                                    >
                                        OK
                                    </button>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-gray-800">
                                <button
                                    onClick={refreshPriorities}
                                    disabled={refreshingPriorities}
                                    className="w-full py-3 bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white hover:text-gray-900 transition-all active:scale-95"
                                >
                                    {refreshingPriorities ? '🚀 Обновляем...' : '⚡️ Пересчитать Приоритеты'}
                                </button>
                                <p className="text-[8px] text-gray-500 mt-2 text-center">Обновление критичности статусов "Завис без движения"</p>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Modal: Transcription Details (Preserved) */}
            {showTranscriptionModal && transcriptionDetails && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4" onClick={() => setShowTranscriptionModal(false)}>
                    {/* Reuse existing modal body or simplified one */}
                    <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-8 flex items-center justify-between border-b border-gray-100">
                            <div>
                                <h1 className="text-3xl font-black text-gray-900 tracking-tighter">Очередь Транскрибации</h1>
                                <p className="text-sm font-medium text-gray-500 mt-1">Детальный список звонков на обработке AI.</p>
                            </div>
                            <button onClick={() => setShowTranscriptionModal(false)} className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center text-xl hover:bg-gray-100 transition-colors">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-2 gap-12">
                            {/* ... existing modal logic remains similar but I will simplify for brevity if needed, but the user didn't ask to change it ... */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-purple-600 uppercase tracking-widest bg-purple-50 px-4 py-2 rounded-xl inline-block">В очереди ({transcriptionDetails.queue.length})</h4>
                                {transcriptionDetails.queue.slice(0, 20).map((item: any) => (
                                    <div key={item.id} className="p-4 border border-gray-100 rounded-2xl flex justify-between items-center text-xs">
                                        <span className="font-black text-gray-900">{item.order ? `#${item.order.number}` : 'Без заказа'}</span>
                                        <span className="text-gray-400 font-bold">{item.duration} сек</span>
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-green-600 uppercase tracking-widest bg-green-50 px-4 py-2 rounded-xl inline-block">Завершено ({transcriptionDetails.completed.length})</h4>
                                {transcriptionDetails.completed.slice(0, 20).map((item: any) => (
                                    <div key={item.id} className="p-4 border border-gray-100 rounded-2xl flex justify-between items-center text-xs">
                                        <span className="font-black text-gray-900">{item.order ? `#${item.order.number}` : 'Без заказа'}</span>
                                        <span className="text-green-600 font-bold">Готово</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
