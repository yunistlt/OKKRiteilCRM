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
                className="border-r border-gray-300 bg-white px-3 py-3 text-sm text-gray-700 hover:text-gray-900"
                title="Показать статусы"
            >
                →
            </button>
        );
    }

    return (
        <aside className="w-60 shrink-0 border-r border-gray-200 bg-white">
            <button
                onClick={() => setCollapsed(true)}
                className="px-4 py-3 text-sm text-gray-700 hover:text-gray-900"
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
                <span className="font-semibold text-gray-600">{totalAll.toLocaleString('ru-RU')}</span>
            </button>

            {tree.map((group) => {
                const groupCodes = group.statuses.map((s) => s.code);
                const groupSelected = groupCodes.length > 0 && groupCodes.every((c) => selected.includes(c));
                const accent = group.color || '#94a3b8';

                return (
                    <div key={group.groupCode ?? group.groupName} className="pt-3">
                        {/* Этап читается первым: цветная полоса слева и название
                            цветом этапа, как в RetailCRM. Серый квадратик рядом с
                            серым текстом раньше сливался в кашу. */}
                        <button
                            onClick={() => onSelect(groupSelected ? [] : groupCodes)}
                            style={{ borderLeftColor: accent, backgroundColor: groupSelected ? tint(accent) : undefined }}
                            className={`flex w-full items-start justify-between gap-2 border-l-4 px-3 py-1.5 text-left ${
                                groupSelected ? '' : 'hover:bg-gray-50'
                            }`}
                        >
                            <span
                                className="truncate text-[13px] font-black uppercase tracking-wide"
                                style={{ color: darken(accent) }}
                            >
                                {group.groupName}
                            </span>
                            <span className="shrink-0 text-xs font-bold" style={{ color: darken(accent) }}>
                                {group.total.toLocaleString('ru-RU')}
                            </span>
                        </button>

                        {group.statuses.map((status) => {
                            const isSelected = selected.includes(status.code);
                            return (
                                <button
                                    key={status.code}
                                    onClick={() => onSelect(isSelected ? selected.filter((c) => c !== status.code) : [...selected, status.code])}
                                    style={{
                                        backgroundColor: isSelected ? tint(status.color || accent) : undefined,
                                        borderLeftColor: isSelected ? darken(status.color || accent) : 'transparent',
                                    }}
                                    className={`flex w-full items-start justify-between gap-2 border-l-4 py-1 pl-5 pr-3 text-left text-[13px] ${
                                        isSelected ? 'font-bold text-gray-900' : 'text-gray-800 hover:bg-gray-100'
                                    }`}
                                >
                                    <span className="min-w-0 flex-1 leading-snug">{status.label}</span>
                                    <span className="shrink-0 text-xs font-semibold text-gray-600">{status.count.toLocaleString('ru-RU')}</span>
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

/** Та же краска, подмешанная к белому: фон выбранной строки, по которому читается текст. */
function tint(hex: string): string {
    const m = /^#?([\da-f]{6})$/i.exec(hex);
    if (!m) return '#eef2ff';
    const num = parseInt(m[1], 16);
    const mix = (channel: number) => Math.round(255 - (255 - channel) * 0.25);
    return `rgb(${mix((num >> 16) & 255)}, ${mix((num >> 8) & 255)}, ${mix(num & 255)})`;
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
