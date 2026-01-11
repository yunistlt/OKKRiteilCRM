
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
    MessageSquare,
    Save,
    X
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

import { getPresets, savePreset, deletePreset, type Preset } from '@/app/actions/presets';

export const PriorityDashboard = () => {
    const [orders, setOrders] = useState<PriorityOrder[]>([]);
    const [activeManagers, setActiveManagers] = useState<{ id: number, name: string }[]>([]);
    const [activeStatuses, setActiveStatuses] = useState<{ code: string, name: string, group_name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showFilters, setShowFilters] = useState(false);

    // Presets State
    const [presets, setPresets] = useState<Preset[]>([]);
    const [presetName, setPresetName] = useState('');
    const [isSavingPreset, setIsSavingPreset] = useState(false);

    // Filters State
    const [filters, setFilters] = useState({
        sumMin: '',
        sumMax: '',
        control: 'all', // 'all', 'yes', 'no'
        nextContactDateFrom: '',
        nextContactDateTo: '',
        statuses: [] as string[] // Changed from single string to array
    });

    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

    const fetchOrders = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/okk/priority');
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setOrders(data.orders || []);
            setActiveManagers(data.activeManagers || []);
            setActiveStatuses(data.activeStatuses || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadPresets = async () => {
        const res = await getPresets();
        if (res.success && res.data) {
            setPresets(res.data);
        }
    };

    useEffect(() => {
        fetchOrders();
        loadPresets();
        const interval = setInterval(fetchOrders, 60000); // Auto refresh every minute
        return () => clearInterval(interval);
    }, []);

    const handleSavePreset = async () => {
        if (!presetName.trim()) return;
        setIsSavingPreset(true);
        const res = await savePreset(presetName, filters);
        setIsSavingPreset(false);
        if (res.success) {
            setPresetName('');
            loadPresets();
        } else {
            alert('Ошибка сохранения: ' + res.error);
        }
    };

    const handleLoadPreset = (preset: Preset) => {
        setFilters(preset.filters);
    };

    const handleDeletePreset = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('Удалить этот фильтр?')) return;
        await deletePreset(id);
        loadPresets();
    };

    // Helper to toggle status selection
    const toggleStatus = (code: string) => {
        setFilters(prev => {
            const current = prev.statuses;
            if (current.includes(code)) {
                return { ...prev, statuses: current.filter(c => c !== code) };
            } else {
                return { ...prev, statuses: [...current, code] };
            }
        });
    };

    // Select All / Deselect All
    const toggleAllStatuses = () => {
        if (filters.statuses.length === activeStatuses.length) {
            setFilters(prev => ({ ...prev, statuses: [] }));
        } else {
            setFilters(prev => ({ ...prev, statuses: activeStatuses.map(s => s.code) }));
        }
    };

    // Helper to determine status color based on group
    const getStatusColor = (group?: string) => {
        const g = group?.toLowerCase() || '';
        if (g.includes('согласование')) return 'bg-orange-100 text-orange-800 border-orange-200';
        if (g.includes('оплате')) return 'bg-green-100 text-green-800 border-green-200';
        if (g.includes('производство')) return 'bg-purple-100 text-purple-800 border-purple-200';
        if (g.includes('доставка') || g.includes('отгружен')) return 'bg-gray-100 text-gray-800 border-gray-200';
        if (g.includes('отменен')) return 'bg-gray-100 text-gray-800 border-gray-200';
        if (g.includes('новый') || g.includes('холодная') || g.includes('тендер')) return 'bg-blue-100 text-blue-800 border-blue-200';
        if (g.includes('рекламаци')) return 'bg-red-100 text-red-800 border-red-200';
        return 'bg-slate-100 text-slate-800 border-slate-200'; // Default
    };

    const filteredOrders = orders.filter(order => {
        // 1. Sum Filter
        if (filters.sumMin && (order.totalSumm || 0) < Number(filters.sumMin)) return false;
        if (filters.sumMax && (order.totalSumm || 0) > Number(filters.sumMax)) return false;

        // 2. Control Filter
        if (filters.control !== 'all') {
            const isControlled = order.raw_payload?.customFields?.control === true;
            if (filters.control === 'yes' && !isControlled) return false;
            if (filters.control === 'no' && isControlled) return false;
        }

        // 3. Next Contact Date Filter
        if (filters.nextContactDateFrom || filters.nextContactDateTo) {
            const contactDate = order.raw_payload?.customFields?.data_kontakta;

            if (contactDate) {
                if (filters.nextContactDateFrom && contactDate < filters.nextContactDateFrom) return false;
                if (filters.nextContactDateTo && contactDate > filters.nextContactDateTo) return false;
            } else if (filters.nextContactDateFrom || filters.nextContactDateTo) {
                return false;
            }
        }

        // 4. Status Filter (Multi-select)
        if (filters.statuses.length > 0) {
            const orderStatus = order.raw_payload?.status;
            if (!filters.statuses.includes(orderStatus)) return false;
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
                {/* Filter Section */}
                {showFilters && (
                    <Card className="bg-gray-50/50 border-dashed">
                        <CardContent className="pt-6 space-y-6">
                            {/* 1. Saved Presets Section */}
                            <div className="space-y-3">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                                    <label className="text-xs font-semibold uppercase text-gray-500">Сохраненные фильтры</label>

                                    {/* Save Current Filter Form */}
                                    <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <input
                                            type="text"
                                            placeholder="Название нового фильтра..."
                                            className="h-8 text-sm px-2 rounded border border-input w-full sm:w-[200px]"
                                            value={presetName}
                                            onChange={(e) => setPresetName(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                                        />
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8"
                                            onClick={handleSavePreset}
                                            disabled={!presetName.trim() || isSavingPreset}
                                        >
                                            {isSavingPreset ? '...' : <Save className="w-4 h-4" />}
                                        </Button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {presets.length === 0 && (
                                        <span className="text-xs text-muted-foreground italic">Нет сохраненных фильтров</span>
                                    )}
                                    {presets.map(preset => (
                                        <div
                                            key={preset.id}
                                            className="group flex items-center gap-1.5 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 rounded-full px-3 py-1 text-sm cursor-pointer transition-all shadow-sm"
                                            onClick={() => handleLoadPreset(preset)}
                                        >
                                            <span className="font-medium text-gray-700 group-hover:text-blue-700">{preset.name}</span>
                                            <button
                                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 hover:text-red-600 rounded-full transition-all"
                                                onClick={(e) => handleDeletePreset(e, preset.id)}
                                                title="Удалить"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="border-t border-gray-200/60"></div>

                            {/* 2. Standard Filters */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                {/* Status Filter (Multi-select) */}
                                <div className="space-y-2 relative">
                                    <label className="text-xs font-semibold uppercase text-gray-500">Статус заказа</label>
                                    <div className="relative">
                                        <button
                                            onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                                            className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                                        >
                                            <span className="truncate">
                                                {filters.statuses.length === 0
                                                    ? 'Любой статус'
                                                    : filters.statuses.length === activeStatuses.length
                                                        ? 'Все статусы'
                                                        : `Выбрано: ${filters.statuses.length}`}
                                            </span>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="m6 9 6 6 6-6" /></svg>
                                        </button>

                                        {statusDropdownOpen && (
                                            <>
                                                <div
                                                    className="fixed inset-0 z-10"
                                                    onClick={() => setStatusDropdownOpen(false)}
                                                ></div>
                                                <div className="absolute top-full left-0 z-20 mt-1 w-full min-w-[200px] rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95 bg-white max-h-[300px] flex flex-col">
                                                    <div className="p-2 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                                        <span className="text-xs font-semibold text-gray-500">Выберите статусы</span>
                                                        <button
                                                            onClick={toggleAllStatuses}
                                                            className="text-[10px] text-blue-600 font-bold uppercase hover:text-blue-800"
                                                        >
                                                            {filters.statuses.length === activeStatuses.length ? 'Снять все' : 'Выбрать все'}
                                                        </button>
                                                    </div>
                                                    <div className="overflow-y-auto p-1">
                                                        {activeStatuses.map((status) => (
                                                            <div
                                                                key={status.code}
                                                                className="flex items-center space-x-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground cursor-pointer hover:bg-gray-50"
                                                                onClick={() => toggleStatus(status.code)}
                                                            >
                                                                <div className={`flex h-4 w-4 items-center justify-center rounded border ${filters.statuses.includes(status.code) ? 'bg-primary border-primary bg-blue-600 border-blue-600' : 'border-primary opacity-50'}`}>
                                                                    {filters.statuses.includes(status.code) && (
                                                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white"><polyline points="20 6 9 17 4 12" /></svg>
                                                                    )}
                                                                </div>
                                                                <div className={`px-2 py-0.5 rounded text-[10px] font-medium border ${getStatusColor(status.group_name)}`}>
                                                                    {status.name}
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {activeStatuses.length === 0 && (
                                                            <div className="p-4 text-center text-xs text-gray-400">
                                                                Нет доступных статусов.
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
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
                    {filteredOrders.map((order) => {
                        const statusInfo = activeStatuses.find(s => s.code === order.raw_payload?.status);

                        return (
                            <Card key={order.id} className="overflow-hidden border-l-4" style={{
                                borderLeftColor:
                                    order.today_stats.status === 'success' ? '#22c55e' :
                                        order.today_stats.status === 'overdue' ? '#ef4444' :
                                            order.today_stats.status === 'fallback_required' ? '#f97316' : '#3b82f6'
                            }}>
                                <CardContent className="p-0">
                                    <div className="flex flex-col md:flex-row items-start md:items-center p-6 gap-6">
                                        <div className="flex-1 space-y-1">
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <a
                                                    href={`https://${order.raw_payload?.site?.replace('-ru', '')}.retailcrm.ru/orders/${order.id}/edit`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-lg font-bold hover:text-primary transition-colors hover:underline"
                                                >
                                                    #{order.number}
                                                </a>

                                                {statusInfo && (
                                                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusColor(statusInfo.group_name)}`}>
                                                        {statusInfo.name}
                                                    </span>
                                                )}

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
                        );
                    })}
                </div>
            </div>
            );
};
