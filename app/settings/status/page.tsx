
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

interface RulesStatus {
    service: string;
    last_run: string | null;
    status: 'ok' | 'warning';
    active_rules: string[];
    details: string;
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

export default function SystemStatusPage() {
    // --- State: Sync Monitor ---
    const [syncStatuses, setSyncStatuses] = useState<SyncServiceStatus[]>([]);
    const [loadingSync, setLoadingSync] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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
        if (serviceName.includes('Rule Engine')) url = '/api/rules/execute';

        if (!url) return;

        // Optimistic UI: Set loading state
        const originalStatuses = [...syncStatuses];
        setSyncStatuses(prev => prev.map(s =>
            s.service === serviceName ? { ...s, details: 'Запуск...', status: 'warning' } : s
        ));

        try {
            await fetch(url);
            // Wait a sec then refresh status
            setTimeout(fetchSyncStatus, 2000);
        } catch (e) {
            console.error('Run failed', e);
            setSyncStatuses(originalStatuses); // Revert on error
            alert('Ошибка запуска: ' + e);
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

    const getStatusColor = (s: string) => {
        switch (s) {
            case 'ok': return 'bg-green-50 text-green-700 border-green-200';
            case 'warning': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
            case 'error': return 'bg-red-50 text-red-700 border-red-200';
            default: return 'bg-gray-50 text-gray-700 border-gray-200';
        }
    };

    const getStatusLabel = (s: string) => {
        switch (s) {
            case 'ok': return 'АКТИВЕН';
            case 'warning': return 'ВНИМАНИЕ';
            case 'error': return 'ОШИБКА';
            default: return 'НЕИЗВЕСТНО';
        }
    };

    const getRusServiceName = (name: string) => {
        if (name.includes('Telphin Main')) return 'Телфин (Основной)';
        if (name.includes('RetailCRM')) return 'RetailCRM Заказы';
        if (name.includes('Matching Service')) return 'Матчинг (Live)';
        if (name.includes('History Sync')) return 'History Sync (Rules)';
        return name;
    }

    const getIcon = (name: string) => {
        if (name.includes('Telphin')) return '☎️';
        if (name.includes('RetailCRM')) return '🛍️';
        if (name.includes('Matching')) return '🔗';
        if (name.includes('Transcription')) return '📝';
        if (name.includes('History')) return '⚡️';
        return '⚙️';
    };

    const totalTranscriptionPool = (dbStats?.transcribedCalls || 0) + (dbStats?.pendingCalls || 0);
    const percent = totalTranscriptionPool > 0
        ? Math.round(((dbStats?.transcribedCalls || 0) / totalTranscriptionPool) * 100)
        : 0;

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
            } else {
                alert('Не удалось загрузить детали: ' + (data.error || 'Неизвестная ошибка'));
            }
        } catch (e) {
            console.error(e);
            alert('Ошибка сети');
        } finally {
            setLoadingDetails(false);
        }
    };

    return (
        <div className="max-w-7xl mx-auto py-2 px-2 md:py-4 md:px-0">
            {/* Compact Header */}
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-lg font-bold text-gray-900">Системный Монитор</h1>
                <button
                    onClick={() => { fetchSyncStatus(); checkOpenAI(); fetchDbStats(); }}
                    disabled={loadingSync || loadingStats}
                    className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                    {loadingSync ? '...' : '🔄'}
                </button>
            </div>

            {/* Mobile Sync List (Compact) */}
            <div className="md:hidden space-y-2 mb-6">
                {syncStatuses.map((service, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className="text-xl shrink-0">{getIcon(service.service)}</div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xs font-bold text-gray-900 truncate max-w-[120px]">
                                        {getRusServiceName(service.service)}
                                    </h3>
                                    <span className={`w-2 h-2 rounded-full ${service.status === 'ok' ? 'bg-green-500' : service.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                                </div>
                                <p className="text-[9px] text-gray-500 truncate mt-0.5">
                                    {service.last_run ? new Date(service.last_run).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => runService(service.service)}
                            className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[9px] font-bold uppercase hover:bg-blue-100 active:scale-95"
                        >
                            Start
                        </button>
                    </div>
                ))}
            </div>

            {/* Desktop Sync Grid */}
            <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
                {syncStatuses.length > 0 ? syncStatuses.map((service, idx) => (
                    <div key={idx} className="bg-white p-4 md:p-5 rounded-2xl border border-gray-100 shadow-lg shadow-gray-200/40 relative overflow-hidden group flex flex-col justify-between h-full">

                        <div className={`absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-10 transition-opacity text-5xl md:text-6xl -mr-4 -mt-4 select-none grayscale group-hover:grayscale-0`}>
                            {getIcon(service.service)}
                        </div>

                        <div className="relative z-10 w-full">
                            <div className="flex items-center justify-between mb-3 w-full">
                                <div className="text-xl md:text-2xl">{getIcon(service.service)}</div>
                                <div className={`px-2 py-1 rounded-md text-[8px] md:text-[9px] font-black uppercase tracking-widest border ${getStatusColor(service.status)}`}>
                                    {getStatusLabel(service.status)}
                                </div>
                            </div>

                            <h3 className="text-sm font-black text-gray-900 tracking-tight mb-1 truncate" title={getRusServiceName(service.service)}>
                                {getRusServiceName(service.service)}
                            </h3>
                            <p className="text-[9px] md:text-[10px] font-medium text-gray-500 mb-3 min-h-[1.5em] line-clamp-2 leading-tight" title={service.details}>{service.details}</p>

                            {service.reason && (
                                <div className="bg-orange-50 p-2 rounded-lg border border-orange-100 mb-2">
                                    <div className="text-[8px] md:text-[9px] font-black text-orange-400 uppercase tracking-widest mb-1">Диагностика</div>
                                    <div className="text-[9px] md:text-[10px] font-medium text-orange-800 leading-tight">
                                        {service.reason}
                                    </div>
                                </div>
                            )}

                            {!service.reason && (
                                <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 mb-2">
                                    <div className="text-[8px] md:text-[9px] font-black text-gray-400 uppercase tracking-widest">
                                        {service.service.includes('Rule') ? 'Расписание' : 'Курсор'}
                                    </div>
                                    <div className="text-[9px] md:text-[10px] font-mono font-bold text-gray-700 truncate" title={service.cursor}>
                                        {service.cursor.replace('T', ' ').replace('Z', '').split('.')[0]}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between mt-auto mb-3 w-full">
                                <span className="text-[8px] md:text-[9px] font-bold text-gray-400 uppercase">Послед. запуск</span>
                                <span className="text-[8px] md:text-[9px] font-bold text-gray-600">
                                    {service.last_run ? new Date(service.last_run).toLocaleString('ru-RU') : '---'}
                                </span>
                            </div>

                            <button
                                onClick={() => runService(service.service)}
                                className="w-full py-2 bg-gray-50 hover:bg-blue-600 hover:text-white border border-gray-200 hover:border-blue-600 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2 group-hover:bg-gray-100"
                            >
                                <span>▶ Запустить</span>
                            </button>
                        </div>
                    </div>
                )) : (
                    <div className="col-span-full p-6 text-center text-gray-400 font-bold text-xs">
                        {loadingSync ? 'Загрузка...' : 'Нет данных.'}
                    </div>
                )}
            </div>

            {/* SECTION 2: AI & STATS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6 mb-8">
                {/* 2.1 Priorities Analysis */}
                <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-[32px] border border-gray-100 shadow-xl shadow-gray-200/50 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2 md:mb-4">
                            <div className="text-xl md:text-2xl">🚦</div>
                            <h3 className="text-base md:text-lg font-black text-gray-900 tracking-tight">Анализ Приоритетов</h3>
                        </div>
                        <p className="text-[10px] md:text-xs font-medium text-gray-500 mb-4 leading-relaxed">
                            Пересчет критичности заказов и статусов (модуль "Завис без движения").
                        </p>
                    </div>

                    <button
                        onClick={refreshPriorities}
                        disabled={refreshingPriorities}
                        className="w-full py-3 md:py-4 bg-gray-900 text-white rounded-xl md:rounded-2xl text-[10px] md:text-xs font-black uppercase tracking-widest hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {refreshingPriorities ? '🚀 ...' : '⚡️ Обновить'}
                    </button>
                </div>

                {/* 2.2 General Stats (Orders & Matches) */}
                <div className="bg-white p-4 md:p-5 rounded-2xl border border-gray-100 shadow-lg shadow-blue-200/10 flex flex-col">
                    <div className="flex items-center gap-3 mb-4 md:mb-6">
                        <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-lg">📊</div>
                        <h3 className="text-sm font-black text-gray-900">Статистика Базы</h3>
                    </div>

                    {loadingStats ? (
                        <div className="animate-pulse space-y-4">
                            <div className="h-12 bg-gray-50 rounded-xl"></div>
                            <div className="h-12 bg-gray-50 rounded-xl"></div>
                        </div>
                    ) : dbStats ? (
                        <div className="space-y-3 md:space-y-4 flex-1 flex flex-col justify-center">
                            <div className="p-3 md:p-4 bg-gray-50 rounded-xl border border-gray-100 flex justify-between items-center">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">В работе</span>
                                <span className="text-xl md:text-2xl font-black text-gray-900">{dbStats.workingOrders}</span>
                            </div>

                            <div className="p-3 md:p-4 bg-gray-50 rounded-xl border border-gray-100 flex justify-between items-center">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Звонки</span>
                                <span className="text-xl md:text-2xl font-black text-gray-900">{dbStats.matchedCalls}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-400 font-bold text-xs uppercase">Нет данных</div>
                    )}
                </div>

                {/* 2.3 Transcription (Progress + Settings) */}
                <div
                    onClick={fetchTranscriptionDetails}
                    className="bg-white p-4 md:p-5 rounded-2xl border border-gray-100 shadow-lg shadow-purple-200/10 flex flex-col cursor-pointer hover:shadow-xl hover:shadow-purple-200/20 active:scale-[0.98] transition-all group"
                >
                    <div className="flex items-center gap-3 mb-4 md:mb-6">
                        <div className="w-8 h-8 bg-purple-50 text-purple-600 rounded-lg flex items-center justify-center text-lg">📝</div>
                        <h3 className="text-sm font-black text-gray-900 group-hover:text-purple-600 transition-colors">Транскрибация</h3>
                    </div>

                    <div className="mb-4 md:mb-8">
                        {loadingStats ? (
                            <div className="animate-pulse space-y-2">
                                <div className="h-1 bg-gray-100 rounded-full"></div>
                                <div className="h-3 w-2/3 bg-gray-50 rounded"></div>
                            </div>
                        ) : dbStats ? (
                            <div>
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Прогресс</span>
                                    <span className="text-xs font-black text-purple-600">{percent}%</span>
                                </div>
                                <div className="w-full h-2 bg-purple-100 rounded-full overflow-hidden mb-2">
                                    <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${percent}%` }}></div>
                                </div>
                                <div className="flex justify-between text-[10px] font-bold text-purple-400 uppercase tracking-wider">
                                    <span>Готово: {dbStats.transcribedCalls}</span>
                                    <span>Очередь: {dbStats.pendingCalls}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="h-12 flex items-center justify-center text-[10px] font-bold text-gray-300 uppercase">Нет статистики</div>
                        )}
                    </div>

                    <div className="mt-auto pt-4 md:pt-6 border-t border-gray-50" onClick={(e) => e.stopPropagation()}>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                            Мин. длительность (сек)
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                value={minDuration}
                                onChange={(e) => setMinDuration(Number(e.target.value))}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                            <button
                                onClick={saveSettings}
                                disabled={savingSettings}
                                className="px-4 bg-purple-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 disabled:opacity-50 transition-all active:scale-95"
                            >
                                {savingSettings ? '...' : 'OK'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* SECTION 3: Open AI Testing Inline */}
            <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-[32px] border border-gray-100 shadow-xl shadow-gray-200/50 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-green-50 text-green-600 rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-2xl flex-shrink-0">🤖</div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 md:gap-3 mb-1">
                            <h3 className="text-base md:text-lg font-black text-gray-900 tracking-tight">OpenAI API</h3>
                            <div className={`px-2 py-0.5 md:py-1 rounded text-[8px] md:text-[9px] font-black uppercase tracking-widest flex-shrink-0 ${openai.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {openai.status === 'ok' ? 'ОНЛАЙН' : 'ОШИБКА'}
                            </div>
                        </div>
                        <p className={`text-[10px] md:text-xs font-bold truncate ${openai.status === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                            {openai.message === 'API Key is valid and active' ? 'Ключ активен' : openai.message}
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-between w-full md:w-auto gap-3">
                    <a href="https://platform.openai.com/usage" target="_blank" className="text-[10px] md:text-xs font-black text-blue-500 hover:text-blue-700 uppercase tracking-widest border-b-2 border-transparent hover:border-blue-200 transition-all">
                        Баланс ↗
                    </a>
                    <button
                        onClick={checkOpenAI}
                        className="px-4 py-2 bg-gray-900 text-white rounded-lg md:rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest hover:bg-blue-600 transition-all active:scale-95 whitespace-nowrap"
                    >
                        Проверить
                    </button>
                </div>
            </div>

            {/* Modal: Transcription Details */}
            {showTranscriptionModal && transcriptionDetails && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-2 md:p-4" onClick={() => setShowTranscriptionModal(false)}>
                    <div className="bg-white rounded-2xl md:rounded-[32px] shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-4 md:p-8 flex items-center justify-between bg-gray-50 border-b border-gray-100 shrink-0">
                            <div>
                                <h2 className="text-lg md:text-2xl font-black text-gray-900 tracking-tight">Транскрибация</h2>
                                <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mt-0.5">Очередь и статус</p>
                            </div>
                            <button onClick={() => setShowTranscriptionModal(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                                ✕
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-6">

                            {/* Queue Column */}
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="text-xs font-black text-purple-600 uppercase tracking-widest bg-purple-50 px-3 py-1 rounded-lg">
                                        В очереди ({transcriptionDetails.queue.length})
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    {transcriptionDetails.queue.length === 0 ? (
                                        <div className="text-gray-300 text-xs font-bold text-center py-8">Пусто</div>
                                    ) : (
                                        transcriptionDetails.queue.map((item: any) => (
                                            <div key={item.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-purple-200 transition-colors">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="font-bold text-gray-900 text-xs text-purple-700">
                                                            {item.order ? `#${item.order.number}` : 'Без заказа'}
                                                        </span>
                                                        {item.order && (
                                                            <span
                                                                className="text-[9px] font-bold px-1.5 py-0.5 rounded-md text-gray-900 border border-black/5 w-fit"
                                                                style={{ backgroundColor: item.order.status_color || '#eee' }}
                                                            >
                                                                {item.order.status_name || item.order.status}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase block">
                                                            {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                        {item.order && item.order.totalsumm > 0 && (
                                                            <span className="text-[10px] font-bold text-gray-900 block mt-1">
                                                                {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(item.order.totalsumm)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between text-[10px] font-medium text-gray-500 mt-2">
                                                    <span>{item.duration} сек</span>
                                                    <span>{new Date(item.date).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Completed Column */}
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="text-xs font-black text-green-600 uppercase tracking-widest bg-green-50 px-3 py-1 rounded-lg">
                                        Готово ({transcriptionDetails.completed.length})
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    {transcriptionDetails.completed.length === 0 ? (
                                        <div className="text-gray-300 text-xs font-bold text-center py-8">Пусто</div>
                                    ) : (
                                        transcriptionDetails.completed.map((item: any) => (
                                            <div key={item.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-green-200 transition-colors">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="font-bold text-gray-900 text-xs">
                                                            {item.order ? `#${item.order.number}` : 'Без заказа'}
                                                        </span>
                                                        {item.order && (
                                                            <span
                                                                className="text-[9px] font-bold px-1.5 py-0.5 rounded-md text-gray-900 border border-black/5 w-fit"
                                                                style={{ backgroundColor: item.order.status_color || '#eee' }}
                                                            >
                                                                {item.order.status_name || item.order.status}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase block">
                                                            {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                        {item.order && item.order.totalsumm > 0 && (
                                                            <span className="text-[10px] font-bold text-gray-900 block mt-1">
                                                                {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(item.order.totalsumm)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <p className="text-[10px] text-gray-500 leading-snug mb-2 line-clamp-2 italic mt-1">
                                                    "{item.transcript_preview || '...'}"
                                                </p>
                                                <div className="flex items-center justify-between text-[10px] font-medium text-gray-400">
                                                    <span>{item.duration} сек</span>
                                                    <span>{new Date(item.date).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
