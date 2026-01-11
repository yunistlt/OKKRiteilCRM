'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
