'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface TrainingExample {
    id: number;
    order_id: number;
    order_number: string;
    traffic_light: 'red' | 'yellow' | 'green';
    user_reasoning: string;
    order_context: any;
    created_at: string;
    created_by: string;
}

interface OrderData {
    id: number;
    number: string;
    status: string;
    statusCode: string;
    managerName: string;
    managerId: number;
    totalSum: number;
    daysSinceUpdate: number;
    lastCall: {
        timestamp: string;
        duration: number;
        transcript: string;
        transcriptPreview: string;
    } | null;
    comments: {
        manager: string;
        customer: string;
    } | string;
    productCategory: string;
    clientCategory: string;
    orderMethod: string;
    top3?: {
        price: string;
        timing: string;
        specs: string;
    };
    totalCalls: number;
    createdAt?: string;
    updatedAt?: string;
    nextContactDate?: string | null;
}

interface AIAnalysis {
    traffic_light: 'red' | 'yellow' | 'green';
    short_reason: string;
    recommended_action: string;
}

export default function TrainingExamplesPage() {
    const [examples, setExamples] = useState<TrainingExample[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'red' | 'yellow' | 'green'>('all');
    const [stats, setStats] = useState({ total: 0, red: 0, yellow: 0, green: 0 });

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [loadingOrder, setLoadingOrder] = useState(false);
    const [currentOrder, setCurrentOrder] = useState<OrderData | null>(null);
    const [selectedColor, setSelectedColor] = useState<'red' | 'yellow' | 'green' | null>(null);
    const [reasoning, setReasoning] = useState('');
    const [saving, setSaving] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
    const [loadingAI, setLoadingAI] = useState(false);
    const [editingExampleId, setEditingExampleId] = useState<number | null>(null);

    useEffect(() => {
        fetchExamples();
    }, [filter]);

    async function fetchExamples() {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: '100' });
            if (filter !== 'all') {
                params.set('traffic_light', filter);
            }
            const res = await fetch(`/api/settings/training-examples?${params}`);
            const data = await res.json();
            setExamples(data.examples || []);

            // Calculate stats
            const allRes = await fetch('/api/settings/training-examples?limit=1000');
            const allData = await allRes.json();
            const all = allData.examples || [];
            setStats({
                total: all.length,
                red: all.filter((e: TrainingExample) => e.traffic_light === 'red').length,
                yellow: all.filter((e: TrainingExample) => e.traffic_light === 'yellow').length,
                green: all.filter((e: TrainingExample) => e.traffic_light === 'green').length,
            });
        } catch (e) {
            console.error('Failed to fetch examples:', e);
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteExample(id: number) {
        if (!confirm('Удалить этот пример?')) return;

        try {
            await fetch(`/api/settings/training-examples?id=${id}`, { method: 'DELETE' });
            fetchExamples();
        } catch (e) {
            alert('Не удалось удалить пример');
        }
    }

    async function openEvaluationModal() {
        setLoadingOrder(true);
        setAiAnalysis(null);
        setReasoning('');
        setSelectedColor('green');
        setEditingExampleId(null);
        setShowModal(true);
        setAiAnalysis(null);

        try {
            const res = await fetch('/api/analysis/random-order');
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setCurrentOrder(data);

            // Fetch AI analysis
            fetchAIAnalysis(data);
        } catch (e: any) {
            alert(`Ошибка загрузки заказа: ${e.message}`);
            setShowModal(false);
        } finally {
            setLoadingOrder(false);
        }
    }

    async function handleEditExample(example: TrainingExample) {
        setShowModal(true);
        setLoadingOrder(false); // We already have the order context
        setCurrentOrder(example.order_context);
        setSelectedColor(example.traffic_light);
        setReasoning(example.user_reasoning);
        setEditingExampleId(example.id);
        setAiAnalysis(null); // Clear AI analysis for editing, or re-fetch if desired

        // Optionally re-fetch AI analysis for the current order context if needed
        if (example.order_context) {
            fetchAIAnalysis(example.order_context);
        }
    }

    async function fetchAIAnalysis(order: OrderData) {
        setLoadingAI(true);
        try {
            const res = await fetch('/api/settings/prompts');
            const prompts = await res.json();
            const mainPrompt = prompts.find((p: any) => p.key === 'order_analysis_main');

            const testRes = await fetch('/api/analysis/test-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: mainPrompt?.content,
                    orderId: order.id
                })
            });
            const testData = await testRes.json();
            if (testData.result) {
                setAiAnalysis(testData.result);
            }
        } catch (e) {
            console.error('Failed to fetch AI analysis:', e);
        } finally {
            setLoadingAI(false);
        }
    }

    async function handleSaveExample() {
        if (!currentOrder || !selectedColor || !reasoning.trim()) {
            alert('Выберите цвет светофора и введите обоснование');
            return;
        }

        setSaving(true);
        try {
            const res = await fetch('/api/settings/training-examples', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: editingExampleId,
                    orderId: currentOrder.id,
                    orderNumber: currentOrder.number,
                    trafficLight: selectedColor,
                    userReasoning: reasoning,
                    orderContext: currentOrder,
                    createdBy: 'manual'
                })
            });

            if (!res.ok) throw new Error('Save failed');

            setShowModal(false);
            fetchExamples();
        } catch (e) {
            alert('Не удалось сохранить пример');
        } finally {
            setSaving(false);
        }
    }

    const trafficLightEmoji = (color: string) => {
        switch (color) {
            case 'red': return '🔴';
            case 'yellow': return '🟡';
            case 'green': return '🟢';
            default: return '⚫';
        }
    };

    const trafficLightLabel = (color: string) => {
        switch (color) {
            case 'red': return 'Критичный';
            case 'yellow': return 'Внимание';
            case 'green': return 'Норма';
            default: return 'Неизвестно';
        }
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold">📚 Примеры обучения ИИ</h1>
                    <Link
                        href="/settings/ai"
                        className="text-xs md:text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 mt-1 transition-colors"
                    >
                        <span>🤖 Настроить системный промпт</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    </Link>
                </div>
                <button
                    onClick={openEvaluationModal}
                    className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm transition-all flex items-center justify-center gap-2 text-sm md:text-base"
                >
                    <span>➕ Оценить заказ</span>
                </button>
            </div>

            {/* Stats Widget */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
                <div className="bg-white p-3 md:p-4 rounded-lg shadow border border-gray-200">
                    <div className="text-[10px] md:text-sm text-gray-500">Всего</div>
                    <div className="text-xl md:text-2xl font-bold">{stats.total}</div>
                </div>
                <div className="bg-red-50 p-3 md:p-4 rounded-lg shadow border border-red-200">
                    <div className="text-[10px] md:text-sm text-red-600">🔴 Критичные</div>
                    <div className="text-xl md:text-2xl font-bold text-red-700">{stats.red}</div>
                </div>
                <div className="bg-yellow-50 p-3 md:p-4 rounded-lg shadow border border-yellow-200">
                    <div className="text-[10px] md:text-sm text-yellow-600">🟡 Внимание</div>
                    <div className="text-xl md:text-2xl font-bold text-yellow-700">{stats.yellow}</div>
                </div>
                <div className="bg-green-50 p-3 md:p-4 rounded-lg shadow border border-green-200">
                    <div className="text-[10px] md:text-sm text-green-600">🟢 Норма</div>
                    <div className="text-xl md:text-2xl font-bold text-green-700">{stats.green}</div>
                </div>
            </div>

            {/* Filter */}
            <div className="mb-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                <button
                    onClick={() => setFilter('all')}
                    className={`shrink-0 px-3 py-1 rounded text-xs md:text-sm transition-colors ${filter === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
                >
                    Все
                </button>
                <button
                    onClick={() => setFilter('red')}
                    className={`shrink-0 px-3 py-1 rounded text-xs md:text-sm transition-colors ${filter === 'red' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                >
                    🔴 Красные
                </button>
                <button
                    onClick={() => setFilter('yellow')}
                    className={`shrink-0 px-3 py-1 rounded text-xs md:text-sm transition-colors ${filter === 'yellow' ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'}`}
                >
                    🟡 Желтые
                </button>
                <button
                    onClick={() => setFilter('green')}
                    className={`shrink-0 px-3 py-1 rounded text-xs md:text-sm transition-colors ${filter === 'green' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                >
                    🟢 Зеленые
                </button>
            </div>

            {/* Examples List */}
            {loading ? (
                <div className="text-center py-8">Загрузка...</div>
            ) : examples.length === 0 ? (
                <div className="bg-gray-50 p-8 rounded-lg text-center text-gray-500 text-sm">
                    Нет примеров. Создайте первый пример нажав "Оценить новый заказ"
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[700px]">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="px-4 py-3 text-xs md:text-sm font-medium text-gray-700">Заказ</th>
                                    <th className="px-4 py-3 text-xs md:text-sm font-medium text-gray-700">Оценка</th>
                                    <th className="px-4 py-3 text-xs md:text-sm font-medium text-gray-700">Обоснование</th>
                                    <th className="px-4 py-3 text-xs md:text-sm font-medium text-gray-700">Дата</th>
                                    <th className="px-4 py-3 text-xs md:text-sm font-medium text-gray-700 text-center">Действия</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {examples.map((example) => (
                                    <tr
                                        key={example.id}
                                        className="hover:bg-gray-50 cursor-pointer group"
                                        onClick={() => handleEditExample(example)}
                                    >
                                        <td className="px-4 py-3">
                                            <div onClick={(e) => e.stopPropagation()}>
                                                <a
                                                    href={`https://zmktlt.retailcrm.ru/orders/${example.order_number}/edit`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-mono font-bold text-blue-600 hover:text-blue-800 hover:underline text-xs md:text-sm"
                                                >
                                                    #{example.order_number} 🔗
                                                </a>
                                            </div>
                                            <div className="text-[10px] text-gray-400">ID: {example.order_id}</div>
                                        </td>
                                        <td className="px-4 py-3 shrink-0 whitespace-nowrap">
                                            <span className="text-lg md:text-xl">{trafficLightEmoji(example.traffic_light)}</span>
                                            <span className="ml-2 text-xs md:text-sm">{trafficLightLabel(example.traffic_light)}</span>
                                        </td>
                                        <td className="px-4 py-3 max-w-xs md:max-w-md">
                                            <div className="text-xs md:text-sm truncate">{example.user_reasoning}</div>
                                        </td>
                                        <td className="px-4 py-3 text-[10px] md:text-sm text-gray-600 whitespace-nowrap">
                                            {new Date(example.created_at).toLocaleDateString('ru-RU')}
                                        </td>
                                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => handleDeleteExample(example.id)}
                                                className="text-red-600 hover:text-red-800 text-xs md:opacity-50 group-hover:opacity-100 transition-opacity"
                                            >
                                                🗑️ <span className="hidden md:inline">Удалить</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Evaluation Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[95vh] overflow-y-auto">
                        <div className="p-4 md:p-6">
                            <div className="flex justify-between items-center mb-6 border-b pb-4">
                                <h2 className="text-lg md:text-xl font-bold">{editingExampleId ? 'Редактирование примера' : 'Оценка заказа'}</h2>
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="text-gray-500 hover:text-gray-700 text-2xl"
                                >
                                    ×
                                </button>
                            </div>

                            {loadingOrder ? (
                                <div className="text-center py-12">
                                    <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                                    <p className="text-gray-500 font-medium">Загрузка заказа...</p>
                                </div>
                            ) : currentOrder ? (
                                <div className="space-y-6">
                                    {/* AI Analysis Card */}
                                    {loadingAI ? (
                                        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl">
                                            <div className="flex items-center gap-3">
                                                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                                                <span className="text-xs md:text-sm text-blue-700 font-medium">Анализ ИИ...</span>
                                            </div>
                                        </div>
                                    ) : aiAnalysis ? (
                                        <div className={`p-4 rounded-xl border-2 ${aiAnalysis.traffic_light === 'red' ? 'bg-red-50 border-red-300' :
                                            aiAnalysis.traffic_light === 'yellow' ? 'bg-yellow-50 border-yellow-300' :
                                                'bg-green-50 border-green-300'
                                            }`}>
                                            <div className="flex flex-col sm:flex-row items-start gap-4">
                                                <span className="text-3xl md:text-4xl">
                                                    {aiAnalysis.traffic_light === 'red' ? '🔴' :
                                                        aiAnalysis.traffic_light === 'yellow' ? '🟡' : '🟢'}
                                                </span>
                                                <div className="flex-1">
                                                    <h3 className="font-bold text-base md:text-lg mb-1">🤖 Первоначальная оценка ИИ</h3>
                                                    <p className="text-xs md:text-sm mb-3 text-gray-800 leading-relaxed">{aiAnalysis.short_reason}</p>
                                                    <div className="bg-white p-3 rounded-lg text-xs md:text-sm border border-gray-100 shadow-sm">
                                                        <strong className="text-gray-500">Рекомендация:</strong> {aiAnalysis.recommended_action}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

                                    {/* Order Info */}
                                    <div className="bg-gray-50/50 p-4 md:p-6 rounded-xl border border-gray-100">
                                        <h3 className="font-bold mb-4 text-sm md:text-base border-b border-gray-100 pb-2">📦 Информация о заказе</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs md:text-sm">
                                            <div>
                                                <span className="text-gray-500">Номер:</span>
                                                <a
                                                    href={`https://zmktlt.retailcrm.ru/orders/${currentOrder.number}/edit`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-mono font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer ml-1"
                                                >
                                                    #{currentOrder.number} 🔗
                                                </a>
                                            </div>
                                            <div className="flex justify-between sm:block">
                                                <span className="text-gray-500 sm:inline-block">Сумма:</span>
                                                <p className="font-bold sm:inline-block sm:ml-1">{currentOrder.totalSum?.toLocaleString('ru-RU')} ₽</p>
                                            </div>
                                            <div className="flex justify-between sm:block">
                                                <span className="text-gray-500 block">Статус:</span>
                                                <p className="font-medium text-gray-800">{currentOrder.status}</p>
                                            </div>
                                            <div className="flex justify-between sm:block">
                                                <span className="text-gray-500 block">Категория товара:</span>
                                                <p className={currentOrder.productCategory === 'Не указано' ? 'text-gray-400 italic' : 'font-medium text-blue-700'}>
                                                    {currentOrder.productCategory}
                                                </p>
                                            </div>
                                            <div className="flex justify-between sm:block">
                                                <span className="text-gray-500 block">Категория клиента:</span>
                                                <p className={currentOrder.clientCategory === 'Не указано' ? 'text-gray-400 italic' : 'font-medium text-indigo-700'}>
                                                    {currentOrder.clientCategory}
                                                </p>
                                            </div>
                                            <div className="flex justify-between sm:block">
                                                <span className="text-gray-500 block">Способ оформления:</span>
                                                <p className="font-medium text-gray-700">{currentOrder.orderMethod || 'Не указан'}</p>
                                            </div>
                                        </div>

                                        {/* TOP-3 Quality Control Section */}
                                        {currentOrder.top3 && (
                                            <div className="mt-6 pt-6 border-t border-gray-100">
                                                <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 text-center sm:text-left">Контроль качества (ТОП-3):</p>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div className={`p-2 rounded-lg border text-center ${currentOrder.top3.price === 'Да' ? 'bg-green-50 border-green-100' : currentOrder.top3.price === 'Нет' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                                                        <p className="text-[8px] md:text-[10px] text-gray-400 uppercase mb-1">По цене</p>
                                                        <p className={`text-[10px] md:text-xs font-bold ${currentOrder.top3.price === 'Да' ? 'text-green-700' : currentOrder.top3.price === 'Нет' ? 'text-red-700' : 'text-amber-700'}`}>
                                                            {currentOrder.top3.price}
                                                        </p>
                                                    </div>
                                                    <div className={`p-2 rounded-lg border text-center ${currentOrder.top3.timing === 'Да' ? 'bg-green-50 border-green-100' : currentOrder.top3.timing === 'Нет' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                                                        <p className="text-[8px] md:text-[10px] text-gray-400 uppercase mb-1">По срокам</p>
                                                        <p className={`text-[10px] md:text-xs font-bold ${currentOrder.top3.timing === 'Да' ? 'text-green-700' : currentOrder.top3.timing === 'Нет' ? 'text-red-700' : 'text-amber-700'}`}>
                                                            {currentOrder.top3.timing}
                                                        </p>
                                                    </div>
                                                    <div className={`p-2 rounded-lg border text-center ${currentOrder.top3.specs === 'Да' ? 'bg-green-50 border-green-100' : currentOrder.top3.specs === 'Нет' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                                                        <p className="text-[8px] md:text-[10px] text-gray-400 uppercase mb-1">По хар-кам</p>
                                                        <p className={`text-[10px] md:text-xs font-bold ${currentOrder.top3.specs === 'Да' ? 'text-green-700' : currentOrder.top3.specs === 'Нет' ? 'text-red-700' : 'text-amber-700'}`}>
                                                            {currentOrder.top3.specs}
                                                        </p>
                                                    </div>
                                                </div>
                                                {(currentOrder.top3.price === 'Не указано' || currentOrder.top3.timing === 'Не указано' || currentOrder.top3.specs === 'Не указано') && (
                                                    <p className="text-[10px] text-amber-600 mt-2 italic text-center sm:text-left">
                                                        ⚠️ Поля ТОП-3 должны быть заполнены.
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {/* Comments section */}
                                        <div className="mt-6 border-t border-gray-100 pt-4 space-y-3 font-mono text-[10px] md:text-xs">
                                            {typeof currentOrder.comments === 'object' ? (
                                                <>
                                                    {currentOrder.comments.manager && (
                                                        <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                                            <div className="text-gray-400 uppercase mb-1 text-[9px]">💬 Комментарий менеджера:</div>
                                                            <div className="whitespace-pre-wrap leading-relaxed">{currentOrder.comments.manager}</div>
                                                        </div>
                                                    )}
                                                    {currentOrder.comments.customer && (
                                                        <div className="bg-white p-3 rounded-lg border border-blue-50 shadow-sm">
                                                            <div className="text-blue-400 uppercase mb-1 text-[9px]">🗣️ Комментарий клиента:</div>
                                                            <div className="whitespace-pre-wrap leading-relaxed">{currentOrder.comments.customer}</div>
                                                        </div>
                                                    )}
                                                    {!currentOrder.comments.manager && !currentOrder.comments.customer && (
                                                        <div className="text-gray-400 italic text-center py-2">Нет комментариев к заказу</div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                                    <div className="text-gray-400 uppercase mb-1 text-[9px]">💬 Комментарии:</div>
                                                    <div className="whitespace-pre-wrap leading-relaxed">{currentOrder.comments}</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Communication Status */}
                                    <div className="mt-6 pt-6 border-t border-gray-100">
                                        <h4 className="font-semibold text-sm mb-4 text-center sm:text-left uppercase tracking-widest text-gray-500">📡 Статус коммуникаций</h4>
                                        <div className="space-y-3 text-xs md:text-sm">
                                            <div className="flex justify-between items-center text-gray-800">
                                                <span className="text-gray-600">Дней без обновления:</span>
                                                <span className="font-bold text-base md:text-lg text-orange-600">{currentOrder.daysSinceUpdate}</span>
                                            </div>
                                            <div className="flex justify-between items-center text-gray-800">
                                                <span className="text-gray-600">Всего звонков:</span>
                                                <span className="font-medium border-b border-dotted border-gray-300">{currentOrder.totalCalls}</span>
                                            </div>
                                            {currentOrder.nextContactDate && (
                                                <div className="flex justify-between items-center bg-blue-50/50 -mx-2 px-3 py-2 rounded-lg">
                                                    <span className="text-blue-700 font-medium">📅 След. контакт:</span>
                                                    <span className="font-bold text-blue-800">
                                                        {new Date(currentOrder.nextContactDate).toLocaleDateString('ru-RU')}
                                                    </span>
                                                </div>
                                            )}
                                            {currentOrder.lastCall && (
                                                <>
                                                    <div className="flex justify-between items-center text-gray-800 border-t border-gray-50 pt-2">
                                                        <span className="text-gray-600">Последний контакт:</span>
                                                        <span className="font-medium bg-gray-100 px-2 py-0.5 rounded text-[10px] md:text-xs">
                                                            {Math.floor((Date.now() - new Date(currentOrder.lastCall.timestamp).getTime()) / (1000 * 60 * 60 * 24))} дн. назад
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                            {!currentOrder.lastCall && currentOrder.totalCalls === 0 && (
                                                <div className="bg-yellow-50 border border-yellow-100 p-3 rounded-xl text-center">
                                                    <span className="text-yellow-800 text-xs font-medium">⚠️ Нет записей о звонках</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {currentOrder.lastCall && (
                                        <div className="mt-6 pt-6 border-t border-gray-100">
                                            <h4 className="font-semibold text-xs md:text-sm mb-3 text-gray-800 uppercase tracking-widest text-center sm:text-left">📞 Последний звонок</h4>
                                            <div className="text-[10px] text-gray-400 mb-3 text-center sm:text-left font-mono">
                                                📅 {new Date(currentOrder.lastCall.timestamp).toLocaleString('ru-RU')}
                                                {' • '}⏱️ {currentOrder.lastCall.duration}с
                                            </div>
                                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 text-xs md:text-sm max-h-64 overflow-y-auto shadow-inner">
                                                <strong className="text-[9px] text-gray-400 uppercase block mb-2">Транскрипт:</strong>
                                                <p className="leading-relaxed text-gray-700 italic">"{currentOrder.lastCall.transcript}"</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Evaluation Selectors */}
                                    <div className="mt-8 pt-8 border-t-2 border-dashed border-gray-100 space-y-6">
                                        <div>
                                            <label className="block text-sm md:text-base font-bold mb-4 text-gray-900 text-center sm:text-left uppercase tracking-tight">ВАША КОНЕЧНАЯ ОЦЕНКА:</label>
                                            <div className="flex gap-2 sm:gap-4">
                                                {(['red', 'yellow', 'green'] as const).map((color) => (
                                                    <button
                                                        key={color}
                                                        onClick={() => setSelectedColor(color)}
                                                        className={`flex-1 p-3 md:p-4 rounded-xl border-2 transition-all flex flex-col items-center justify-center ${selectedColor === color
                                                            ? color === 'red' ? 'bg-red-50 border-red-500 shadow-md ring-4 ring-red-500/10' :
                                                                color === 'yellow' ? 'bg-yellow-50 border-yellow-500 shadow-md ring-4 ring-yellow-500/10' :
                                                                    'bg-green-50 border-green-500 shadow-md ring-4 ring-green-500/10'
                                                            : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50/30'
                                                            }`}
                                                    >
                                                        <span className="text-2xl md:text-3xl mb-1">
                                                            {color === 'red' ? '🔴' : color === 'yellow' ? '🟡' : '🟢'}
                                                        </span>
                                                        <span className={`text-[9px] md:text-xs font-black uppercase tracking-widest ${selectedColor === color ? 'text-gray-900' : 'text-gray-400'
                                                            }`}>
                                                            {color === 'red' ? 'Крит' : color === 'yellow' ? 'Вним' : 'Норм'}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="block text-xs md:text-sm font-bold text-gray-700 uppercase tracking-widest">Обоснование специалиста:</label>
                                            <textarea
                                                value={reasoning}
                                                onChange={(e) => setReasoning(e.target.value)}
                                                className="w-full p-4 border border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all min-h-[140px] text-sm md:text-base leading-relaxed"
                                                placeholder="Почему вы выбрали эту оценку? Какие детали в звонке или истории заказа повлияли на решение?"
                                            />
                                        </div>

                                        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 pb-2">
                                            <button
                                                onClick={() => setShowModal(false)}
                                                className="px-8 py-3 border border-gray-200 rounded-xl font-bold text-gray-500 hover:bg-gray-50 transition-all text-sm uppercase tracking-widest"
                                            >
                                                Отмена
                                            </button>
                                            <button
                                                onClick={handleSaveExample}
                                                disabled={saving || !selectedColor || !reasoning.trim()}
                                                className="px-8 py-3 bg-blue-600 text-white rounded-xl font-black hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-200 transition-all active:scale-[0.98] text-sm uppercase tracking-widest"
                                            >
                                                {saving ? 'Сохранение...' : editingExampleId ? 'Обновить пример' : '💾 Сохранить в БД'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-20">
                                    <div className="text-red-500 text-lg font-bold mb-4 uppercase tracking-widest">⚠️ Ошибка загрузки данных</div>
                                    <button
                                        onClick={() => setShowModal(false)}
                                        className="bg-gray-100 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition-all font-bold text-sm uppercase"
                                    >Вернуться назад</button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
