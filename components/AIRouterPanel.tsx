'use client';

import { useState, useEffect } from 'react';
import type { PanelOrder } from './OKKConsultantPanel';
import OrderDetailsModal from './OrderDetailsModal';

interface RoutingResult {
    order_id: number;
    from_status: string;
    current_status_name?: string;
    current_status_color?: string;
    total_sum?: number;
    retail_crm_url?: string;
    to_status: string;
    to_status_name?: string;
    confidence: number;
    reasoning: string;
    was_applied: boolean;
    error?: string;
    // Дополнительные поля
    manager_name?: string;
    country?: string;
    category?: string;
    purchase_form?: string;
    sphere?: string;
    client_comment?: string;
    manager_comment?: string;
    logistic_comment?: string;
}

interface RoutingSummary {
    total_processed: number;
    total_pending_count?: number;
    applied: number;
    dry_run: boolean;
    status_distribution: Record<string, number>;
}

export default function AIRouterPanel({ onConsultantOrderChange }: { onConsultantOrderChange?: (order: PanelOrder | null) => void }) {
    const [trainingMode, setTrainingMode] = useState(false);
    const [trainingState, setTrainingState] = useState<Record<string, { status: string; comment: string; loading: boolean; done: boolean }>>({});
    const [availableStatuses, setAvailableStatuses] = useState<{ code: string; name: string; group_name?: string; color?: string }[]>([]);

    // Restoring missing state
    const [isRunning, setIsRunning] = useState(false);
    const [dryRun, setDryRun] = useState(true);
    const [limit, setLimit] = useState(10);
    const [results, setResults] = useState<RoutingResult[] | null>(null);
    const [summary, setSummary] = useState<RoutingSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pendingCount, setPendingCount] = useState<number | null>(null);

    // Hydration fix
    const [isMounted, setIsMounted] = useState(false);

    // Fetch allowed AI statuses on mount or when mode toggles
    const fetchStatuses = async () => {
        try {
            const res = await fetch('/api/dict/statuses');
            const data = await res.json();
            if (Array.isArray(data)) {
                setAvailableStatuses(data);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchPendingCount = async () => {
        try {
            const res = await fetch('/api/ai/route-orders');
            const data = await res.json();
            if (data.success && typeof data.count === 'number') {
                setPendingCount(data.count);
            }
        } catch (e) {
            console.error('Failed to fetch pending count:', e);
        }
    };

    // Initial fetch
    useEffect(() => {
        setIsMounted(true);
        fetchStatuses();
        fetchPendingCount();
    }, []);

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
        const found = availableStatuses.find(s => s.code === status);
        if (found) return found.name;

        const labels: Record<string, string> = {
            'otmenyon-klientom': 'Отменён клиентом',
            'otmenyon-postavschikom': 'Отменён поставщиком',
            'work': 'В работе',
            'novyi-1': 'Новый'
        };
        return labels[status] || status;
    };

    // State for Modal
    const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
    const [consultantOrderId, setConsultantOrderId] = useState<number | null>(null);

    // Column Visibility State
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
    const [showColumnSettings, setShowColumnSettings] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('ai_router_hidden_columns');
        if (saved) {
            try {
                setHiddenColumns(new Set(JSON.parse(saved)));
            } catch (e) {
                console.error('Failed to parse hidden columns:', e);
            }
        }
    }, []);

    useEffect(() => {
        if (!results || results.length === 0) {
            setConsultantOrderId(null);
            onConsultantOrderChange?.(null);
            return;
        }

        const nextConsultantOrderId = consultantOrderId && results.some((item) => item.order_id === consultantOrderId)
            ? consultantOrderId
            : results[0].order_id;

        setConsultantOrderId(nextConsultantOrderId);

        const selectedResult = results.find((item) => item.order_id === nextConsultantOrderId) || null;
        onConsultantOrderChange?.(selectedResult ? {
            order_id: selectedResult.order_id,
            manager_name: selectedResult.manager_name || null,
            status_label: selectedResult.current_status_name || selectedResult.from_status || null,
            sectionData: {
                order_id: selectedResult.order_id,
                manager_name: selectedResult.manager_name || null,
                current_status_name: selectedResult.current_status_name || null,
                from_status: selectedResult.from_status,
                to_status: selectedResult.to_status,
                to_status_name: selectedResult.to_status_name || null,
                confidence: selectedResult.confidence,
                reasoning: selectedResult.reasoning,
                country: selectedResult.country || null,
                category: selectedResult.category || null,
                purchase_form: selectedResult.purchase_form || null,
                sphere: selectedResult.sphere || null,
            },
        } : null);
    }, [consultantOrderId, onConsultantOrderChange, results]);

    const toggleColumn = (key: string) => {
        const next = new Set(hiddenColumns);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setHiddenColumns(next);
        localStorage.setItem('ai_router_hidden_columns', JSON.stringify(Array.from(next)));
    };

