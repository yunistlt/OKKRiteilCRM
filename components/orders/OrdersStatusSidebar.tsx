'use client';

import { useState } from 'react';

export interface StatusGroup {
    groupCode: string | null;
    groupName: string;
    total: number;
    color?: string | null;
    statuses: Array<{ code: string; label: string; count: number; color?: string | null }>;
}

interface OrdersStatusSidebarProps {
    tree: StatusGroup[];
    selected: string[];
    onSelect: (statuses: string[]) => void;
}

/**
 * Левая колонка списка заказов — повторяет RetailCRM: этапы с количеством, под ними
 * статусы. Цвет группы берём из цвета её статусов, чтобы взгляд цеплялся так же.
 */
export default function OrdersStatusSidebar({ tree, selected, onSelect }: OrdersStatusSidebarProps) {
    const [collapsed, setCollapsed] = useState(false);
    const totalAll = tree.reduce((sum, g) => sum + g.total, 0);

    if (collapsed) {
        return (
            <button
                onClick={() => setCollapsed(false)}
                className="h-full border-r border-gray-200 bg-white px-3 py-3 text-sm text-gray-500 hover:text-gray-800"
                title="Показать статусы"
            >
                →
            </button>
        );
    }

    return (
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
            <button
                onClick={() => setCollapsed(true)}
                className="px-4 py-3 text-sm text-gray-500 hover:text-gray-800"
            >
                ← Свернуть
            </button>

            <button
                onClick={() => onSelect([])}
                className={`flex w-full items-center justify-between px-4 py-1.5 text-left text-sm ${
                    selected.length === 0 ? 'bg-blue-50 font-semibold text-gray-900' : 'text-gray-800 hover:bg-gray-50'
                }`}
            >
                <span>Все</span>
                <span className="text-gray-400">{totalAll.toLocaleString('ru-RU')}</span>
            </button>

            {tree.map((group) => {
                const groupCodes = group.statuses.map((s) => s.code);
                const groupSelected = groupCodes.length > 0 && groupCodes.every((c) => selected.includes(c));
                const accent = group.color || '#94a3b8';

                return (
                    <div key={group.groupCode ?? group.groupName} className="pt-3">
                        <button
                            onClick={() => onSelect(groupSelected ? [] : groupCodes)}
                            className={`flex w-full items-start justify-between gap-2 px-4 py-1 text-left ${
                                groupSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: accent }} />
                                <span className="truncate text-sm font-semibold" style={{ color: darken(accent) }}>
                                    {group.groupName}
                                </span>
                            </span>
                            <span className="shrink-0 text-xs text-gray-400">{group.total.toLocaleString('ru-RU')}</span>
                        </button>

                        {group.statuses.map((status) => {
                            const isSelected = selected.includes(status.code);
                            return (
                                <button
                                    key={status.code}
                                    onClick={() => onSelect(isSelected ? selected.filter((c) => c !== status.code) : [...selected, status.code])}
                                    style={isSelected ? { backgroundColor: status.color || group.color || '#e0e7ff' } : undefined}
                                    className={`flex w-full items-start justify-between gap-2 py-1 pl-8 pr-4 text-left text-sm ${
                                        isSelected ? 'font-medium text-gray-900' : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <span className="min-w-0 flex-1 leading-snug">{status.label}</span>
                                    <span className="shrink-0 text-xs text-gray-500">{status.count.toLocaleString('ru-RU')}</span>
                                </button>
                            );
                        })}
                    </div>
                );
            })}

            {tree.length === 0 && <p className="px-4 py-4 text-sm text-gray-500">Заказов под текущий фильтр нет.</p>}
        </aside>
    );
}

/** Пастельные цвета статусов слишком светлые для текста — затемняем до читаемого. */
function darken(hex: string): string {
    const m = /^#?([\da-f]{6})$/i.exec(hex);
    if (!m) return '#334155';
    const num = parseInt(m[1], 16);
    const r = Math.round(((num >> 16) & 255) * 0.45);
    const g = Math.round(((num >> 8) & 255) * 0.45);
    const b = Math.round((num & 255) * 0.45);
    return `rgb(${r}, ${g}, ${b})`;
}
