
'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
    PhoneCall,
    Mail,
    CheckCircle2,
    AlertCircle,
    Clock,
    ChevronRight,
    ExternalLink,
    MessageSquare
} from 'lucide-react';

interface PriorityOrder {
    id: number;
    number: string;
    totalSumm: number;
    managerComment: string;
    today_stats: {
        call_count: number;
        has_dialogue: boolean;
        has_email: boolean;
        status: 'success' | 'in_progress' | 'fallback_required' | 'overdue';
        calls: any[];
    };
    raw_payload: any;
}

export const PriorityDashboard = () => {
    const [orders, setOrders] = useState<PriorityOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchOrders = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/okk/priority');
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setOrders(data.orders || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
        const interval = setInterval(fetchOrders, 60000); // Auto refresh every minute
        return () => clearInterval(interval);
    }, []);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'success':
                return <Badge className="bg-green-100 text-green-800 border-green-200">Успешно</Badge>;
            case 'overdue':
                return <Badge className="bg-red-100 text-red-800 border-red-200">Просрочено</Badge>;
            case 'fallback_required':
                return <Badge className="bg-orange-100 text-orange-800 border-orange-200">Требуется письмо</Badge>;
            default:
                return <Badge className="bg-blue-100 text-blue-800 border-blue-200">В процессе</Badge>;
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'success':
                return <CheckCircle2 className="w-5 h-5 text-green-500" />;
            case 'overdue':
                return <AlertCircle className="w-5 h-5 text-red-500" />;
            case 'fallback_required':
                return <Mail className="w-5 h-5 text-orange-500" />;
            default:
                return <Clock className="w-5 h-5 text-blue-500" />;
        }
    };

    if (loading && orders.length === 0) return (
        <div className="flex items-center justify-center p-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
    );

    if (error) return (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 m-4">
            Ошибка: {error}
        </div>
    );

    return (
        <div className="space-y-6 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Утренний Спринт (Ключевые заказы)</h2>
                    <p className="text-muted-foreground">Обработка приоритетных лидов до 14:00</p>
                </div>
                <Button onClick={fetchOrders} variant="outline" size="sm">
                    Обновить
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Всего ключевых</CardTitle>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{orders.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Обработано</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">
                            {orders.filter(o => o.today_stats.status === 'success').length}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Нужно письмо</CardTitle>
                        <Mail className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-600">
                            {orders.filter(o => o.today_stats.status === 'fallback_required').length}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Просрочено</CardTitle>
                        <AlertCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">
                            {orders.filter(o => o.today_stats.status === 'overdue').length}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4">
                {orders.map((order) => (
                    <Card key={order.id} className="overflow-hidden border-l-4" style={{
                        borderLeftColor:
                            order.today_stats.status === 'success' ? '#22c55e' :
                                order.today_stats.status === 'overdue' ? '#ef4444' :
                                    order.today_stats.status === 'fallback_required' ? '#f97316' : '#3b82f6'
                    }}>
                        <CardContent className="p-0">
                            <div className="flex flex-col md:flex-row items-start md:items-center p-6 gap-6">
                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-3">
                                        <a
                                            href={`https://${order.raw_payload?.site}.retailcrm.ru/orders/${order.id}/edit`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-lg font-bold hover:text-primary transition-colors hover:underline"
                                        >
                                            #{order.number}
                                        </a>
                                        {getStatusBadge(order.today_stats.status)}
                                        <a
                                            href={`https://${order.raw_payload?.site}.retailcrm.ru/orders/${order.id}/edit`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-muted-foreground hover:text-primary transition-colors"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                    </div>
                                    <div className="text-sm text-muted-foreground line-clamp-1">
                                        {order.raw_payload?.items?.[0]?.offer?.name || 'Заказ без товаров'}
                                    </div>
                                    <div className="text-sm font-medium">
                                        {order.totalSumm?.toLocaleString()} ₽
                                    </div>
                                </div>

                                <div className="flex gap-8 items-center">
                                    <div className="text-center space-y-1">
                                        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Звонки</div>
                                        <div className="flex items-center justify-center gap-1.5 font-bold">
                                            <PhoneCall className={`w-4 h-4 ${order.today_stats.call_count > 0 ? 'text-primary' : 'text-muted-foreground opacity-30'}`} />
                                            <span className={order.today_stats.call_count >= 3 ? 'text-orange-600' : ''}>
                                                {order.today_stats.call_count} / 3
                                            </span>
                                        </div>
                                    </div>

                                    <div className="text-center space-y-1">
                                        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Диалог</div>
                                        <div className="flex justify-center">
                                            <MessageSquare className={`w-5 h-5 ${order.today_stats.has_dialogue ? 'text-green-500' : 'text-muted-foreground opacity-30'}`} />
                                        </div>
                                    </div>

                                    <div className="text-center space-y-1">
                                        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Email</div>
                                        <div className="flex justify-center">
                                            <Mail className={`w-5 h-5 ${order.today_stats.has_email ? 'text-blue-500' : 'text-muted-foreground opacity-30'}`} />
                                        </div>
                                    </div>

                                    <div className="pl-4 border-l">
                                        {getStatusIcon(order.today_stats.status)}
                                    </div>
                                </div>
                            </div>

                            {order.today_stats.calls.length > 0 && (
                                <div className="bg-muted/30 px-6 py-4 border-t">
                                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-3 flex items-center gap-2">
                                        <PhoneCall className="w-3 h-3" /> Последние активности
                                    </div>
                                    <div className="space-y-3">
                                        {order.today_stats.calls.slice(0, 2).map((call: any, idx: number) => (
                                            <div key={idx} className="text-sm bg-white p-3 rounded border shadow-sm">
                                                <div className="flex justify-between mb-1 items-center">
                                                    <span className="text-xs font-medium text-primary">
                                                        {new Date(call.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {call.duration_sec} сек.
                                                    </span>
                                                </div>
                                                <div className="text-xs italic text-muted-foreground line-clamp-2 leading-relaxed">
                                                    {call.transcript || (call.transcription_status === 'processing' ? 'Транскрибация идёт...' : 'Нет записи разговора')}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};
