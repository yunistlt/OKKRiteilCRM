'use client';

import { useState } from 'react';

export interface StatusGroup {
    groupCode: string | null;
    groupName: string;
    total: number;
    statuses: Array<{ code: string; label: string; count: number }>;
}

interface OrdersStatusSidebarProps {
    tree: StatusGroup[];
    selected: string[];
    onSelect: (statuses: string[]) => void;
}

/**
 * Левая колонка списка заказов — как в RetailCRM: статусы сгруппированы по этапам,
 * рядом количество заказов. Клик по группе берёт все её статусы, клик по статусу — один.
 */
export default function OrdersStatusSidebar({ tree, selected, onSelect }: OrdersStatusSidebarProps) {
    const [collapsed, setCollapsed] = useState(false);
    const totalAll = tree.reduce((sum, g) => sum + g.total, 0);

    if (collapsed) {
        return (
            <button
                onClick={() => setCollapsed(false)}
                className="h-full border-r border-gray-200 bg-white px-2 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-900"
                title="Показать статусы"
            >
                →
            </button>
        );
    }

    return (
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Статусы</span>
                <button onClick={() => setCollapsed(true)} className="text-[10px] font-bold text-gray-400 hover:text-gray-900">
                    Свернуть
                </button>
            </div>

            <button
                onClick={() => onSelect([])}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm ${selected.length === 0 ? 'bg-gray-900 font-bold text-white' : 'font-bold text-gray-900 hover:bg-gray-100'}`}
            >
                <span>Все</span>
                <span className={selected.length === 0 ? 'text-white' : 'text-gray-400'}>{totalAll}</span>
            </button>

            {tree.map((group) => {
                const groupCodes = group.statuses.map((s) => s.code);
                const groupSelected = groupCodes.length > 0 && groupCodes.every((c) => selected.includes(c));

                return (
                    <div key={group.groupCode ?? group.groupName} className="border-t border-gray-100">
                        <button
                            onClick={() => onSelect(groupSelected ? [] : groupCodes)}
                            className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-black uppercase tracking-wide ${groupSelected ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                        >
                            <span className="truncate">{group.groupName}</span>
                            <span className={groupSelected ? 'text-white' : 'text-gray-400'}>{group.total}</span>
                        </button>

                        {group.statuses.map((status) => {
                            const isSelected = selected.includes(status.code);
                            return (
                                <button
                                    key={status.code}
                                    onClick={() => onSelect(isSelected ? selected.filter((c) => c !== status.code) : [...selected, status.code])}
                                    className={`flex w-full items-center justify-between px-3 py-1 pl-5 text-left text-[13px] ${isSelected ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                                >
                                    <span className="truncate">{status.label}</span>
                                    <span className={isSelected ? 'text-white' : 'text-gray-400'}>{status.count}</span>
                                </button>
                            );
                        })}
                    </div>
                );
            })}

            {tree.length === 0 && (
                <p className="px-3 py-4 text-xs text-gray-500">Заказов под текущий фильтр нет.</p>
            )}
        </aside>
    );
}
