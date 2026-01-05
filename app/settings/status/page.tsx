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

    const getIcon = (name: string) => {
        if (name.includes('Telphin')) return '☎️';
        if (name.includes('RetailCRM')) return '🛍️';
        if (name.includes('Matching')) return '🔗';
        return '⚡️';
    };

    const percent = dbStats && dbStats.matchedCalls ? Math.round((dbStats.transcribedCalls / dbStats.matchedCalls) * 100) : 0;

    return (
        <div className="max-w-6xl mx-auto py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-10">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">Системный Монитор</h1>
                    <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                        Статус синхронизаций, внешних сервисов и базы данных • Обновлено: {lastUpdated ? lastUpdated.toLocaleTimeString() : '...'}
                    </p>
                </div>
                <button
                    onClick={() => { fetchSyncStatus(); checkOpenAI(); fetchDbStats(); }}
                    disabled={loadingSync || loadingStats}
                    className="px-6 py-3 bg-white border border-gray-200 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                >
                    {loadingSync ? 'Обновление...' : '🔄 Обновить всё'}
                </button>
            </div>

            {/* SECTION 1: SYNC MONITOR (NEW) */}
            <h2 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-6">1. Синхронизация данных</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 mb-16">
                {syncStatuses.length > 0 ? syncStatuses.map((service, idx) => (
                    <div key={idx} className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-xl shadow-gray-200/40 hover:shadow-2xl transition-all duration-300 relative overflow-hidden group">

                        <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-9xl -mr-10 -mt-10 select-none grayscale group-hover:grayscale-0`}>
                            {getIcon(service.service)}
                        </div>

                        <div className="relative z-10">
                            <div className="flex items-start justify-between mb-6">
                                <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center text-3xl shadow-inner">
                                    {getIcon(service.service)}
                                </div>
                                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${getStatusColor(service.status)}`}>
                                    {service.status === 'ok' ? 'ACTIVE' : service.status.toUpperCase()}
                                </div>
                            </div>

                            <h3 className="text-xl font-black text-gray-900 tracking-tight mb-1">{service.service}</h3>
                            <p className="text-sm font-medium text-gray-500 mb-6">{service.details}</p>

                            <div className="space-y-3">
                                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Cursor / Progress</div>
                                    <div className="text-sm font-mono font-bold text-gray-700 truncate" title={service.cursor}>
                                        {service.cursor.replace('T', ' ').replace('Z', '').split('.')[0]}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between px-2">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase">Last Activity</span>
                                    <span className="text-[10px] font-bold text-gray-600">
                                        {service.last_run ? new Date(service.last_run).toLocaleTimeString() : 'Unknown'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                )) : (
                    <div className="col-span-full p-12 text-center text-gray-400 font-bold">
                        {loadingSync ? 'Загрузка монитора...' : 'Нет данных о сервисах.'}
                    </div>
                )}
            </div>

            {/* SECTION 2: INFRASTRUCTURE (LEGACY) */}
            <h2 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-6">2. Инфраструктура и Ресурсы</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">

                {/* Database Health Card */}
                <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-xl shadow-blue-200/20">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl">📊</div>
                            <div>
                                <h3 className="text-xl font-black text-gray-900 tracking-tight">База Данных</h3>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Сводка по рабочим заказам</p>
                            </div>
                        </div>
                    </div>

                    {loadingStats ? (
                        <div className="space-y-4 animate-pulse">
                            <div className="h-20 bg-gray-50 rounded-2xl"></div>
                            <div className="h-20 bg-gray-50 rounded-2xl"></div>
                        </div>
                    ) : dbStats ? (
                        <div className="space-y-6">
                            {/* Metric 1 */}
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Активные заказы</span>
                                <span className="text-2xl font-black text-gray-900">{dbStats.workingOrders}</span>
                            </div>

                            {/* Metric 2 */}
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Матчи (звонки)</span>
                                <span className="text-2xl font-black text-gray-900">{dbStats.matchedCalls}</span>
                            </div>

                            {/* Transcription Progress */}
                            <div className="p-5 bg-blue-50/50 rounded-3xl border border-blue-100">
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Транскрибация</span>
                                    <span className="text-2xl font-black text-blue-600">{percent}%</span>
                                </div>
                                <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden mb-3">
                                    <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${percent}%` }}></div>
                                </div>
                                <div className="flex justify-between text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                                    <span>Готово: {dbStats.transcribedCalls}</span>
                                    <span>Осталось: {dbStats.pendingCalls}</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-10 text-gray-400 font-bold uppercase text-xs">Нет данных статистики</div>
                    )}
                </div>

                {/* OpenAI Card */}
                <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-xl shadow-gray-200/50">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center text-2xl">🤖</div>
                            <div>
                                <h3 className="text-xl font-black text-gray-900 tracking-tight">OpenAI</h3>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Whisper & GPT-4o</p>
                            </div>
                        </div>
                        <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${openai.status === 'ok' ? 'bg-green-100 text-green-700' :
                            openai.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                            }`}>
                            {openai.status === 'ok' ? 'ONLINE' : openai.status === 'error' ? 'ERROR' : 'Checking...'}
                        </div>
                    </div>

                    <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100 mb-6">
                        <p className={`text-sm font-bold ${openai.status === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
                            {openai.message}
                        </p>
                    </div>

                    <button
                        onClick={checkOpenAI}
                        className="w-full py-4 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all active:scale-95 shadow-lg shadow-gray-200"
                    >
                        Запустить тест API
                    </button>

                    <p className="mt-6 text-[10px] text-gray-400 text-center font-bold">
                        Баланс пополняется в <a href="https://platform.openai.com/usage" target="_blank" className="text-blue-500 underline hover:text-blue-600">кабинете OpenAI</a>
                    </p>
                </div>

            </div>

            {/* Help Section */}
            <div className="p-8 bg-blue-50 rounded-[40px] border border-blue-100">
                <h4 className="text-blue-900 font-black text-sm uppercase tracking-widest mb-2">Справка</h4>
                <div className="text-blue-800/70 text-sm font-medium leading-relaxed space-y-4">
                    <p>
                        <strong>Активные заказы</strong> — заказы в статусах "В работе". Система автоматически транскрибирует все звонки по ним.
                    </p>
                    <p>
                        🟢 <strong>Active (Sync)</strong>: Сервис работает штатно.<br />
                        🟡 <strong>Warning (Sync)</strong>: Данные не обновлялись более 15 минут. Для Backfill это норма (лимиты), для Main Sync — повод проверить.
                    </p>
                </div>
            </div>
        </div>
    );
}
