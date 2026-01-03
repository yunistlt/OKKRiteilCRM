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
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold">📚 Примеры обучения ИИ</h1>
                    <Link
                        href="/settings/ai"
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 mt-1 transition-colors"
                    >
                        <span>🤖 Настроить системный промпт</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    </Link>
                </div>
                <button
                    onClick={openEvaluationModal}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm transition-all flex items-center gap-2"
                >
                    <span>➕ Оценить новый заказ</span>
                </button>
            </div>

            {/* Stats Widget */}
            <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                    <div className="text-sm text-gray-500">Всего примеров</div>
                    <div className="text-2xl font-bold">{stats.total}</div>
                </div>
                <div className="bg-red-50 p-4 rounded-lg shadow border border-red-200">
                    <div className="text-sm text-red-600">🔴 Критичные</div>
                    <div className="text-2xl font-bold text-red-700">{stats.red}</div>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg shadow border border-yellow-200">
                    <div className="text-sm text-yellow-600">🟡 Внимание</div>
                    <div className="text-2xl font-bold text-yellow-700">{stats.yellow}</div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg shadow border border-green-200">
                    <div className="text-sm text-green-600">🟢 Норма</div>
                    <div className="text-2xl font-bold text-green-700">{stats.green}</div>
                </div>
            </div>

            {/* Filter */}
            <div className="mb-4 flex gap-2">
                <button
                    onClick={() => setFilter('all')}
                    className={`px-3 py-1 rounded ${filter === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`}
                >
                    Все
                </button>
                <button
                    onClick={() => setFilter('red')}
                    className={`px-3 py-1 rounded ${filter === 'red' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}
                >
                    🔴 Красные
                </button>
                <button
                    onClick={() => setFilter('yellow')}
                    className={`px-3 py-1 rounded ${filter === 'yellow' ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-700'}`}
                >
                    🟡 Желтые
                </button>
                <button
                    onClick={() => setFilter('green')}
                    className={`px-3 py-1 rounded ${filter === 'green' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700'}`}
                >
                    🟢 Зеленые
                </button>
            </div>

            {/* Examples List */}
            {loading ? (
                <div className="text-center py-8">Загрузка...</div>
            ) : examples.length === 0 ? (
                <div className="bg-gray-50 p-8 rounded-lg text-center text-gray-500">
                    Нет примеров. Создайте первый пример нажав "Оценить новый заказ"
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Заказ</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Оценка</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Обоснование</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Дата</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Действия</th>
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
                                                className="font-mono font-medium text-blue-600 hover:text-blue-800 hover:underline"
                                            >
                                                #{example.order_number} 🔗
                                            </a>
                                        </div>
                                        <div className="text-xs text-gray-500">ID: {example.order_id}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="text-xl">{trafficLightEmoji(example.traffic_light)}</span>
                                        <span className="ml-2 text-sm">{trafficLightLabel(example.traffic_light)}</span>
                                    </td>
                                    <td className="px-4 py-3 max-w-md">
                                        <div className="text-sm truncate">{example.user_reasoning}</div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-600">
                                        {new Date(example.created_at).toLocaleDateString('ru-RU')}
                                    </td>
                                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={() => handleDeleteExample(example.id)}
                                            className="text-red-600 hover:text-red-800 text-sm opacity-50 group-hover:opacity-100 transition-opacity"
                                        >
                                            🗑️ Удалить
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Evaluation Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold">{editingExampleId ? 'Редактирование примера' : 'Оценка заказа'}</h2>
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="text-gray-500 hover:text-gray-700 text-2xl"
                                >
                                    ×
                                </button>
                            </div>

                            {loadingOrder ? (
                                <div className="text-center py-8">Загрузка заказа...</div>
                            ) : currentOrder ? (
                                <div className="space-y-4">
                                    {/* AI Analysis Card */}
                                    {loadingAI ? (
                                        <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                                            <div className="flex items-center gap-2">
                                                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                                                <span className="text-sm text-blue-700">Анализ ИИ...</span>
                                            </div>
                                        </div>
                                    ) : aiAnalysis ? (
                                        <div className={`p-4 rounded-lg border-2 ${aiAnalysis.traffic_light === 'red' ? 'bg-red-50 border-red-300' :
                                            aiAnalysis.traffic_light === 'yellow' ? 'bg-yellow-50 border-yellow-300' :
                                                'bg-green-50 border-green-300'
                                            }`}>
                                            <div className="flex items-start gap-3">
                                                <span className="text-3xl">
                                                    {aiAnalysis.traffic_light === 'red' ? '🔴' :
                                                        aiAnalysis.traffic_light === 'yellow' ? '🟡' : '🟢'}
                                                </span>
                                                <div className="flex-1">
                                                    <h3 className="font-bold text-lg mb-1">🤖 Первоначальная оценка ИИ</h3>
                                                    <p className="text-sm mb-2">{aiAnalysis.short_reason}</p>
                                                    <div className="bg-white p-2 rounded text-sm border">
                                                        <strong>Рекомендация:</strong> {aiAnalysis.recommended_action}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

                                    {/* Order Info */}
                                    <div className="bg-gray-50 p-4 rounded-lg">
                                        <h3 className="font-bold mb-3">📦 Информация о заказе</h3>
                                        <div className="grid grid-cols-2 gap-3 text-sm">
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
                                            <div>
                                                <span className="text-gray-500">Сумма:</span>
                                                <p className="font-bold">{currentOrder.totalSum.toLocaleString('ru-RU')} ₽</p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">Статус:</span>
                                                <p className="font-medium text-gray-800">{currentOrder.status}</p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">Категория товара:</span>
                                                <p className={currentOrder.productCategory === 'Не указано' ? 'text-gray-400 italic' : 'font-medium text-blue-700'}>
                                                    {currentOrder.productCategory}
                                                </p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">Категория клиента:</span>
                                                <p className={currentOrder.clientCategory === 'Не указано' ? 'text-gray-400 italic' : 'font-medium text-indigo-700'}>
                                                    {currentOrder.clientCategory}
                                                </p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">Способ оформления:</span>
                                                <p className="font-medium text-gray-700">{currentOrder.orderMethod || 'Не указан'}</p>
                                            </div>
                                        </div>

                                        {/* TOP-3 Quality Control Section */}
                                        {currentOrder.top3 && (
                                            <div className="mt-4 pt-4 border-t border-gray-100">
                                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Контроль качества (ТОП-3):</p>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div className={`p-2 rounded border ${currentOrder.top3.price === 'Да' ? 'bg-green-50 border-green-100' : currentOrder.top3.price === 'Нет' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                                                        <p className="text-[10px] text-gray-500 uppercase">По цене</p>
                                                        <p className={`text-xs font-bold ${currentOrder.top3.price === 'Да' ? 'text-green-700' : currentOrder.top3.price === 'Нет' ? 'text-red-700' : 'text-amber-700'}`}>
                                                            {currentOrder.top3.price}
                                                        </p>
                                                    </div>
                                                    <div className={`p-2 rounded border ${currentOrder.top3.timing === 'Да' ? 'bg-green-50 border-green-100' : currentOrder.top3.timing === 'Нет' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                                                        <p className="text-[10px] text-gray-500 uppercase">По срокам</p>
                                                        <p className={`text-xs font-bold ${currentOrder.top3.timing === 'Да' ? 'text-green-700' : currentOrder.top3.timing === 'Нет' ? 'text-red-700' : 'text-amber-700'}`}>
                                                            {currentOrder.top3.timing}
                                                        </p>
                                                    </div>
                                                    <div className={`p-2 rounded border ${currentOrder.top3.specs === 'Да' ? 'bg-green-50 border-green-100' : currentOrder.top3.specs === 'Нет' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                                                        <p className="text-[10px] text-gray-500 uppercase">По характеристикам</p>
                                                        <p className={`text-xs font-bold ${currentOrder.top3.specs === 'Да' ? 'text-green-700' : currentOrder.top3.specs === 'Нет' ? 'text-red-700' : 'text-amber-700'}`}>
                                                            {currentOrder.top3.specs}
                                                        </p>
                                                    </div>
                                                </div>
                                                {(currentOrder.top3.price === 'Не указано' || currentOrder.top3.timing === 'Не указано' || currentOrder.top3.specs === 'Не указано') && (
                                                    <p className="text-[10px] text-amber-600 mt-1 italic">
                                                        ⚠️ Внимание: поля ТОП-3 должны быть заполнены после предложения.
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {/* Comments section */}
                                        <div className="mt-4 border-t pt-3 space-y-3 font-mono text-xs">
                                            {typeof currentOrder.comments === 'object' ? (
                                                <>
                                                    {currentOrder.comments.manager && (
                                                        <div className="bg-white p-2 rounded border border-gray-200">
                                                            <div className="text-gray-400 uppercase mb-1">💬 Комментарий менеджера:</div>
                                                            <div className="whitespace-pre-wrap">{currentOrder.comments.manager}</div>
                                                        </div>
                                                    )}
                                                    {currentOrder.comments.customer && (
                                                        <div className="bg-white p-2 rounded border border-blue-100">
                                                            <div className="text-blue-400 uppercase mb-1">🗣️ Комментарий клиента:</div>
                                                            <div className="whitespace-pre-wrap">{currentOrder.comments.customer}</div>
                                                        </div>
                                                    )}
                                                    {!currentOrder.comments.manager && !currentOrder.comments.customer && (
                                                        <div className="text-gray-400 italic">Нет комментариев к заказу</div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="bg-white p-2 rounded border border-gray-200">
                                                    <div className="text-gray-400 uppercase mb-1">💬 Комментарии:</div>
                                                    <div className="whitespace-pre-wrap">{currentOrder.comments}</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Communication Status */}
                                    <div className="mt-4 pt-4 border-t">
                                        <h4 className="font-semibold text-sm mb-3">📡 Статус коммуникаций</h4>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between items-center text-gray-800">
                                                <span className="text-gray-600">Дней без обновления заказа:</span>
                                                <span className="font-bold text-lg text-orange-600">{currentOrder.daysSinceUpdate}</span>
                                            </div>
                                            <div className="flex justify-between items-center text-gray-800">
                                                <span className="text-gray-600">Всего звонков:</span>
                                                <span className="font-medium">{currentOrder.totalCalls}</span>
                                            </div>
                                            {currentOrder.nextContactDate && (
                                                <div className="flex justify-between items-center bg-blue-50 -mx-2 px-2 py-1 rounded">
                                                    <span className="text-blue-700 font-medium">📅 След. контакт:</span>
                                                    <span className="font-bold text-blue-800">
                                                        {new Date(currentOrder.nextContactDate).toLocaleDateString('ru-RU')}
                                                    </span>
                                                </div>
                                            )}
                                            {currentOrder.lastCall && (
                                                <>
                                                    <div className="flex justify-between items-center text-gray-800">
                                                        <span className="text-gray-600">Последний контакт:</span>
                                                        <span className="font-medium">
                                                            {Math.floor((Date.now() - new Date(currentOrder.lastCall.timestamp).getTime()) / (1000 * 60 * 60 * 24))} дн. назад
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-gray-800">
                                                        <span className="text-gray-600">Способ:</span>
                                                        <span className="font-medium">📞 Телефонный звонок</span>
                                                    </div>
                                                </>
                                            )}
                                            {!currentOrder.lastCall && currentOrder.totalCalls === 0 && (
                                                <div className="bg-yellow-50 border border-yellow-200 p-2 rounded">
                                                    <span className="text-yellow-800 text-xs">⚠️ Нет записей о звонках</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {currentOrder.lastCall && (
                                        <div className="mt-4 pt-4 border-t">
                                            <h4 className="font-semibold text-sm mb-2 text-gray-800">📞 Последний звонок</h4>
                                            <div className="text-xs text-gray-600 mb-2">
                                                📅 {new Date(currentOrder.lastCall.timestamp).toLocaleString('ru-RU')}
                                                {' • '}⏱️ {currentOrder.lastCall.duration}с
                                            </div>
                                            <div className="bg-white p-3 rounded border text-sm max-h-48 overflow-y-auto">
                                                <strong className="text-xs text-gray-500 uppercase">Транскрипт:</strong>
                                                <p className="mt-1 leading-relaxed">{currentOrder.lastCall.transcript}</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Evaluation Selectors */}
                                    <div className="mt-6 pt-6 border-t space-y-4">
                                        <div>
                                            <label className="block font-medium mb-3 text-gray-900">Выберите оценку:</label>
                                            <div className="flex gap-3">
                                                {(['red', 'yellow', 'green'] as const).map((color) => (
                                                    <button
                                                        key={color}
                                                        onClick={() => setSelectedColor(color)}
                                                        className={`flex-1 p-3 rounded-lg border-2 transition-all flex flex-col items-center justify-center ${selectedColor === color
                                                            ? color === 'red' ? 'bg-red-50 border-red-500 shadow-sm' :
                                                                color === 'yellow' ? 'bg-yellow-50 border-yellow-500 shadow-sm' :
                                                                    'bg-green-50 border-green-500 shadow-sm'
                                                            : 'bg-white border-gray-100 hover:border-gray-300'
                                                            }`}
                                                    >
                                                        <span className="text-3xl mb-1">
                                                            {color === 'red' ? '🔴' : color === 'yellow' ? '🟡' : '🟢'}
                                                        </span>
                                                        <span className={`text-xs font-bold uppercase ${selectedColor === color ? 'text-gray-900' : 'text-gray-400'
                                                            }`}>
                                                            {color === 'red' ? 'Критичный' : color === 'yellow' ? 'Внимание' : 'Норма'}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block font-medium mb-2 text-gray-900">Обоснование:</label>
                                            <textarea
                                                value={reasoning}
                                                onChange={(e) => setReasoning(e.target.value)}
                                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-shadow min-h-[120px]"
                                                placeholder="Почему вы выбрали эту оценку? Опишите ключевые факторы..."
                                            />
                                        </div>

                                        <div className="flex justify-end gap-3 pt-2">
                                            <button
                                                onClick={() => setShowModal(false)}
                                                className="px-6 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                                            >
                                                Отмена
                                            </button>
                                            <button
                                                onClick={handleSaveExample}
                                                disabled={saving || !selectedColor || !reasoning.trim()}
                                                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 shadow-md transition-all active:scale-[0.98]"
                                            >
                                                {saving ? 'Сохранение...' : editingExampleId ? 'Обновить пример' : '💾 Сохранить пример'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-12">
                                    <div className="text-red-500 text-lg font-medium mb-2">Не удалось загрузить данные заказа</div>
                                    <button
                                        onClick={() => setShowModal(false)}
                                        className="text-blue-600 hover:underline"
                                    >Вернуться к списку</button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
