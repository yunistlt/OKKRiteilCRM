'use client';

import React, { useEffect, useState } from 'react';

interface ServiceStatus {
    service: string;
    cursor: string;
    last_run: string | null;
    status: 'ok' | 'warning' | 'error';
    details: string;
}

export default function SystemStatusPage() {
    const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchStatus = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/settings/system-status');
            const data = await res.json();
            if (data.dashboard) {
                setStatuses(data.dashboard);
                setLastUpdated(new Date());
            }
        } catch (e) {
            console.error('Failed to fetch status', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, []);

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

    return (
        <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-10">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">Системный Монитор</h1>
                    <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                        Статус синхронизаций и сервисов • Обновлено: {lastUpdated ? lastUpdated.toLocaleTimeString() : '...'}
                    </p>
                </div>
                <button
                    onClick={fetchStatus}
                    disabled={loading}
                    className="px-6 py-3 bg-white border border-gray-200 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                >
                    {loading ? 'Обновление...' : '🔄 Обновить'}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                {statuses.length > 0 ? statuses.map((service, idx) => (
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
                        {loading ? 'Загрузка данных...' : 'Нет данных о сервисах. Проверьте API.'}
                    </div>
                )}
            </div>

            <div className="mt-12 p-8 bg-blue-50/50 rounded-[32px] border border-blue-100/50">
                <h4 className="text-blue-900 font-black text-xs uppercase tracking-widest mb-3">Как это работает?</h4>
                <div className="grid md:grid-cols-2 gap-8 text-xs font-medium text-blue-900/60 leading-relaxed">
                    <p>
                        🟢 <strong>Active</strong>: Сервис работает штатно, данные обновлялись недавно.<br />
                        🟡 <strong>Warning</strong>: Данные не обновлялись более 15 минут (или 1 часа для заказов). Это может быть нормой ночью.
                    </p>
                    <p>
                        <strong>Telphin Backfill</strong>: Может стоять на месте из-за лимитов (429). Это нормально, он продолжит работу сам.<br />
                        <strong>Matching</strong>: Работает в реальном времени или по расписанию.
                    </p>
                </div>
            </div>
        </div>
    );
}
