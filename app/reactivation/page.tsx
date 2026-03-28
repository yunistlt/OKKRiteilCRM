'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { OutreachLog } from '@/lib/reactivation-db';

export default function ReactivationDashboard() {
    const [activeTab, setActiveTab] = useState<'drafts' | 'sent' | 'rejected'>('drafts');
    const [logs, setLogs] = useState<OutreachLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            // В реальном приложении здесь будет API эндпоинт для получения логов по статусу
            // Для теста мы можем использовать универсальный эндпоинт или фильтрацию на фронте
            const res = await fetch(`/api/reactivation/logs?status=${activeTab === 'drafts' ? 'awaiting_approval' : activeTab}`);
            const data = await res.json();
            if (data.success) {
                setLogs(data.logs);
            }
        } catch (e) {
            console.error('Failed to fetch logs', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [activeTab]);

    const handleAction = async (id: string, action: 'approve' | 'reject') => {
        setProcessingId(id);
        try {
            const res = await fetch(`/api/reactivation/logs/${id}/${action}`, { method: 'POST' });
            if (res.ok) {
                setLogs(prev => prev.filter(l => l.id !== id));
            }
        } catch (e) {
            console.error(`Action ${action} failed`, e);
        } finally {
            setProcessingId(null);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-gray-100 px-8 py-6 flex items-center justify-between sticky top-0 z-10 shadow-sm">
                <div className="flex items-center gap-4">
                    <Link href="/" className="w-10 h-10 bg-gray-900 text-white rounded-xl flex items-center justify-center text-xl hover:scale-110 transition-transform">
                        ⬅️
                    </Link>
                    <div>
                        <h1 className="text-2xl font-black text-gray-900 tracking-tight">Агент Виктория: Согласование</h1>
                        <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mt-1">B2B Реактивация // Контроль качества</p>
                    </div>
                </div>

                <div className="flex bg-gray-100 p-1 rounded-2xl border border-gray-200">
                    {(['drafts', 'sent', 'rejected'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                                activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                            }`}
                        >
                            {tab === 'drafts' ? '📥 Очередь (Черновики)' : tab === 'sent' ? '📤 Отправлено' : '🗑️ Отклонено'}
                        </button>
                    ))}
                </div>
            </header>

            {/* Content */}
            <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-pulse">
                        {[1, 2, 3, 4].map(i => <div key={i} className="h-64 bg-white rounded-3xl border border-gray-100"></div>)}
                    </div>
                ) : logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center text-4xl shadow-xl mb-6">✨</div>
                        <h2 className="text-xl font-bold text-gray-900">Очередь пуста</h2>
                        <p className="text-gray-500 mt-2 max-w-xs px-4">Виктория пока не подготовила новых черновиков для согласования.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {logs.map(log => (
                            <div key={log.id} className="bg-white rounded-[32px] border border-gray-100 shadow-2xl shadow-indigo-100/20 overflow-hidden flex flex-col group hover:border-indigo-200 transition-all duration-500">
                                {/* Top Bar */}
                                <div className="p-6 pb-4 flex items-start justify-between border-b border-gray-50">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-indigo-50 text-indigo-500 rounded-2xl flex items-center justify-center text-xl font-bold">
                                            🏢
                                        </div>
                                        <div>
                                            <h3 className="font-black text-gray-900 text-lg leading-tight">{log.company_name}</h3>
                                            <div className="flex gap-2 mt-1">
                                                <span className="text-[9px] font-black uppercase tracking-widest bg-gray-50 text-gray-400 px-2 py-0.5 rounded-md border border-gray-100">
                                                    ID {log.customer_id}
                                                </span>
                                                <span className="text-[9px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md border border-blue-100">
                                                    B2B Client
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1">Создано</div>
                                        <div className="text-xs font-bold text-gray-500">{new Date(log.created_at || '').toLocaleDateString()}</div>
                                    </div>
                                </div>

                                {/* AI Justification Section */}
                                <div className="p-6 bg-indigo-50/30">
                                    <div className="flex items-start gap-4">
                                        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg border border-indigo-100 flex-shrink-0">
                                            <img src="/images/agents/victoria.png" alt="Victoria" className="w-8 h-8 rounded-full" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-2">Почему я выбрала этого клиента:</div>
                                            <div className="bg-white p-4 rounded-2xl border border-indigo-100 text-sm font-medium text-gray-700 italic leading-relaxed shadow-sm">
                                                {log.justification || "Обоснование не сформировано"}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Email Content Preview */}
                                <div className="p-6 flex-1 flex flex-col">
                                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Текст письма:</div>
                                    <div className="bg-gray-50 rounded-2xl p-5 text-sm text-gray-600 leading-relaxed font-medium whitespace-pre-wrap border border-gray-100 flex-1 max-h-64 overflow-y-auto">
                                        {log.generated_email}
                                    </div>
                                </div>

                                {/* Actions */}
                                {activeTab === 'drafts' && (
                                    <div className="p-6 pt-0 flex gap-4">
                                        <button
                                            onClick={() => handleAction(log.id, 'approve')}
                                            disabled={!!processingId}
                                            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-black uppercase text-xs tracking-[0.2em] py-4 rounded-2xl shadow-xl shadow-indigo-200 transition-all flex items-center justify-center gap-2 hover:-translate-y-1"
                                        >
                                            {processingId === log.id ? "⌛ Секунду..." : "✅ Одобрить и отправить"}
                                        </button>
                                        <button
                                            onClick={() => handleAction(log.id, 'reject')}
                                            disabled={!!processingId}
                                            className="px-6 bg-white border-2 border-red-50 text-red-400 hover:border-red-100 hover:text-red-500 font-black uppercase text-xs tracking-[0.2em] py-4 rounded-2xl transition-all"
                                        >
                                            🗑️ В корзину
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
