'use client';

import React, { useEffect, useState } from 'react';

interface ServiceStatus {
    status: 'ok' | 'error' | 'loading';
    message: string;
    code?: string;
}

export default function SystemStatusPage() {
    const [openai, setOpenai] = useState<ServiceStatus>({ status: 'loading', message: 'Проверка...' });
    const [dbStats, setDbStats] = useState<any>(null);
    const [loadingStats, setLoadingStats] = useState(true);

    const checkStatus = async () => {
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

    useEffect(() => {
        checkStatus();
        fetchDbStats();
    }, []);

    const percent = dbStats && dbStats.matchedCalls ? Math.round((dbStats.transcribedCalls / dbStats.matchedCalls) * 100) : 0;

    return (
        <div className="max-w-5xl">
            <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">Статус Систем</h1>
            <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-10">Мониторинг внешних сервисов и базы данных</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

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
                        <button onClick={fetchDbStats} disabled={loadingStats} className="p-2 hover:bg-gray-50 rounded-full transition-colors">
                            <svg className={`w-5 h-5 text-gray-400 ${loadingStats ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        </button>
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
                        <div className="text-center py-10 text-gray-400 font-bold uppercase text-xs">Нет данных</div>
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
                        onClick={checkStatus}
                        className="w-full py-4 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all active:scale-95 shadow-lg shadow-gray-200"
                    >
                        Запустить тест API
                    </button>

                    <p className="mt-6 text-[10px] text-gray-400 text-center font-bold">
                        Баланс пополняется в <a href="https://platform.openai.com/usage" target="_blank" className="text-blue-500 underline hover:text-blue-600">кабинете OpenAI</a>
                    </p>
                </div>

            </div>

            <div className="mt-12 p-8 bg-blue-50 rounded-[40px] border border-blue-100">
                <h4 className="text-blue-900 font-black text-sm uppercase tracking-widest mb-2">Справка</h4>
                <p className="text-blue-800/70 text-sm font-medium leading-relaxed">
                    «Активные заказы» — это заказы в статусах, отмеченных как "В работе".<br />
                    Система автоматически транскрибирует все звонки, связанные с этими заказами. Если progress bar не 100%, значит идет фоновая обработка или закончился баланс.
                </p>
            </div>
        </div>
    );
}
