'use client';

import { useState } from 'react';
import { Loader2, Play, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface RoutingResult {
    order_id: number;
    from_status: string;
    to_status: string;
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
    const [isRunning, setIsRunning] = useState(false);
    const [dryRun, setDryRun] = useState(true);
    const [limit, setLimit] = useState(10);
    const [results, setResults] = useState<RoutingResult[] | null>(null);
    const [summary, setSummary] = useState<RoutingSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

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
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsRunning(false);
        }
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
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">
                                Режим тестирования (Dry Run)
                            </label>
                            <p className="text-xs text-gray-500">
                                Только показать результаты, не применять изменения
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

                    <div className="space-y-2">
                        <label className="text-sm font-medium">
                            Количество заказов
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={limit}
                            onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
                            className="w-32 px-3 py-2 border border-gray-300 rounded-md"
                        />
                        <p className="text-xs text-gray-500">
                            Рекомендуется начать с 10-20 заказов
                        </p>
                    </div>

                    <button
                        onClick={runRouting}
                        disabled={isRunning}
                        className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isRunning ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Обработка...
                            </>
                        ) : (
                            <>
                                <Play className="h-4 w-4" />
                                Запустить AI Маршрутизацию
                            </>
                        )}
                    </button>
                </div>

                {/* Warning */}
                {!dryRun && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
                        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-red-800">
                            <strong>Внимание!</strong> Режим тестирования выключен.
                            Статусы заказов будут изменены в базе данных!
                        </div>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
                        <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-red-800">
                            <strong>Ошибка:</strong> {error}
                        </div>
                    </div>
                )}

                {/* Summary */}
                {summary && (
                    <div className="space-y-4">
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex gap-3">
                            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                            <div className="text-sm text-green-800">
                                <strong>Обработано:</strong> {summary.total_processed} заказов
                                {summary.dry_run && ' (тестовый режим)'}
                                {!summary.dry_run && ` | Применено: ${summary.applied}`}
                            </div>
                        </div>

                        {/* Status Distribution */}
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
                            Детали обработки (первые 10):
                        </h3>
                        <div className="border rounded-lg overflow-hidden">
                            <div className="max-h-96 overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-2 text-left">Заказ</th>
                                            <th className="px-4 py-2 text-left">Новый статус</th>
                                            <th className="px-4 py-2 text-left">Уверенность</th>
                                            <th className="px-4 py-2 text-left">Причина</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.slice(0, 10).map((result) => (
                                            <tr key={result.order_id} className="border-t hover:bg-gray-50">
                                                <td className="px-4 py-2 font-mono text-xs">
                                                    #{result.order_id}
                                                </td>
                                                <td className="px-4 py-2">
                                                    <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(result.to_status)}`}>
                                                        {getStatusLabel(result.to_status)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2">
                                                    <span className={`font-semibold ${result.confidence >= 0.8 ? 'text-green-600' :
                                                            result.confidence >= 0.6 ? 'text-yellow-600' :
                                                                'text-red-600'
                                                        }`}>
                                                        {(result.confidence * 100).toFixed(0)}%
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-xs text-gray-600">
                                                    {result.reasoning}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


interface RoutingResult {
    order_id: number;
    from_status: string;
    to_status: string;
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
    const [isRunning, setIsRunning] = useState(false);
    const [dryRun, setDryRun] = useState(true);
    const [limit, setLimit] = useState(10);
    const [results, setResults] = useState<RoutingResult[] | null>(null);
    const [summary, setSummary] = useState<RoutingSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

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
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsRunning(false);
        }
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
        <Card className="w-full">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    🤖 AI Маршрутизация Заказов
                </CardTitle>
                <CardDescription>
                    Автоматическая обработка заказов в статусе "Согласование отмены" (593 заказа)
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Controls */}
                <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <Label htmlFor="dry-run" className="text-sm font-medium">
                                Режим тестирования (Dry Run)
                            </Label>
                            <p className="text-xs text-gray-500">
                                Только показать результаты, не применять изменения
                            </p>
                        </div>
                        <Switch
                            id="dry-run"
                            checked={dryRun}
                            onCheckedChange={setDryRun}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="limit" className="text-sm font-medium">
                            Количество заказов
                        </Label>
                        <Input
                            id="limit"
                            type="number"
                            min="1"
                            max="100"
                            value={limit}
                            onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
                            className="w-32"
                        />
                        <p className="text-xs text-gray-500">
                            Рекомендуется начать с 10-20 заказов
                        </p>
                    </div>

                    <Button
                        onClick={runRouting}
                        disabled={isRunning}
                        className="w-full"
                        size="lg"
                    >
                        {isRunning ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Обработка...
                            </>
                        ) : (
                            <>
                                <Play className="mr-2 h-4 w-4" />
                                Запустить AI Маршрутизацию
                            </>
                        )}
                    </Button>
                </div>

                {/* Warning for non-dry-run */}
                {!dryRun && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                            <strong>Внимание!</strong> Режим тестирования выключен.
                            Статусы заказов будут изменены в базе данных!
                        </AlertDescription>
                    </Alert>
                )}

                {/* Error */}
                {error && (
                    <Alert variant="destructive">
                        <XCircle className="h-4 w-4" />
                        <AlertDescription>
                            <strong>Ошибка:</strong> {error}
                        </AlertDescription>
                    </Alert>
                )}

                {/* Summary */}
                {summary && (
                    <div className="space-y-4">
                        <Alert>
                            <CheckCircle2 className="h-4 w-4" />
                            <AlertDescription>
                                <strong>Обработано:</strong> {summary.total_processed} заказов
                                {summary.dry_run && ' (тестовый режим)'}
                                {!summary.dry_run && ` | Применено: ${summary.applied}`}
                            </AlertDescription>
                        </Alert>

                        {/* Status Distribution */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {Object.entries(summary.status_distribution).map(([status, count]) => (
                                <div key={status} className="p-3 bg-white border rounded-lg">
                                    <Badge className={getStatusBadge(status)}>
                                        {getStatusLabel(status)}
                                    </Badge>
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
                            Детали обработки (первые 10):
                        </h3>
                        <div className="border rounded-lg overflow-hidden">
                            <div className="max-h-96 overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-2 text-left">Заказ</th>
                                            <th className="px-4 py-2 text-left">Новый статус</th>
                                            <th className="px-4 py-2 text-left">Уверенность</th>
                                            <th className="px-4 py-2 text-left">Причина</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.slice(0, 10).map((result) => (
                                            <tr key={result.order_id} className="border-t hover:bg-gray-50">
                                                <td className="px-4 py-2 font-mono text-xs">
                                                    #{result.order_id}
                                                </td>
                                                <td className="px-4 py-2">
                                                    <Badge className={getStatusBadge(result.to_status)}>
                                                        {getStatusLabel(result.to_status)}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-2">
                                                    <span className={`font-semibold ${result.confidence >= 0.8 ? 'text-green-600' :
                                                        result.confidence >= 0.6 ? 'text-yellow-600' :
                                                            'text-red-600'
                                                        }`}>
                                                        {(result.confidence * 100).toFixed(0)}%
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-xs text-gray-600">
                                                    {result.reasoning}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
