'use client';

import React, { useEffect, useState } from 'react';

// --- Types ---

interface SyncServiceStatus {
    service: string;
    cursor: string;
    last_run: string | null;
    status: 'ok' | 'warning' | 'error';
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
        if (name.includes('Telphin Backfill')) return 'Телфин (Архив)';
        if (name.includes('RetailCRM')) return 'RetailCRM Заказы';
        if (name.includes('Matching')) return 'Матчинг Звонков';
        return name;
    }

    const getIcon = (name: string) => {
        if (name.includes('Telphin')) return '☎️';
        if (name.includes('RetailCRM')) return '🛍️';
        if (name.includes('Matching')) return '🔗';
        return '⚡️';
    };

    const percent = dbStats && dbStats.matchedCalls ? Math.round((dbStats.transcribedCalls / dbStats.matchedCalls) * 100) : 0;

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
                    <div key={idx} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-lg shadow-gray-200/40 relative overflow-hidden group">

                        <div className={`absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-10 transition-opacity text-6xl -mr-4 -mt-4 select-none grayscale group-hover:grayscale-0`}>
                            {getIcon(service.service)}
                        </div>

                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-3">
                                <div className="text-2xl">{getIcon(service.service)}</div>
                                <div className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border ${getStatusColor(service.status)}`}>
                                    {getStatusLabel(service.status)}
                                </div>
                            </div>

                            <h3 className="text-sm font-black text-gray-900 tracking-tight mb-1 truncate" title={getRusServiceName(service.service)}>
                                {getRusServiceName(service.service)}
                            </h3>
                            <p className="text-[10px] font-medium text-gray-500 mb-3 h-3 truncate">{service.details}</p>

                            <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 mb-2">
                                <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Курсор / Прогресс</div>
                                <div className="text-[10px] font-mono font-bold text-gray-700 truncate" title={service.cursor}>
                                    {service.cursor.replace('T', ' ').replace('Z', '').split('.')[0]}
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-bold text-gray-400 uppercase">Синхронизация</span>
                                <span className="text-[9px] font-bold text-gray-600">
                                    {service.last_run ? new Date(service.last_run).toLocaleString('ru-RU') : '---'}
                                </span>
                            </div>
                        </div>
                    </div>
                )) : (
                    <div className="col-span-full p-6 text-center text-gray-400 font-bold text-xs">
                        {loadingSync ? 'Загрузка...' : 'Нет данных.'}
                    </div>
                )}
            </div>

            {/* SECTION 2: INFRASTRUCTURE (Compact Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Database Stats - Takes 2 cols */}
                <div className="md:col-span-2 bg-white p-5 rounded-2xl border border-gray-100 shadow-lg shadow-blue-200/10 flex flex-col justify-between">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-lg">📊</div>
                        <div>
                            <h3 className="text-sm font-black text-gray-900">Статистика Базы</h3>
                        </div>
                    </div>

                    {loadingStats ? (
                        <div className="animate-pulse space-y-2">
                            <div className="h-8 bg-gray-50 rounded-lg"></div>
                            <div className="h-8 bg-gray-50 rounded-lg"></div>
                        </div>
                    ) : dbStats ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Заказы в работе</span>
                                <span className="text-xl font-black text-gray-900">{dbStats.workingOrders}</span>
                            </div>

                            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Матчи (звонки)</span>
                                <span className="text-xl font-black text-gray-900">{dbStats.matchedCalls}</span>
                            </div>

                            <div className="col-span-2 mt-1">
                                <div className="flex justify-between items-end mb-1">
                                    <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Прогресс Транскрибации</span>
                                    <span className="text-xs font-black text-blue-600">{percent}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-blue-100 rounded-full overflow-hidden mb-1">
                                    <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${percent}%` }}></div>
                                </div>
                                <div className="flex justify-between text-[9px] font-bold text-blue-400 uppercase tracking-wider">
                                    <span>Готово: {dbStats.transcribedCalls}</span>
                                    <span>Очередь: {dbStats.pendingCalls}</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-4 text-gray-400 font-bold text-xs">Нет данных</div>
                    )}
                </div>

                {/* OpenAI Status - Takes 1 col */}
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-lg shadow-green-200/10 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-green-50 text-green-600 rounded-lg flex items-center justify-center text-lg">🤖</div>
                            <h3 className="text-sm font-black text-gray-900">OpenAI</h3>
                        </div>
                        <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest ${openai.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {openai.status === 'ok' ? 'ОНЛАЙН' : 'ОШИБКА'}
                        </div>
                    </div>

                    <div className="flex-1 p-3 bg-gray-50 rounded-xl border border-gray-100 mb-3 flex items-center justify-center text-center">
                        <p className={`text-xs font-bold leading-tight ${openai.status === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
                            {openai.message === 'API Key is valid and active' ? 'Ключ API активен' : openai.message}
                        </p>
                    </div>

                    <button
                        onClick={checkOpenAI}
                        className="w-full py-2 bg-gray-900 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all active:scale-95"
                    >
                        Тест API
                    </button>

                    <a href="https://platform.openai.com/usage" target="_blank" className="text-[9px] text-center text-blue-400 mt-2 hover:underline">
                        Проверить баланс ↗
                    </a>
                </div>

            </div>
        </div>
    );
}
