'use client';

import { useState, useEffect } from 'react';
import CallInitiator from './calls/CallInitiator';
import CallHistory from './calls/CallHistory';

interface OrderDetailsModalProps {
    orderId: number;
    isOpen: boolean;
    onClose: () => void;
}

interface OrderDetails {
    order: any;
    calls: any[];
    emails: any[];
    history: any[];
    priority?: any; // [NEW] Added priority field
    insights?: any; // [NEW] Added Anna's insights
    raw_payload: any;
}

export default function OrderDetailsModal({ orderId, isOpen, onClose }: OrderDetailsModalProps) {
    const [data, setData] = useState<OrderDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'info' | 'history' | 'ai_audit'>('info');

    useEffect(() => {
        if (isOpen && orderId) {
            fetchDetails();
            setActiveTab('info');
        }
    }, [isOpen, orderId]);

    const [analyzing, setAnalyzing] = useState(false);

    const handleRunAnalysis = async () => {
        if (!orderId) return;
        setAnalyzing(true);
        try {
            const res = await fetch(`/api/orders/${orderId}/analyze`, { method: 'POST' });
            if (!res.ok) throw new Error('Analysis failed');
            await fetchDetails(); // Refresh all data
        } catch (e) {
            console.error(e);
            alert('Ошибка при запуске анализа');
        } finally {
            setAnalyzing(false);
        }
    };

    const fetchDetails = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/details`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">
                            Детали заказа #{orderId}
                        </h2>
                        {data?.order && (
                            <div className="text-xs text-gray-500 mt-1 flex gap-3">
                                <span>Менеджер: <strong>{data.order.manager_name}</strong></span>
                                <span>Сумма: <strong>{data.order.totalsumm?.toLocaleString()} ₽</strong></span>
                                <span>Статус: <strong>{data.order.status}</strong></span>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors"
                    >
                        ✕
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b px-4 bg-white sticky top-0 z-10">
                    <button
                        onClick={() => setActiveTab('info')}
                        className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'info'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Основная информация
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        История изменений
                    </button>
                    <button
                        onClick={() => setActiveTab('ai_audit')}
                        className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'ai_audit'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        👩‍💼 Анна: Аудит
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-gray-50/50">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                    ) : error ? (
                        <div className="p-4 bg-red-50 text-red-600 rounded-lg">
                            Ошибка загрузки: {error}
                        </div>
                    ) : data ? (
                        <>
                            {activeTab === 'info' && (
                                <div className="space-y-6">
                                    {/* ... Existing Info Content ... */}
                                    {/* 1. Transcriptions / Calls */}
                                    <section>
                                        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">
                                            📞 Звонки и Транскрибация
                                        </h3>
                                        {data.calls.length === 0 ? (
                                            <p className="text-sm text-gray-500 italic">Звонков по заказу не найдено.</p>
                                        ) : (
                                            <div className="space-y-4">
                                                {data.calls.map((call: any) => (
                                                    <div key={call.id} className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`px-2 py-0.5 text-[10px] rounded uppercase font-bold ${call.type === 'incoming'
                                                                    ? 'bg-green-100 text-green-700'
                                                                    : 'bg-blue-100 text-blue-700'
                                                                    }`}>
                                                                    {call.type === 'incoming' ? 'Входящий' : 'Исходящий'}
                                                                </span>
                                                                <span className="text-xs text-gray-500">
                                                                    {new Date(call.date).toLocaleString('ru-RU')}
                                                                </span>
                                                                <span className="text-xs text-gray-400">
                                                                    ({Math.floor(call.duration / 60)}м {call.duration % 60}с)
                                                                </span>
                                                            </div>
                                                            {call.link && (
                                                                <a
                                                                    href={call.link}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                                                >
                                                                    🎧 Запись
                                                                </a>
                                                            )}
                                                        </div>

                                                        {call.summary ? (
                                                            <div className="mb-3 p-3 bg-fuchsia-50 rounded border border-fuchsia-100 text-sm text-gray-800">
                                                                <strong className="text-fuchsia-700 text-xs block mb-1">AI Summary:</strong>
                                                                {call.summary}
                                                            </div>
                                                        ) : null}

                                                        {call.transcription ? (
                                                            <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed font-mono bg-gray-50 p-3 rounded border">
                                                                {call.transcription}
                                                            </div>
                                                        ) : (
                                                            <div className="text-xs text-gray-400 italic">
                                                                Транскрибация отсутствует...
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </section>

                                    {/* 2. Call Controls & History (NEW) */}
                                    <section>
                                        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">
                                            ☎️ Управление звонками
                                        </h3>
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            {/* Call Initiator */}
                                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                                                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
                                                    Совершить звонок
                                                </h4>
                                                {data.order?.phone ? (
                                                    <div className="space-y-3">
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-600 mb-1">
                                                                Номер телефона
                                                            </label>
                                                            <input
                                                                type="tel"
                                                                value={data.order.phone}
                                                                readOnly
                                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono"
                                                            />
                                                        </div>
                                                        <CallInitiator
                                                            phoneNumber={data.order.phone}
                                                            managerId={String(data.order.manager_id)}
                                                            orderId={String(orderId)}
                                                            customerName={`${data.raw_payload?.firstName || ''} ${data.raw_payload?.lastName || ''}`.trim()}
                                                        />
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-gray-500 italic">Номер телефона не найден</p>
                                                )}
                                            </div>

                                            {/* Call History */}
                                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                                                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
                                                    История звонков
                                                </h4>
                                                <CallHistory orderId={String(orderId)} limit={5} />
                                            </div>
                                        </div>
                                    </section>

                                    {/* 3. Manager Comments */}
                                    <section>
                                        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">
                                            💬 Комментарии Менеджера
                                        </h3>
                                        {data.raw_payload?.managerComment ? (
                                            <div className="p-4 bg-yellow-50 border border-yellow-100 rounded-lg text-sm text-gray-800">
                                                {data.raw_payload.managerComment}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-gray-500 italic">Комментариев нет.</p>
                                        )}
                                    </section>

                                    {/* 3. Customer Info */}
                                    <section>
                                        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">
                                            👤 Клиент
                                        </h3>
                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                            <div className="p-3 bg-white rounded border border-gray-200">
                                                <span className="text-gray-500 text-xs block">Имя</span>
                                                <span className="font-medium text-gray-900">
                                                    {data.raw_payload?.firstName} {data.raw_payload?.lastName}
                                                </span>
                                            </div>
                                            <div className="p-3 bg-white rounded border border-gray-200">
                                                <span className="text-gray-500 text-xs block">Телефон</span>
                                                <span className="font-medium text-gray-900 font-mono">
                                                    {data.raw_payload?.phone}
                                                </span>
                                            </div>
                                            <div className="p-3 bg-white rounded border border-gray-200 col-span-2">
                                                <span className="text-gray-500 text-xs block">Адрес / Доставка</span>
                                                <span className="font-medium text-gray-900">
                                                    {data.raw_payload?.delivery?.address?.text || 'Не указан'}
                                                </span>
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            )}

                            {activeTab === 'history' && (
                                <section className="space-y-4">
                                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">
                                        📜 История изменений
                                    </h3>
                                    {(!data.history || data.history.length === 0) ? (
                                        <div className="text-center py-8 text-gray-500 text-sm">
                                            История изменений не найдена или еще не синхронизирована.
                                        </div>
                                    ) : (
                                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden text-sm">
                                            <table className="w-full text-left">
                                                <thead className="bg-gray-50 border-b">
                                                    <tr>
                                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Дата</th>
                                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Пользователь</th>
                                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Поле</th>
                                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Старое</th>
                                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Новое</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {data.history.map((h: any, i: number) => (
                                                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                                                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                                                {new Date(h.occurred_at).toLocaleString('ru-RU')}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-800">
                                                                {h.user_data?.firstName} {h.user_data?.lastName}
                                                            </td>
                                                            <td className="px-4 py-3 font-medium text-gray-700">
                                                                {h.field}
                                                            </td>
                                                            <td className="px-4 py-3 text-red-600 bg-red-50/30">
                                                                {h.old_value}
                                                            </td>
                                                            <td className="px-4 py-3 text-green-600 bg-green-50/30">
                                                                {h.new_value}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </section>
                            )}

                            {activeTab === 'ai_audit' && (
                                <section className="space-y-6">
                                    <div className="flex items-center gap-3 mb-6 border-b pb-4">
                                        <img src="/images/agents/anna.png" alt="Anna" className="w-12 h-12 rounded-full border-2 border-purple-100 shadow-sm" />
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-900 leading-tight">
                                                Анна: Проверка качества
                                            </h3>
                                            <p className="text-xs text-purple-600 font-bold uppercase tracking-widest">
                                                Бизнес-аналитик ОКК
                                            </p>
                                        </div>
                                    </div>

                                    {!data.priority ? (
                                        <div className="text-center py-8 text-gray-500 bg-white rounded-lg border border-dashed flex flex-col items-center gap-3">
                                            <p>AI-анализ для этого заказа ещё не проводился.</p>
                                            <button
                                                onClick={handleRunAnalysis}
                                                disabled={analyzing}
                                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium"
                                            >
                                                {analyzing ? (
                                                    <>
                                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                        Анализирую...
                                                    </>
                                                ) : (
                                                    '⚡ Запустить анализ'
                                                )}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-y-6">
                                            {/* Action Bar (Refresh) */}
                                            <div className="flex justify-end">
                                                <button
                                                    onClick={handleRunAnalysis}
                                                    disabled={analyzing}
                                                    className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 disabled:opacity-50"
                                                >
                                                    {analyzing ? (
                                                        <span className="animate-spin">↻</span>
                                                    ) : (
                                                        <span>↻</span>
                                                    )}
                                                    Обновить анализ
                                                </button>
                                            </div>

                                            {/* Verdict Banner */}
                                            <div className={`p-6 rounded-lg border flex items-start gap-4 ${data.priority.level === 'green' ? 'bg-green-50 border-green-200' :
                                                data.priority.level === 'yellow' ? 'bg-yellow-50 border-yellow-200' :
                                                    'bg-red-50 border-red-200'
                                                }`}>
                                                <div className={`text-4xl ${data.priority.level === 'green' ? 'text-green-500' :
                                                    data.priority.level === 'yellow' ? 'text-yellow-500' :
                                                        'text-red-500'
                                                    }`}>
                                                    {data.priority.level === 'green' ? '🟢' :
                                                        data.priority.level === 'yellow' ? '🟡' : '🔴'}
                                                </div>
                                                <div className="flex-1">
                                                    <h4 className="text-lg font-bold text-gray-900 mb-1">
                                                        Вердикт ИИ: {data.priority.summary}
                                                    </h4>
                                                    <p className="text-gray-700 font-medium">
                                                        Рекомендация: {data.priority.recommended_action}
                                                    </p>
                                                    <div className="mt-2 text-xs text-gray-500">
                                                        Score: {data.priority.score} | Last Checked: {new Date(data.priority.updated_at).toLocaleString()}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Anna's Deep Insights (New) */}
                                            {data.insights && (
                                                <div className="bg-white rounded-lg border border-purple-200 overflow-hidden mt-6 shadow-sm">
                                                    <div className="bg-purple-50 px-4 py-3 border-b border-purple-100 flex items-center gap-2">
                                                        <span className="text-purple-600">📊</span>
                                                        <h4 className="text-sm font-bold text-purple-900">Аналитика и Хронология (Анна)</h4>
                                                    </div>
                                                    <div className="p-4 space-y-4">
                                                        {data.insights.summary && (
                                                            <div>
                                                                <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Резюме сделки</h5>
                                                                <p className="text-sm text-gray-800 leading-relaxed font-medium bg-gray-50 p-3 rounded">
                                                                    {data.insights.summary}
                                                                </p>
                                                            </div>
                                                        )}
                                                        {data.insights.dialogue_summary && (
                                                            <div>
                                                                <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Хронология коммуникаций</h5>
                                                                <div className="text-sm text-gray-700 leading-relaxed bg-white border border-gray-100 p-3 rounded italic border-l-4 border-l-purple-400">
                                                                    {data.insights.dialogue_summary}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {data.insights.recommendations && data.insights.recommendations.length > 0 && (
                                                            <div>
                                                                <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Рекомендации</h5>
                                                                <ul className="list-disc list-inside text-sm text-gray-800 bg-green-50/50 p-3 rounded border border-green-100">
                                                                    {data.insights.recommendations.map((rec: string, idx: number) => (
                                                                        <li key={idx} className="mb-1 last:mb-0">{rec}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Analysis Steps (Maxim's Logic) */}
                                            {data.priority.reasons?.analysis_steps && (
                                                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                                    <div className="bg-gray-50 px-4 py-3 border-b flex items-center gap-2">
                                                        <span className="text-gray-500">📋</span>
                                                        <h4 className="text-sm font-bold text-gray-700">Детальный разбор (Логика РОПа)</h4>
                                                    </div>
                                                    <div className="divide-y divide-gray-100">
                                                        <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                                            <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">1. Сумма</div>
                                                            <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.sum_check}</div>
                                                        </div>
                                                        <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                                            <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">2. Товар</div>
                                                            <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.product_check}</div>
                                                        </div>
                                                        <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                                            <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">3. Сверка (Менеджер)</div>
                                                            <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.manager_check}</div>
                                                        </div>
                                                        <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                                            <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">4. История</div>
                                                            <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.history_check}</div>
                                                        </div>
                                                        <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                                            <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">5. Звонки</div>
                                                            <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.calls_check}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </section>
                            )}
                        </>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-gray-50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
}
