
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
    managerId?: number;
    managerName?: string;
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
    const [activeManagers, setActiveManagers] = useState<{ id: number, name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState({
        sumMin: '',
        sumMax: '',
        control: 'all', // 'all', 'yes', 'no'
        nextContactDateFrom: '',
        nextContactDateTo: '',
        status: 'all'
    });

    const fetchOrders = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/okk/priority');
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setOrders(data.orders || []);
            setActiveManagers(data.activeManagers || []);
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

    const filteredOrders = orders.filter(order => {
        // 1. Sum Filter
        if (filters.sumMin && (order.totalSumm || 0) < Number(filters.sumMin)) return false;
        if (filters.sumMax && (order.totalSumm || 0) > Number(filters.sumMax)) return false;

        // 2. Control Filter
        if (filters.control !== 'all') {
            const isControlled = order.raw_payload?.customFields?.control === true; // Assuming 'control' is the field key, need to verify
            // Based on previous chats, 'control' field exists in customFields. 
            // Let's check raw_payload usage in other parts or just rely on common sense for now, 
            // but for safety, I'll log or check if I can.
            // Actually, in the verified API response earlier: "customFields": { "control": true, ... }
            if (filters.control === 'yes' && !isControlled) return false;
            if (filters.control === 'no' && isControlled) return false;
        }

        // 3. Next Contact Date Filter
        if (filters.nextContactDateFrom || filters.nextContactDateTo) {
            const nextContact = order.raw_payload?.customFields?.nextContactDate; // Verify field name. 
            // In the API response shown in Step 6168, I don't see 'nextContactDate' immediately in customFields.
            // I see 'data_kontakta': '2026-01-12'. Let's use that.
            const contactDate = order.raw_payload?.customFields?.data_kontakta;

            if (contactDate) {
                if (filters.nextContactDateFrom && contactDate < filters.nextContactDateFrom) return false;
                if (filters.nextContactDateTo && contactDate > filters.nextContactDateTo) return false;
            } else if (filters.nextContactDateFrom || filters.nextContactDateTo) {
                // If filtering by date but order has no date, usually exclude it? Or keep?
                // Let's exclude for now as "doesn't match range".
                return false;
            }
        }

        // 4. Status Filter
        // The user asked for "Status". The order has `status` in payload (e.g. 'na-soglasovanii') 
        // and also computed `today_stats.status`. The user likely means the CRM status.
        if (filters.status !== 'all') {
            if (order.raw_payload?.status !== filters.status) return false;
        }

        return true;
    });

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
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Утренний Спринт (Ключевые заказы)</h2>
                    <p className="text-muted-foreground">Обработака приоритетных лидов до 14:00</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowFilters(!showFilters)}
                        className={showFilters ? 'bg-secondary' : ''}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                        Фильтры
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchOrders}>
                        Обновить
                    </Button>
                </div>
            </div>

            {showFilters && (
                <Card className="bg-gray-50/50 border-dashed">
                    <CardContent className="pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {/* Status Filter */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase text-gray-500">Статус заказа</label>
                                <select
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                    value={filters.status}
                                    onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                                >
                                    <option value="all">Любой</option>
                                    <option value="new">Новый</option>
                                    <option value="in-progress">В работе</option>
                                    <option value="na-soglasovanii">На согласовании</option>
                                    {/* Add more statuses as needed */}
                                </select>
                            </div>

                            {/* Control Filter */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase text-gray-500">Контроль</label>
                                <select
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                    value={filters.control}
                                    onChange={(e) => setFilters({ ...filters, control: e.target.value })}
                                >
                                    <option value="all">Любой</option>
                                    <option value="yes">Да</option>
                                    <option value="no">Нет</option>
                                </select>
                            </div>

                            {/* Sum Filter */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase text-gray-500">Сумма заказа, ₽</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        placeholder="0"
                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        value={filters.sumMin}
                                        onChange={(e) => setFilters({ ...filters, sumMin: e.target.value })}
                                    />
                                    <span className="text-gray-400 py-2">–</span>
                                    <input
                                        type="number"
                                        placeholder="∞"
                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        value={filters.sumMax}
                                        onChange={(e) => setFilters({ ...filters, sumMax: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Date Filter */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase text-gray-500">Дата след. контакта</label>
                                <div className="flex gap-2">
                                    <input
                                        type="date"
                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        value={filters.nextContactDateFrom}
                                        onChange={(e) => setFilters({ ...filters, nextContactDateFrom: e.target.value })}
                                    />
                                    <span className="text-gray-400 py-2">–</span>
                                    <input
                                        type="date"
                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        value={filters.nextContactDateTo}
                                        onChange={(e) => setFilters({ ...filters, nextContactDateTo: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Всего ключевых */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Всего ключевых</CardTitle>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold mb-2">{filteredOrders.length}</div>
                        <div className="text-xs text-muted-foreground space-y-0.5 max-h-[150px] overflow-y-auto pr-1">
                            {(() => {
                                const stats = filteredOrders.reduce((acc: any, o) => {
                                    const name = o.managerName || 'Не назначен';
                                    acc[name] = (acc[name] || 0) + 1;
                                    return acc;
                                }, {});

                                // Merge active managers with stats
                                const list = activeManagers.map(m => ({
                                    name: m.name,
                                    count: stats[m.name] || 0
                                }));

                                // Add "Не назначен" if exists
                                if (stats['Не назначен']) {
                                    list.push({ name: 'Не назначен', count: stats['Не назначен'] });
                                }

                                return list
                                    .sort((a, b) => b.count - a.count)
                                    .map((m) => (
                                        <div key={m.name} className={`flex justify-between ${m.count === 0 ? 'opacity-50' : ''}`}>
                                            <span className="truncate">{m.name}</span>
                                            <span className="font-semibold ml-1">{m.count}</span>
                                        </div>
                                    ));
                            })()}
                        </div>
                    </CardContent>
                </Card>

                {/* Обработано */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Обработано</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600 mb-2">
                            {filteredOrders.filter(o => o.today_stats.status === 'success').length}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5 max-h-[150px] overflow-y-auto pr-1">
                            {(() => {
                                const stats = filteredOrders
                                    .filter(o => o.today_stats.status === 'success')
                                    .reduce((acc: any, o) => {
                                        const name = o.managerName || 'Не назначен';
                                        acc[name] = (acc[name] || 0) + 1;
                                        return acc;
                                    }, {});

                                const list = activeManagers.map(m => ({
                                    name: m.name,
                                    count: stats[m.name] || 0
                                }));

                                if (stats['Не назначен']) {
                                    list.push({ name: 'Не назначен', count: stats['Не назначен'] });
                                }

                                return list
                                    .sort((a, b) => b.count - a.count)
                                    .map((m) => (
                                        <div key={m.name} className={`flex justify-between ${m.count === 0 ? 'opacity-50' : ''}`}>
                                            <span className="truncate">{m.name}</span>
                                            <span className="font-semibold ml-1">{m.count}</span>
                                        </div>
                                    ));
                            })()}
                        </div>
                    </CardContent>
                </Card>

                {/* Нужно письмо */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Нужно письмо</CardTitle>
                        <Mail className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-600 mb-2">
                            {filteredOrders.filter(o => o.today_stats.status === 'fallback_required').length}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5 max-h-[150px] overflow-y-auto pr-1">
                            {(() => {
                                const stats = filteredOrders
                                    .filter(o => o.today_stats.status === 'fallback_required')
                                    .reduce((acc: any, o) => {
                                        const name = o.managerName || 'Не назначен';
                                        acc[name] = (acc[name] || 0) + 1;
                                        return acc;
                                    }, {});

                                const list = activeManagers.map(m => ({
                                    name: m.name,
                                    count: stats[m.name] || 0
                                }));

                                if (stats['Не назначен']) {
                                    list.push({ name: 'Не назначен', count: stats['Не назначен'] });
                                }

                                return list
                                    .sort((a, b) => b.count - a.count)
                                    .map((m) => (
                                        <div key={m.name} className={`flex justify-between ${m.count === 0 ? 'opacity-50' : ''}`}>
                                            <span className="truncate">{m.name}</span>
                                            <span className="font-semibold ml-1">{m.count}</span>
                                        </div>
                                    ));
                            })()}
                        </div>
                    </CardContent>
                </Card>

                {/* Просрочено */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Просрочено</CardTitle>
                        <AlertCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600 mb-2">
                            {filteredOrders.filter(o => o.today_stats.status === 'overdue').length}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5 max-h-[150px] overflow-y-auto pr-1">
                            {(() => {
                                const stats = filteredOrders
                                    .filter(o => o.today_stats.status === 'overdue')
                                    .reduce((acc: any, o) => {
                                        const name = o.managerName || 'Не назначен';
                                        acc[name] = (acc[name] || 0) + 1;
                                        return acc;
                                    }, {});

                                const list = activeManagers.map(m => ({
                                    name: m.name,
                                    count: stats[m.name] || 0
                                }));

                                if (stats['Не назначен']) {
                                    list.push({ name: 'Не назначен', count: stats['Не назначен'] });
                                }

                                return list
                                    .sort((a, b) => b.count - a.count)
                                    .map((m) => (
                                        <div key={m.name} className={`flex justify-between ${m.count === 0 ? 'opacity-50' : ''}`}>
                                            <span className="truncate">{m.name}</span>
                                            <span className="font-semibold ml-1">{m.count}</span>
                                        </div>
                                    ));
                            })()}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4">
                {filteredOrders.map((order) => (
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
                                            href={`https://${order.raw_payload?.site?.replace('-ru', '')}.retailcrm.ru/orders/${order.id}/edit`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-lg font-bold hover:text-primary transition-colors hover:underline"
                                        >
                                            #{order.number}
                                        </a>
                                        {getStatusBadge(order.today_stats.status)}
                                        <a
                                            href={`https://${order.raw_payload?.site?.replace('-ru', '')}.retailcrm.ru/orders/${order.id}/edit`}
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
                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                        <span className="font-medium">Менеджер:</span>
                                        <span>{order.managerName || `ID ${order.managerId}` || 'Не назначен'}</span>
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
