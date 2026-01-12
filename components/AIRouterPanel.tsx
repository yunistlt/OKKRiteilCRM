'use client';

import { useState } from 'react';

interface RoutingResult {
    order_id: number;
    from_status: string;
    to_status: string;
    to_status_name?: string;
    confidence: number;
    reasoning: string;
    was_applied: boolean;
    error?: string;
}

interface RoutingSummary {
    total_processed: number;
    applied: number;
    dry_run: boolean;
    status_distribution: Record<string, number>;
}

export default function AIRouterPanel() {
    const [trainingMode, setTrainingMode] = useState(false);
    const [trainingState, setTrainingState] = useState<Record<string, { status: string; comment: string; loading: boolean; done: boolean }>>({});
    const [availableStatuses, setAvailableStatuses] = useState<{ code: string; name: string }[]>([]);

    // Restoring missing state
    const [isRunning, setIsRunning] = useState(false);
    const [dryRun, setDryRun] = useState(true);
    const [limit, setLimit] = useState(10);
    const [results, setResults] = useState<RoutingResult[] | null>(null);
    const [summary, setSummary] = useState<RoutingSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Fetch allowed AI statuses on mount or when mode toggles
    const fetchStatuses = async () => {
        try {
            // We can reuse the status settings API or just fetch from DB via a new simple endpoint
            // For now, let's hardcode the most common ones or try to fetch from an existing one if available.
            // Actually, best to fetch from /api/sync/statuses but that syncs from CRM. 
            // Better to use the database 'status_settings' where is_ai_target is true.
            // But we don't have a direct public endpoint for that list yet.
            // Let's create a quick list or fetch all statuses. 
            // Workaround: We will use the 'otmenen-propala-neobkhodimost' etc as default options 
            // and maybe fetch later if needed. For now I'll include the main ones user cares about.
            const commonStatuses = [
                { code: 'otmenen-propala-neobkhodimost', name: 'Пропала необходимость' },
                { code: 'ne-vyigrali-tender', name: 'Не выиграли тендер' },
                { code: 'zakazchik-ne-vykhodit-na-sviaz', name: 'Заказчик не выходит на связь' },
                { code: 'v-proscete', name: 'В просчете' },
                { code: 'soglasovanie-otmeny', name: 'Согласование отмены' },
                { code: 'otmenyon-klientom', name: 'Отменен клиентом' },
            ];
            setAvailableStatuses(commonStatuses);
        } catch (e) {
            console.error(e);
        }
    };

    const runRouting = async () => {
        setIsRunning(true);
        setError(null);
        setResults(null);
        setSummary(null);

        try {
            const response = await fetch('/api/ai/route-orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun, limit })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Unknown error');
            }

            setResults(data.results || []);
            setSummary(data.summary);

            // Initialize training state for results
            if (data.results) {
                const initial: any = {};
                data.results.forEach((r: any) => {
                    initial[r.order_id] = {
                        status: r.to_status,
                        comment: r.reasoning,
                        loading: false,
                        done: false
                    };
                });
                setTrainingState(initial);
            }

        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsRunning(false);
        }
    };

    const handleTrainApply = async (orderId: number) => {
        const state = trainingState[orderId];
        if (!state) return;

        setTrainingState(prev => ({
            ...prev,
            [orderId]: { ...prev[orderId], loading: true }
        }));

        try {
            const res = await fetch('/api/ai/train-route', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId,
                    targetStatus: state.status,
                    reasoning: state.comment,
                    orderContext: results?.find(r => r.order_id === orderId) || {}
                })
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            setTrainingState(prev => ({
                ...prev,
                [orderId]: { ...prev[orderId], loading: false, done: true }
            }));
        } catch (e: any) {
            alert('Ошибка обучения: ' + e.message);
            setTrainingState(prev => ({
                ...prev,
                [orderId]: { ...prev[orderId], loading: false }
            }));
        }
    };

    const updateTrainingState = (orderId: number, field: 'status' | 'comment', value: string) => {
        setTrainingState(prev => ({
            ...prev,
            [orderId]: { ...prev[orderId], [field]: value }
        }));
    };

    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = {
            'otmenyon-klientom': 'bg-red-100 text-red-800',
            'otmenyon-postavschikom': 'bg-orange-100 text-orange-800',
            'work': 'bg-blue-100 text-blue-800',
            'novyi-1': 'bg-green-100 text-green-800'
        };
        return colors[status] || 'bg-gray-100 text-gray-800';
    };

    const getStatusLabel = (status: string) => {
        const labels: Record<string, string> = {
            'otmenyon-klientom': 'Отменён клиентом',
            'otmenyon-postavschikom': 'Отменён поставщиком',
            'work': 'В работе',
            'novyi-1': 'Новый'
        };
        return labels[status] || status;
    };

    return (
        <div className="w-full bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    🤖 AI Маршрутизация Заказов
                </h2>
                <p className="text-gray-600 mt-2">
                    Автоматическая обработка заказов в статусе "Согласование отмены" (593 заказа)
                </p>
            </div>

            <div className="p-6 space-y-6">
                {/* Controls */}
                <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex flex-col md:flex-row gap-6">
                        {/* Dry Run Toggle */}
                        <div className="flex items-center justify-between gap-4 bg-white p-3 rounded border">
                            <div className="space-y-1">
                                <label className="text-sm font-medium">
                                    Режим тестирования
                                </label>
                                <p className="text-xs text-gray-500">
                                    Без обновлений в CRM
                                </p>
                            </div>
                            <button
                                onClick={() => setDryRun(!dryRun)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${dryRun ? 'bg-blue-600' : 'bg-gray-200'
                                    }`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${dryRun ? 'translate-x-6' : 'translate-x-1'
                                    }`} />
                            </button>
                        </div>

                        {/* Training Mode Toggle */}
                        <div className="flex items-center justify-between gap-4 bg-white p-3 rounded border border-purple-200 shadow-sm">
                            <div className="space-y-1">
                                <label className="text-sm font-bold text-purple-900">
                                    🎓 Режим Обучения
                                </label>
                                <p className="text-xs text-purple-600">
                                    Ручная правка и дообучение
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    setTrainingMode(!trainingMode);
                                    if (!trainingMode) fetchStatuses();
                                }}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${trainingMode ? 'bg-purple-600' : 'bg-gray-200'
                                    }`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${trainingMode ? 'translate-x-6' : 'translate-x-1'
                                    }`} />
                            </button>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">
                                Лимит
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={limit}
                                onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-md"
                            />
                        </div>
                    </div>

                    <button
                        onClick={runRouting}
                        disabled={isRunning}
                        className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isRunning ? 'Обработка...' : '▶ Запустить Анализ'}
                    </button>
                </div>

                {/* Info Banners */}
                {trainingMode && (
                    <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-900">
                        <strong>Режим Обучения включен:</strong> Вы можете вручную корректировать решения ИИ.
                        При нажатии "Подтвердить" статус в RetailCRM обновится, и пример будет сохранен для обучения.
                    </div>
                )}

                {!dryRun && !trainingMode && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                        <strong>Внимание!</strong> Изменения будут применены автоматически.
                    </div>
                )}

                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                        <strong>Ошибка:</strong> {error}
                    </div>
                )}

                {/* Summary */}
                {summary && (
                    <div className="space-y-4">
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex gap-3">
                            <span className="text-green-600">✅</span>
                            <div className="text-sm text-green-800">
                                <strong>Обработано:</strong> {summary.total_processed} заказов
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {Object.entries(summary.status_distribution).map(([status, count]) => (
                                <div key={status} className="p-3 bg-white border rounded-lg">
                                    <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(status)}`}>
                                        {getStatusLabel(status)}
                                    </span>
                                    <p className="text-2xl font-bold mt-2">{count}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Results Table */}
                {results && results.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="font-semibold text-sm text-gray-700">
                            Результаты ({results.length}):
                        </h3>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2 text-left w-20">Заказ</th>
                                        <th className="px-4 py-2 text-left w-48">Решение ИИ</th>
                                        <th className="px-4 py-2 text-left w-20">Conf</th>
                                        <th className="px-4 py-2 text-left">Причина / Комментарий</th>
                                        {trainingMode && <th className="px-4 py-2 w-32">Действие</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((result) => {
                                        const state = trainingState[result.order_id] || {};
                                        return (
                                            <tr key={result.order_id} className={`border-t hover:bg-gray-50 ${state.done ? 'bg-green-50' : ''}`}>
                                                <td className="px-4 py-2 font-mono text-xs">
                                                    <a
                                                        href={`https://zmktlt.retailcrm.ru/orders/${result.order_id}/edit`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:underline"
                                                    >
                                                        #{result.order_id}
                                                    </a>
                                                </td>
                                                <td className="px-4 py-2">
                                                    {trainingMode && !state.done ? (
                                                        <select
                                                            value={state.status}
                                                            onChange={(e) => updateTrainingState(result.order_id, 'status', e.target.value)}
                                                            className="w-full p-1 border rounded text-xs"
                                                        >
                                                            {availableStatuses.map(s => (
                                                                <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                                                            ))}
                                                            {/* User might want to keep original if not in list */}
                                                            {!availableStatuses.find(s => s.code === state.status) && (
                                                                <option value={state.status}>{state.status}</option>
                                                            )}
                                                        </select>
                                                    ) : (
                                                        <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(result.to_status)}`}>
                                                            {result.to_status_name || result.to_status}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2">
                                                    <span className={`font-semibold ${result.confidence >= 0.8 ? 'text-green-600' :
                                                        result.confidence >= 0.6 ? 'text-yellow-600' :
                                                            'text-red-600'
                                                        }`}>
                                                        {(result.confidence * 100).toFixed(0)}%
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2">
                                                    {trainingMode && !state.done ? (
                                                        <textarea
                                                            value={state.comment}
                                                            onChange={(e) => updateTrainingState(result.order_id, 'comment', e.target.value)}
                                                            className="w-full p-1 border rounded text-xs min-h-[60px]"
                                                        />
                                                    ) : (
                                                        <div className="text-xs text-gray-600 max-h-20 overflow-y-auto">
                                                            {result.reasoning}
                                                        </div>
                                                    )}
                                                </td>
                                                {trainingMode && (
                                                    <td className="px-4 py-2 text-center">
                                                        {state.done ? (
                                                            <span className="text-green-600 font-bold">✓ Готово</span>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleTrainApply(result.order_id)}
                                                                disabled={state.loading}
                                                                className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 disabled:opacity-50"
                                                            >
                                                                {state.loading ? '...' : 'Обучить'}
                                                            </button>
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
