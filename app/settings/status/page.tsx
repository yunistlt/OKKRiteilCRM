
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
    reason?: string;
    key_preview?: string;
    models?: {
        total: number;
        has_gpt4o_mini: boolean;
        has_whisper: boolean;
    };
    billing_url?: string;
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
        setOpenai(prev => ({ ...prev, status: 'loading', message: 'Проверяем...' }));
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
        <div className="max-w-7xl mx-auto py-1 px-4 space-y-3">

            {/* ALERT: Technical Failure Log */}
            {lastRunError && (
                <div className="bg-red-50 border border-red-500 rounded-xl p-3 shadow-lg">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 bg-red-500 text-white rounded-lg flex items-center justify-center text-lg">🚨</div>
                        <div>
                            <h2 className="text-xs font-black text-red-900 leading-none uppercase">Ошибка Запуска</h2>
                            <p className="text-[9px] text-red-700 font-bold uppercase tracking-wider mt-0.5">{lastRunError.service}</p>
                        </div>
                        <button onClick={() => setLastRunError(null)} className="ml-auto text-red-400 hover:text-red-600 text-[10px] font-bold">ЗАКРЫТЬ</button>
                    </div>
                    <div className="bg-white/50 border border-red-200 rounded-lg p-2 max-h-24 overflow-y-auto">
                        <code className="text-[9px] text-red-800 font-mono whitespace-pre-wrap">
                            {lastRunError.error}
                        </code>
                    </div>
                </div>
            )}

            {/* HEADER & GLOBAL HEALTH */}
            <div className="flex items-center justify-between bg-white px-5 py-2.5 rounded-2xl border border-gray-100 shadow-sm">
                <div>
                    <h1 className="text-lg font-black text-gray-900 tracking-tighter">Системный Монитор</h1>
                    <p className="text-[9px] font-medium text-gray-400 uppercase tracking-tight">Обновлено: {lastUpdated ? lastUpdated.toLocaleTimeString() : '...'}</p>
                </div>

                <div className="flex items-center gap-5">
                    <div className="text-right">
                        <div className="text-[8px] font-black text-gray-300 uppercase tracking-widest">Заказов</div>
                        <div className="text-sm font-black text-gray-900">{dbStats?.workingOrders || 0}</div>
                    </div>
                    <button
                        onClick={() => { fetchSyncStatus(); checkOpenAI(); fetchDbStats(); }}
                        disabled={loadingSync}
                        className="w-8 h-8 bg-gray-900 text-white rounded-lg flex items-center justify-center hover:bg-blue-600 transition-all active:scale-90 text-sm"
                    >
                        {loadingSync ? '...' : '🔄'}
                    </button>
                </div>
            </div>

            {/* OPENAI STATUS CARD */}
            {openai.status !== 'loading' && (
                <div className={`rounded-xl border shadow-sm p-4 relative overflow-hidden transition-all ${openai.status === 'ok'
                        ? 'bg-gradient-to-br from-white to-green-50 border-green-200'
                        : 'bg-gradient-to-br from-white to-red-50 border-red-200'
                    }`}>
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl shadow-inner ${openai.status === 'ok' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                }`}>
                                🧠
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 text-sm">OpenAI API Connection</h3>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <div className={`w-2 h-2 rounded-full ${openai.status === 'ok' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                                    <span className={`text-xs font-semibold uppercase tracking-wide ${openai.status === 'ok' ? 'text-green-700' : 'text-red-700'
                                        }`}>
                                        {openai.status === 'ok' ? 'Connected' : 'Error / Disconnected'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {openai.status === 'ok' && openai.models && (
                            <div className="hidden md:flex flex-col items-end gap-1">
                                <div className="flex gap-1">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${openai.models.has_gpt4o_mini ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>GPT-4o-mini</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${openai.models.has_whisper ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>Whisper</span>
                                </div>
                                <span className="text-[9px] text-gray-400 font-mono">Key: {openai.key_preview}</span>
                            </div>
                        )}

                        {openai.status === 'error' && (
                            <div className="text-right">
                                <div className="bg-red-100 text-red-800 px-2 py-1 rounded text-[10px] font-bold border border-red-200 inline-block mb-1">
                                    {openai.code || 'UNKNOWN ERROR'}
                                </div>
                                {openai.reason === 'insufficient_quota' && (
                                    <div className="text-[10px] font-bold text-red-600 animate-bounce">
                                        Check Balance! 💸
                                    </div>
                                )}
                            </div>
                        )}
                    </div>


                    <div className="mt-3 pt-3 border-t border-gray-100/50 flex justify-between items-center">
                        <p className={`text-xs ${openai.status === 'ok' ? 'text-gray-500' : 'text-red-600 font-medium'}`}>
                            {openai.message}
                        </p>

                        {openai.billing_url && (
                            <a
                                href={openai.billing_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-blue-600 transition-colors"
                            >
                                Manage Billing
                                <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </a>
                        )}
                    </div>
                </div>
            )}

            {/* CORE MONITORING TABLE */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
                <div className="overflow-x-auto text-[10px]">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50 border-b border-gray-100 text-[9px]">
                                <th className="px-5 py-2 font-black text-gray-300 uppercase tracking-widest">Механизм</th>
                                <th className="px-5 py-2 font-black text-gray-300 uppercase tracking-widest text-center">Статус</th>
                                <th className="px-5 py-2 font-black text-gray-300 uppercase tracking-widest">Последний запуск</th>
                                <th className="px-5 py-2 font-black text-gray-300 uppercase tracking-widest">Диагностика</th>
                                <th className="px-5 py-2 font-black text-gray-300 uppercase tracking-widest text-right">Управление</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {syncStatuses.map((s, idx) => {
                                const theme = getStatusTheme(s.status);
                                return (
                                    <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-5 py-2 whitespace-nowrap">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-7 h-7 bg-white rounded shadow-sm border border-gray-100 flex items-center justify-center text-sm">
                                                    {getIcon(s.service)}
                                                </div>
                                                <div>
                                                    <div className="font-black text-gray-900 leading-tight">{getRusServiceName(s.service)}</div>
                                                    <div className="text-[8px] font-bold text-gray-400 uppercase leading-none">{s.service}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-2 text-center">
                                            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${theme.light} ${theme.text} font-black border ${theme.border} text-[8px]`}>
                                                <span className={`w-1 h-1 rounded-full ${theme.bg}`}></span>
                                                {theme.label}
                                            </div>
                                        </td>
                                        <td className="px-5 py-2 whitespace-nowrap font-bold text-gray-600">
                                            {s.last_run ? new Date(s.last_run).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '---'}
                                        </td>
                                        <td className="px-5 py-2 max-w-xs xl:max-w-md">
                                            <div className="truncate font-medium text-gray-500" title={s.reason || s.details}>
                                                {s.reason || s.details}
                                            </div>
                                            {!s.reason && s.cursor && (
                                                <div className="text-[7px] font-mono leading-none text-gray-400 mt-0.5">
                                                    {s.cursor.replace('T', ' ').replace('Z', '').split('.')[0]}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-5 py-2 text-right">
                                            <button
                                                onClick={() => runService(s.service)}
                                                className={`px-3 py-1 rounded-lg font-black uppercase tracking-widest active:scale-95 text-[8px] ${s.status === 'ok' ? 'bg-gray-100 text-gray-800 hover:bg-blue-600 hover:text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                                            >
                                                ▶ ЗАПУСТИТЬ
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">

                {/* RULES INVENTORY - Ultra Compact */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-md p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Реестр Правил (ОКК)</h3>
                        <div className="flex gap-2 text-[8px] font-black">
                            <span className="text-green-600">ВКЛ: {allRules.filter(r => r.is_active).length}</span>
                            <span className="text-gray-300">ВЫКЛ: {allRules.filter(r => !r.is_active).length}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 max-h-[120px] overflow-y-auto pr-1">
                        {allRules.map((rule, idx) => (
                            <div key={idx} className={`px-2 py-1 rounded-lg border flex items-center justify-between gap-2 ${rule.is_active ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="truncate font-bold text-gray-700 text-[9px]">{rule.name}</div>
                                <div className={`text-[7px] font-black uppercase ${rule.is_active ? 'text-green-500' : 'text-gray-400'}`}>
                                    {rule.is_active ? 'ВКЛ' : 'ВЫКЛ'}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Transcription + Stats in one column maybe? No, keep separate but smaller */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-md p-4 flex flex-col justify-between h-full">
                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Транскрибация</h3>
                    <div className="flex items-center justify-between text-[11px] font-black text-purple-600 mb-1">
                        <span>Готово</span>
                        <span>{dbStats ? Math.round((dbStats.transcribedCalls / (dbStats.transcribedCalls + dbStats.pendingCalls || 1)) * 100) : 0}%</span>
                    </div>
                    <div className="w-full h-1 bg-purple-50 rounded-full overflow-hidden mb-3">
                        <div className="h-full bg-purple-500" style={{ width: `${dbStats ? Math.round((dbStats.transcribedCalls / (dbStats.transcribedCalls + dbStats.pendingCalls || 1)) * 100) : 0}%` }}></div>
                    </div>
                    <button onClick={fetchTranscriptionDetails} className="w-full py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[8px] font-black uppercase tracking-widest hover:bg-purple-600 hover:text-white">
                        ОЧЕРЕДЬ
                    </button>
                </div>

                {/* Settings Block - Dense */}
                <div className="bg-gray-900 rounded-2xl p-4 text-white flex flex-col justify-between h-full">
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-[8px] font-black text-gray-500 uppercase">Мин длина (сек)</label>
                            <input
                                type="number"
                                value={minDuration}
                                onChange={(e) => setMinDuration(Number(e.target.value))}
                                className="w-10 bg-gray-800 border-none rounded px-1 py-0.5 text-[10px] font-bold text-white text-right"
                            />
                        </div>
                        <button onClick={saveSettings} className="w-full py-1 bg-blue-600 rounded text-[8px] font-black uppercase">СОХРАНИТЬ</button>
                    </div>
                    <div className="pt-2 border-t border-gray-800">
                        <button
                            onClick={refreshPriorities}
                            disabled={refreshingPriorities}
                            className="w-full py-1.5 bg-white/10 hover:bg-white hover:text-gray-900 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all"
                        >
                            {refreshingPriorities ? '...' : '⚡️ ПРИОРИТЕТЫ'}
                        </button>
                    </div>
                </div>

            </div>

            {/* Modal - same as before but maybe smaller fonts */}
            {showTranscriptionModal && transcriptionDetails && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex items-center justify-center p-4 text-[10px]" onClick={() => setShowTranscriptionModal(false)}>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-5 flex items-center justify-between border-b border-gray-50">
                            <h1 className="text-lg font-black text-gray-900 tracking-tighter uppercase">Очередь Транскрибации</h1>
                            <button onClick={() => setShowTranscriptionModal(false)} className="text-gray-400 hover:text-black font-bold">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <h4 className="font-black text-purple-600 uppercase">В очереди ({transcriptionDetails.queue.length})</h4>
                                {transcriptionDetails.queue.slice(0, 15).map((item: any) => (
                                    <div key={item.id} className="p-2 border border-gray-50 rounded-lg flex justify-between items-center">
                                        <span className="font-black text-gray-800">#{item.order?.number || '??'}</span>
                                        <span className="text-gray-400 font-bold">{item.duration} сек</span>
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-2">
                                <h4 className="font-black text-green-600 uppercase">Готово ({transcriptionDetails.completed.length})</h4>
                                {transcriptionDetails.completed.slice(0, 15).map((item: any) => (
                                    <div key={item.id} className="p-2 border border-gray-50 rounded-lg flex justify-between items-center text-green-600">
                                        <span className="font-black">#{item.order?.number || '??'}</span>
                                        <span className="font-bold">ГОТОВО</span>
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
