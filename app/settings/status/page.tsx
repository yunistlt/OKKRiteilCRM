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

export default function SystemStatusPage() {
    // --- State: Sync Monitor ---
    const [syncStatuses, setSyncStatuses] = useState<SyncServiceStatus[]>([]);
    const [loadingSync, setLoadingSync] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    // --- State: Legacy Stats (DB & OpenAI) ---
    const [openai, setOpenai] = useState<OpenAIStatus>({ status: 'loading', message: 'Проверка...' });
    const [dbStats, setDbStats] = useState<DbStats | null>(null);
    const [loadingStats, setLoadingStats] = useState(true);

    // --- State: Settings ---
    const [minDuration, setMinDuration] = useState(15);
    const [savingSettings, setSavingSettings] = useState(false);

    // --- Fetchers ---

    const fetchSyncStatus = async () => {
        setLoadingSync(true);
        try {
            const res = await fetch('/api/settings/system-status');
            const data = await res.json();
            if (data.dashboard) {
                setSyncStatuses(data.dashboard);
                setLastUpdated(new Date());
            }
            if (data.settings && data.settings.transcription_min_duration) {
                setMinDuration(data.settings.transcription_min_duration);
            }
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

    const runService = async (serviceName: string) => {
        let url = '';
        if (serviceName.includes('Telphin Main')) url = '/api/sync/telphin';
        if (serviceName.includes('RetailCRM')) url = '/api/sync/retailcrm';
        if (serviceName.includes('Matching Service')) url = '/api/matching/process';

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
            // Reload to confirm (optional)
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

        // Poll sync status every 30s
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
        return name;
    }

    const getIcon = (name: string) => {
        if (name.includes('Telphin')) return '☎️';
        if (name.includes('RetailCRM')) return '🛍️';
        if (name.includes('Matching')) return '🔗';
        if (name.includes('Transcription')) return '📝';
        return '⚡️';
    };

    const totalTranscriptionPool = (dbStats?.transcribedCalls || 0) + (dbStats?.pendingCalls || 0);
    const percent = totalTranscriptionPool > 0
        ? Math.round(((dbStats?.transcribedCalls || 0) / totalTranscriptionPool) * 100)
        : 0;

    return (
        <div className="max-w-7xl mx-auto py-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-gray-900 tracking-tight mb-1">Системный Монитор</h1>
                    <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                        Обновлено: {lastUpdated ? lastUpdated.toLocaleTimeString() : '...'}
                    </p>
                </div>
                <button
                    onClick={() => { fetchSyncStatus(); checkOpenAI(); fetchDbStats(); }}
                    disabled={loadingSync || loadingStats}
                    className="px-4 py-2 bg-white border border-gray-200 rounded-lg font-bold text-xs hover:bg-gray-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                >
                    {loadingSync ? '...' : '🔄 Обновить'}
                </button>
            </div>

            {/* SECTION 1: SYNC MONITOR (Compact Row) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {syncStatuses.length > 0 ? syncStatuses.map((service, idx) => (
                    <div key={idx} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-lg shadow-gray-200/40 relative overflow-hidden group flex flex-col justify-between h-full">

                        <div className={`absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-10 transition-opacity text-6xl -mr-4 -mt-4 select-none grayscale group-hover:grayscale-0`}>
                            {getIcon(service.service)}
                        </div>

                        <div className="relative z-10 w-full">
                            <div className="flex items-center justify-between mb-3 w-full">
                                <div className="text-2xl">{getIcon(service.service)}</div>
                                <div className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border ${getStatusColor(service.status)}`}>
                                    {getStatusLabel(service.status)}
                                </div>
                            </div>

                            <h3 className="text-sm font-black text-gray-900 tracking-tight mb-1 truncate" title={getRusServiceName(service.service)}>
                                {getRusServiceName(service.service)}
                            </h3>
                            <p className="text-[10px] font-medium text-gray-500 mb-3 h-3 truncate">{service.details}</p>

                            {/* REASON BLOCK */}
                            {service.reason && (
                                <div className="bg-orange-50 p-2 rounded-lg border border-orange-100 mb-2">
                                    <div className="text-[9px] font-black text-orange-400 uppercase tracking-widest mb-1">Диагностика</div>
                                    <div className="text-[10px] font-medium text-orange-800 leading-tight">
                                        {service.reason}
                                    </div>
                                </div>
                            )}

                            {/* CURSOR BLOCK */}
                            {!service.reason && (
                                <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 mb-2">
                                    <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Курсор</div>
                                    <div className="text-[10px] font-mono font-bold text-gray-700 truncate" title={service.cursor}>
                                        {service.cursor.replace('T', ' ').replace('Z', '').split('.')[0]}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between mt-auto mb-3 w-full">
                                <span className="text-[9px] font-bold text-gray-400 uppercase">Послед. запуск</span>
                                <span className="text-[9px] font-bold text-gray-600">
                                    {service.last_run ? new Date(service.last_run).toLocaleString('ru-RU') : '---'}
                                </span>
                            </div>

                            {/* RUN BUTTON */}
                            <button
                                onClick={() => runService(service.service)}
                                className="w-full py-2 bg-gray-50 hover:bg-blue-600 hover:text-white border border-gray-200 hover:border-blue-600 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2 group-hover:bg-gray-100"
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

            {/* SECTION 2: INFRASTRUCTURE & SETTINGS (Unified Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* 1. General Stats (Orders & Matches) */}
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-lg shadow-blue-200/10 flex flex-col">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-lg">📊</div>
                        <h3 className="text-sm font-black text-gray-900">Статистика Базы</h3>
                    </div>

                    {loadingStats ? (
                        <div className="animate-pulse space-y-4">
                            <div className="h-12 bg-gray-50 rounded-xl"></div>
                            <div className="h-12 bg-gray-50 rounded-xl"></div>
                        </div>
                    ) : dbStats ? (
                        <div className="space-y-4 flex-1 flex flex-col justify-center">
                            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Заказы в работе</span>
                                <span className="text-2xl font-black text-gray-900">{dbStats.workingOrders}</span>
                            </div>

                            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Матчи (звонки)</span>
                                <span className="text-2xl font-black text-gray-900">{dbStats.matchedCalls}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-400 font-bold text-xs uppercase">Нет данных</div>
                    )}
                </div>

                {/* 2. Transcription (Progress + Settings) */}
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-lg shadow-purple-200/10 flex flex-col">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-8 h-8 bg-purple-50 text-purple-600 rounded-lg flex items-center justify-center text-lg">📝</div>
                        <h3 className="text-sm font-black text-gray-900">Транскрибация</h3>
                    </div>

                    {/* Progress Portion */}
                    <div className="mb-8">
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

                    {/* Settings Portion */}
                    <div className="mt-auto pt-6 border-t border-gray-50">
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
                        <p className="text-[9px] text-gray-400 mt-2 leading-relaxed">
                            Звонки короче этого времени будут игнорироваться ИИ (автоответчики/сбросы).
                        </p>
                    </div>
                </div>

                {/* 3. OpenAI Status */}
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-lg shadow-green-200/10 flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-green-50 text-green-600 rounded-lg flex items-center justify-center text-lg">🤖</div>
                            <h3 className="text-sm font-black text-gray-900">OpenAI</h3>
                        </div>
                        <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest ${openai.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {openai.status === 'ok' ? 'ОНЛАЙН' : 'ОШИБКА'}
                        </div>
                    </div>

                    <div className="flex-1 p-4 bg-gray-50 rounded-xl border border-gray-100 mb-6 flex items-center justify-center text-center">
                        <p className={`text-xs font-bold leading-tight ${openai.status === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
                            {openai.message === 'API Key is valid and active' ? 'Ключ API активен' : openai.message}
                        </p>
                    </div>

                    <button
                        onClick={checkOpenAI}
                        className="w-full py-3 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all active:scale-95 mb-3"
                    >
                        Тест API
                    </button>

                    <a href="https://platform.openai.com/usage" target="_blank" className="text-[10px] text-center font-bold text-blue-400 hover:text-blue-600 transition-colors uppercase tracking-widest">
                        Проверить баланс ↗
                    </a>
                </div>

            </div>
        </div>
    );
}