const COL_GROUPS = {
    'Основные': [
        { key: 'order_id', label: 'Заказ / Сумма' },
        { key: 'manager_name', label: 'Менеджер' },
        { key: 'current_status', label: 'Текущий' },
        { key: 'country', label: 'Страна' },
    ],
    'Характеристики': [
        { key: 'category', label: 'Категория' },
        { key: 'purchase_form', label: 'Форма закупки' },
        { key: 'sphere', label: 'Сфера' },
    ],
    'Комментарии': [
        { key: 'client_comment', label: 'Коммент. Клиента' },
        { key: 'manager_comment', label: 'Коммент. Менеджера' },
        { key: 'logistic_comment', label: 'Коммент. Логиста' },
    ],
    'Решение ИИ': [
        { key: 'to_status', label: 'Решение ИИ' },
        { key: 'confidence', label: 'Conf' },
        { key: 'reasoning', label: 'Обоснование' },
    ]
};

    const isHidden = (key: string) => hiddenColumns.has(key);

    const ColumnSettingsPanel = () => (
        <div className="absolute right-0 top-12 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 p-5 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4 pb-2 border-b">
                <h4 className="text-sm font-bold text-gray-900">Настройка колонок</h4>
                <button onClick={() => setShowColumnSettings(false)} className="text-gray-400 hover:text-gray-600 font-bold">×</button>
            </div>
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {Object.entries(COL_GROUPS).map(([group, columns]) => (
                    <div key={group}>
                        <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2 px-1">{group}</p>
                        <div className="grid grid-cols-1 gap-1">
                            {columns.map(col => (
                                <label key={col.key} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group">
                                    <input
                                        type="checkbox"
                                        checked={!isHidden(col.key)}
                                        onChange={() => toggleColumn(col.key)}
                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    />
                                    <span className={`text-xs font-semibold ${!isHidden(col.key) ? 'text-gray-900' : 'text-gray-400'}`}>
                                        {col.label}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-4 pt-3 border-t flex justify-between">
                <button 
                    onClick={() => { setHiddenColumns(new Set()); localStorage.removeItem('ai_router_hidden_columns'); }}
                    className="text-[10px] font-bold text-blue-600 hover:underline px-1 uppercase tracking-wider"
                >
                    Все
                </button>
                <button 
                    onClick={() => setShowColumnSettings(false)}
                    className="bg-gray-900 text-white text-[10px] font-black px-4 py-1.5 rounded-lg uppercase tracking-wider hover:bg-gray-800 transition-colors"
                >
                    Готово
                </button>
            </div>
        </div>
    );

    if (!isMounted) return (
        <div className="flex min-h-full w-full items-center justify-center border border-slate-200/80 bg-white">
             <div className="animate-spin text-2xl">⚙️</div>
        </div>
    );

    return (
<div className="flex min-h-full w-full flex-col overflow-hidden border border-slate-200/80 bg-white md:shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            {selectedOrderId && (
                <OrderDetailsModal
                    orderId={selectedOrderId}
                    isOpen={!!selectedOrderId}
                    onClose={() => setSelectedOrderId(null)}
                />
            )}

            <div className="border-b border-gray-100 px-3 py-2 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <div className="flex items-center gap-2 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                            <div className="flex -space-x-2">
                                <img src="/images/agents/maxim.png" alt="Maxim" className="w-8 h-8 rounded-full object-cover border-2 border-white shadow-sm" />
                                <img src="/images/agents/igor.png" alt="Igor" className="w-8 h-8 rounded-full object-cover border-2 border-white shadow-sm" />
                            </div>
                            <span className="text-blue-800 text-sm">Максим & Игорь</span>
                        </div>
                        {pendingCount !== null && (
                            <span className="ml-2 text-sm font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                Очередь: {pendingCount}
                            </span>
                        )}
                    </h2>
                    <p className="text-[10px] text-gray-500 mt-1 ml-1 font-medium uppercase tracking-tight">
                        Контроль отмен: Аудит решения (Maxim) + Смена статуса (Igor)
                    </p>
                </div>

                <div className="relative">
                    <button 
                        onClick={() => setShowColumnSettings(!showColumnSettings)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl border font-bold text-xs uppercase tracking-wider transition-all shadow-sm ${showColumnSettings ? 'bg-blue-600 text-white border-blue-600 ring-4 ring-blue-100' : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:text-blue-600'}`}
                    >
                        <span className={showColumnSettings ? 'animate-spin' : ''}>⚙️</span> Колонки
                    </button>
                    {showColumnSettings && <ColumnSettingsPanel />}
                </div>
            </div>

            <div className="flex flex-1 flex-col bg-gray-100/30">
            <div className="p-3 space-y-4">
                {/* Controls */}
                <div className="bg-gray-50 rounded-lg p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-4 flex-1">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setDryRun(!dryRun)}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${dryRun ? 'bg-blue-600' : 'bg-gray-200'}`}
                                >
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${dryRun ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                                <span className="text-xs font-medium text-gray-700 whitespace-nowrap">Тест</span>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        setTrainingMode(!trainingMode);
                                        if (!trainingMode) fetchStatuses();
                                    }}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${trainingMode ? 'bg-purple-600' : 'bg-gray-200'}`}
                                >
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${trainingMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                                <span className="text-xs font-medium text-purple-700 whitespace-nowrap">Обучение</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Лимит:</span>
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={limit}
                                onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
                                className="w-14 px-2 py-1 text-sm border border-gray-300 rounded text-center"
                            />
                        </div>
                    </div>

                    <button
                        onClick={runRouting}
                        disabled={isRunning}
                        className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-3"
                    >
                        {isRunning ? (
                            <span>Обработка...</span>
                        ) : (
                            <>
                                <div className="flex -space-x-2">
                                    <img src="/images/agents/maxim.png" alt="Maxim" className="w-7 h-7 rounded-full border border-white/30" />
                                    <img src="/images/agents/igor.png" alt="Igor" className="w-7 h-7 rounded-full border border-white/30" />
                                </div>
                                <span>Запустить Роутинг (Синергия Maxim & Igor)</span>
                            </>
                        )}
                    </button>

                    <div className="flex justify-between px-1">
                        <span className="text-[10px] text-gray-400">
                            {dryRun ? 'Без записи в CRM' : '⚠️ Запись включена'}
                        </span>
                        {trainingMode && (
                            <span className="text-[10px] text-purple-600">
                                Ручная правка включена
                            </span>
                        )}
                    </div>
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
                                {summary.total_pending_count !== undefined && (
                                    <span className="ml-2 opacity-75">
                                        (Всего в очереди: <strong>{summary.total_pending_count}</strong>)
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {Object.entries(summary.status_distribution).map(([status, count]) => {
                                const statusInfo = availableStatuses.find(s => s.code === status);
                                const color = statusInfo?.color;

                                return (
                                    <div key={status} className="p-3 bg-white border rounded-lg">
                                        <span
                                            className={`inline-block px-2 py-1 text-xs font-semibold rounded border ${!color ? getStatusBadge(status) : ''}`}
                                            style={color ? {
                                                borderColor: color,
                                                backgroundColor: `${color}30`,
                                                color: '#1f2937'
                                            } : undefined}
                                        >
                                            {getStatusLabel(status)}
                                        </span>
                                        <p className="text-2xl font-bold mt-2">{count}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Results Table */}
                {results && results.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="font-semibold text-sm text-gray-700">
                            Результаты ({results.length}):
                        </h3>
                        <div className="border rounded-xl overflow-hidden shadow-sm bg-white">
                            <div className="overflow-x-auto max-w-full">
                                <table className="w-full text-sm border-collapse">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            {!isHidden('order_id') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-28 whitespace-nowrap">Заказ / Сумма</th>}
                                            {!isHidden('manager_name') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-32 whitespace-nowrap">Менеджер</th>}
                                            {!isHidden('current_status') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-28 whitespace-nowrap">Текущий</th>}
                                            {!isHidden('country') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-20 whitespace-nowrap">Страна</th>}
                                            
                                            {!isHidden('category') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-32 whitespace-nowrap">Категория</th>}
                                            {!isHidden('purchase_form') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-32 whitespace-nowrap">Форма закупки</th>}
                                            {!isHidden('sphere') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-32 whitespace-nowrap">Сфера</th>}

                                            {!isHidden('client_comment') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] min-w-[150px] max-w-[250px]">Клиент</th>}
                                            {!isHidden('manager_comment') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] min-w-[150px] max-w-[250px]">Менеджер</th>}
                                            {!isHidden('logistic_comment') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] min-w-[150px] max-w-[250px]">Логист</th>}

                                            {!isHidden('to_status') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-32 whitespace-nowrap">Решение ИИ</th>}
                                            
                                            {trainingMode && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-64 whitespace-nowrap text-purple-600">Ваш Выбор</th>}
                                            
                                            {!isHidden('confidence') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-12 whitespace-nowrap">Conf</th>}
                                            {!isHidden('reasoning') && <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-[30%] min-w-[250px]">Обоснование</th>}
                                            
                                            {trainingMode && <th className="px-3 py-3 text-center font-bold text-gray-500 uppercase tracking-wider text-[10px] w-24">Действие</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 italic-comments">
                                        {results.map((result) => {
                                            const state = trainingState[result.order_id] || {};
                                            return (
                                                <tr key={result.order_id} className={`hover:bg-gray-50/50 transition-colors ${state.done ? 'bg-green-50' : ''}`}>
                                                    {!isHidden('order_id') && (
                                                        <td className="px-3 py-3">
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <a
                                                                        href={result.retail_crm_url ? `${result.retail_crm_url}/orders/${result.order_id}/edit` : '#'}
                                                                        target={result.retail_crm_url ? "_blank" : undefined}
                                                                        rel="noopener noreferrer"
                                                                        className="text-blue-600 hover:underline font-bold text-xs"
                                                                        onClick={e => !result.retail_crm_url && e.preventDefault()}
                                                                    >
                                                                        #{result.order_id}
                                                                    </a>
                                                                    <button
                                                                        onClick={() => {
                                                                            setSelectedOrderId(result.order_id);
                                                                            setConsultantOrderId(result.order_id);
                                                                        }}
                                                                        className="px-2 py-0.5 text-[10px] font-semibold rounded-full border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors shrink-0"
                                                                        title="Открыть карточку заказа"
                                                                    >
                                                                        Карточка
                                                                    </button>
                                                                </div>
                                                                <span className="text-[11px] font-bold text-gray-700">
                                                                    {result.total_sum?.toLocaleString('ru-RU')} ₽
                                                                </span>
                                                            </div>
                                                        </td>
                                                    )}

                                                    {!isHidden('manager_name') && (
                                                        <td className="px-3 py-3">
                                                            <span className="text-xs font-semibold text-gray-700">{result.manager_name || '—'}</span>
                                                        </td>
                                                    )}

                                                    {!isHidden('current_status') && (
                                                        <td className="px-3 py-3">
                                                            <span
                                                                className="inline-block px-2 py-0.5 text-[9px] font-black rounded uppercase border shadow-sm tracking-wider"
                                                                style={{
                                                                    borderColor: result.current_status_color || '#e5e7eb',
                                                                    backgroundColor: result.current_status_color ? `${result.current_status_color}30` : '#f3f4f6',
                                                                    color: '#111827'
                                                                }}
                                                            >
                                                                {result.current_status_name || result.from_status}
                                                            </span>
                                                        </td>
                                                    )}

                                                    {!isHidden('country') && (
                                                        <td className="px-3 py-3">
                                                            <span className="text-[11px] font-medium text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded border">{result.country || 'RU'}</span>
                                                        </td>
                                                    )}

                                                    {!isHidden('category') && (
                                                        <td className="px-3 py-3">
                                                            <span className="text-[11px] text-gray-600 truncate block max-w-[120px]" title={result.category}>
                                                                {result.category || '—'}
                                                            </span>
                                                        </td>
                                                    )}

                                                    {!isHidden('purchase_form') && (
                                                        <td className="px-3 py-3">
                                                            <span className="text-[11px] text-gray-600 truncate block max-w-[120px]" title={result.purchase_form}>
                                                                {result.purchase_form || '—'}
                                                            </span>
                                                        </td>
                                                    )}

                                                    {!isHidden('sphere') && (
                                                        <td className="px-3 py-3">
                                                            <span className="text-[11px] text-gray-600 truncate block max-w-[120px]" title={result.sphere}>
                                                                {result.sphere || '—'}
                                                            </span>
                                                        </td>
                                                    )}

                                                    {!isHidden('client_comment') && (
                                                        <td className="px-3 py-3">
                                                            <div className="text-[10px] leading-relaxed text-gray-500 max-h-20 overflow-y-auto pr-1 italic scrollbar-hide" title={result.client_comment}>
                                                                {result.client_comment || <span className="opacity-30">Нет комментария</span>}
                                                            </div>
                                                        </td>
                                                    )}

                                                    {!isHidden('manager_comment') && (
                                                        <td className="px-3 py-3">
                                                            <div className="text-[10px] leading-relaxed text-gray-500 max-h-20 overflow-y-auto pr-1 italic scrollbar-hide" title={result.manager_comment}>
                                                                {result.manager_comment || <span className="opacity-30">Нет комментария</span>}
                                                            </div>
                                                        </td>
                                                    )}

                                                    {!isHidden('logistic_comment') && (
                                                        <td className="px-3 py-3">
                                                            <div className="text-[10px] leading-relaxed text-gray-500 max-h-20 overflow-y-auto pr-1 italic scrollbar-hide" title={result.logistic_comment}>
                                                                {result.logistic_comment || <span className="opacity-30">Нет комментария</span>}
                                                            </div>
                                                        </td>
                                                    )}

                                                    {!isHidden('to_status') && (
                                                        <td className="px-3 py-3">
                                                            <span className={`inline-block px-2 py-0.5 text-[9px] font-black rounded uppercase border tracking-wider ${getStatusBadge(result.to_status)}`}>
                                                                {result.to_status_name || result.to_status}
                                                            </span>
                                                        </td>
                                                    )}

                                                    {trainingMode && (
                                                        <td className="px-3 py-3">
                                                            {!state.done ? (
                                                                <select
                                                                    value={state.status}
                                                                    onChange={(e) => updateTrainingState(result.order_id, 'status', e.target.value)}
                                                                    className="w-full p-2 border rounded text-xs bg-white text-gray-900 font-bold border-purple-200 focus:border-purple-500 ring-purple-100 shadow-sm"
                                                                >
                                                                    {(() => {
                                                                        const grouped: Record<string, typeof availableStatuses> = {};
                                                                        availableStatuses.forEach(s => {
                                                                            const g = s.group_name || 'Другое';
                                                                            if (!grouped[g]) grouped[g] = [];
                                                                            grouped[g].push(s);
                                                                        });

                                                                        return Object.entries(grouped).sort().map(([group, statuses]) => (
                                                                            <optgroup key={group} label={group}>
                                                                                {statuses.map(s => (
                                                                                    <option key={s.code} value={s.code}>{s.name}</option>
                                                                                ))}
                                                                            </optgroup>
                                                                        ));
                                                                    })()}
                                                                    {!availableStatuses.find(s => s.code === state.status) && (
                                                                        <option value={state.status}>{state.status}</option>
                                                                    )}
                                                                </select>
                                                            ) : (
                                                                <span className="text-xs font-bold text-purple-700">
                                                                    {availableStatuses.find(s => s.code === state.status)?.name || state.status}
                                                                </span>
                                                            )}
                                                        </td>
                                                    )}

                                                    {!isHidden('confidence') && (
                                                        <td className="px-3 py-3">
                                                            <span className={`font-black text-[10px] ${result.confidence >= 0.8 ? 'text-green-600' :
                                                                result.confidence >= 0.6 ? 'text-yellow-600' :
                                                                    'text-red-600'
                                                                }`}>
                                                                {(result.confidence * 100).toFixed(0)}%
                                                            </span>
                                                        </td>
                                                    )}

                                                    {!isHidden('reasoning') && (
                                                        <td className="px-3 py-3">
                                                            {trainingMode && !state.done ? (
                                                                <textarea
                                                                    value={state.comment}
                                                                    onChange={(e) => updateTrainingState(result.order_id, 'comment', e.target.value)}
                                                                    className="w-full p-2 border rounded text-[11px] min-h-[80px] leading-relaxed font-medium"
                                                                    placeholder="Обоснование решения..."
                                                                />
                                                            ) : (
                                                                <div className="text-[11px] text-gray-600 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed pr-2 custom-scrollbar">
                                                                    {result.reasoning}
                                                                </div>
                                                            )}
                                                        </td>
                                                    )}

                                                    {trainingMode && (
                                                        <td className="px-3 py-3 text-center">
                                                            {state.done ? (
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-green-600 text-xl">✓</span>
                                                                    <span className="text-[9px] font-black uppercase text-green-700 tracking-tighter">Готово</span>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleTrainApply(result.order_id)}
                                                                    disabled={state.loading}
                                                                    className="w-full px-2 py-2 bg-purple-600 text-white rounded-lg text-[10px] font-black uppercase tracking-tighter hover:bg-purple-700 disabled:opacity-50 shadow-sm transition-all shadow-purple-100"
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
                    </div>
                )}
            </div>
            {!results && !summary && !error && (
                <div className="flex-1 border-t border-gray-100 bg-gray-100/30" />
            )}
            </div>
            </div>
            
            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #e2e8f0;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #cbd5e1;
                }
                .scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
                .scrollbar-hide {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
        </div>
    );
}

const InfoField = ({ label, value, required }: { label: string; value?: React.ReactNode; required?: boolean }) => (
    <div className="space-y-1">
        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1">
            {label}
            {required && <span className="text-red-500">*</span>}
        </div>
        <div className="px-3 py-1.5 rounded-lg border text-xs bg-gray-50 border-gray-100 text-gray-900 font-medium">
            {value ?? <span className="text-gray-300">Не указано</span>}
        </div>
    </div>
);
