'use client';

import { useMemo, useState } from 'react';
import type { ViewItem } from '@/lib/orders-view';

interface ViewSettingsModalProps {
    title: string;
    registry: ViewItem[];
    selected: string[];
    defaults: string[];
    onSave: (next: string[]) => void;
    onClose: () => void;
}

/**
 * Окно настройки состава и порядка — как две шестерёнки RetailCRM: слева выбранное
 * в порядке показа, справа полный список по разделам с поиском.
 */
export default function ViewSettingsModal({ title, registry, selected, defaults, onSave, onClose }: ViewSettingsModalProps) {
    const [current, setCurrent] = useState<string[]>(selected);
    const [search, setSearch] = useState('');

    const byKey = useMemo(() => new Map(registry.map((i) => [i.key, i])), [registry]);

    const groups = useMemo(() => {
        const query = search.trim().toLowerCase();
        const map = new Map<string, ViewItem[]>();
        for (const item of registry) {
            if (query && !item.label.toLowerCase().includes(query)) continue;
            if (!map.has(item.group)) map.set(item.group, []);
            map.get(item.group)!.push(item);
        }
        return Array.from(map.entries());
    }, [registry, search]);

    const toggle = (key: string) => {
        const item = byKey.get(key);
        if (item?.locked) return;
        setCurrent((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    };

    const move = (index: number, delta: number) => {
        setCurrent((prev) => {
            const next = [...prev];
            const target = index + delta;
            if (target < 0 || target >= next.length) return prev;
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
            <div
                onClick={(e) => e.stopPropagation()}
                className="flex max-h-[80vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl"
            >
                <div className="flex items-center gap-4 border-b border-gray-200 px-6 py-4">
                    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Поиск"
                        className="ml-auto w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
                    />
                    <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
                </div>

                <div className="flex min-h-0 flex-1">
                    <div className="w-64 shrink-0 overflow-y-auto border-r border-gray-200 py-2">
                        <p className="px-4 pb-2 text-xs text-gray-400">Порядок показа</p>
                        {current.length === 0 && <p className="px-4 text-sm text-gray-400">Ничего не выбрано</p>}
                        {current.map((key, index) => {
                            const item = byKey.get(key);
                            if (!item) return null;
                            return (
                                <div key={key} className="group flex items-center gap-1 px-4 py-1.5 hover:bg-gray-50">
                                    <span className="flex-1 truncate text-sm text-gray-700">{item.label}</span>
                                    <button
                                        onClick={() => move(index, -1)}
                                        disabled={index === 0}
                                        className="px-1 text-xs text-gray-400 hover:text-blue-600 disabled:opacity-30"
                                        title="Выше"
                                    >
                                        ↑
                                    </button>
                                    <button
                                        onClick={() => move(index, 1)}
                                        disabled={index === current.length - 1}
                                        className="px-1 text-xs text-gray-400 hover:text-blue-600 disabled:opacity-30"
                                        title="Ниже"
                                    >
                                        ↓
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <div className="min-w-0 flex-1 overflow-y-auto bg-gray-50 px-6 py-4">
                        {groups.length === 0 && <p className="text-sm text-gray-500">Ничего не найдено.</p>}
                        {groups.map(([group, items]) => (
                            <div key={group} className="mb-5">
                                <p className="mb-2 text-sm text-gray-500">{group}</p>
                                <div className="grid gap-2 md:grid-cols-3">
                                    {items.map((item) => (
                                        <label
                                            key={item.key}
                                            className={`flex items-center gap-2 text-sm ${item.locked ? 'text-gray-400' : 'cursor-pointer text-gray-800'}`}
                                            title={item.locked ? 'Эту колонку убрать нельзя' : undefined}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={current.includes(item.key)}
                                                disabled={item.locked}
                                                onChange={() => toggle(item.key)}
                                                className="h-4 w-4 rounded border-gray-300 text-blue-600"
                                            />
                                            <span className="truncate">{item.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
                    <button
                        onClick={() => onSave(current)}
                        className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        Сохранить
                    </button>
                    <button onClick={() => setCurrent(defaults)} className="text-sm text-blue-600 hover:underline">
                        Сбросить
                    </button>
                </div>
            </div>
        </div>
    );
}
