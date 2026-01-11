'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Calendar, ChevronDown, Check, X } from 'lucide-react';

export type DateRangePreset = 'today' | 'yesterday' | 'tomorrow' | 'next_3_days' | 'next_7_days' | 'past_3_days' | 'past_7_days' | 'this_week' | 'next_week' | 'month' | null;

interface DateRangePickerProps {
    value?: { from: string; to: string; preset?: DateRangePreset };
    onChange?: (range: { from: string; to: string; preset?: DateRangePreset }) => void;
    placeholder?: string;
    className?: string;
}

export const PRESETS_CONFIG: { id: DateRangePreset; label: string; getRange: () => { from: Date; to: Date } }[] = [
    {
        id: 'today',
        label: 'Сегодня',
        getRange: () => {
            const now = new Date();
            return { from: now, to: now };
        }
    },
    {
        id: 'tomorrow',
        label: 'Завтра',
        getRange: () => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            return { from: d, to: d };
        }
    },
    {
        id: 'yesterday',
        label: 'Вчера',
        getRange: () => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            return { from: d, to: d };
        }
    },
    {
        id: 'next_3_days',
        label: 'След. 3 дня',
        getRange: () => {
            const from = new Date();
            const to = new Date();
            to.setDate(to.getDate() + 3);
            return { from, to };
        }
    },
    {
        id: 'next_7_days',
        label: 'След. неделя',
        getRange: () => {
            const from = new Date();
            const to = new Date();
            to.setDate(to.getDate() + 7);
            return { from, to };
        }
    },
    {
        id: 'past_3_days',
        label: 'Посл. 3 дня',
        getRange: () => {
            const to = new Date();
            const from = new Date();
            from.setDate(from.getDate() - 3);
            return { from, to };
        }
    },
    {
        id: 'past_7_days',
        label: 'Посл. неделя',
        getRange: () => {
            const to = new Date();
            const from = new Date();
            from.setDate(from.getDate() - 7);
            return { from, to };
        }
    },
    {
        id: 'month',
        label: 'Этот месяц',
        getRange: () => {
            const now = new Date();
            const from = new Date(now.getFullYear(), now.getMonth(), 1);
            const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            return { from, to };
        }
    }
];

export const resolveDatePreset = (presetId: DateRangePreset) => {
    const preset = PRESETS_CONFIG.find(p => p.id === presetId);
    if (!preset) return null;
    const { from, to } = preset.getRange();
    return {
        from: from.toISOString().split('T')[0],
        to: to.toISOString().split('T')[0]
    };
};

export default function DateRangePicker({ value, onChange, placeholder = "Выберите период", className }: DateRangePickerProps) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Controlled vs Uncontrolled logic
    const isControlled = value !== undefined && onChange !== undefined;

    const urlFrom = searchParams.get('from') || '';
    const urlTo = searchParams.get('to') || '';

    const currentFrom = isControlled ? value.from : urlFrom;
    const currentTo = isControlled ? value.to : urlTo;
    const currentPreset = isControlled ? value.preset : null; // URL mode doesn't store preset explicitly yet

    const [tempFrom, setTempFrom] = useState(currentFrom);
    const [tempTo, setTempTo] = useState(currentTo);

    useEffect(() => {
        setTempFrom(currentFrom);
        setTempTo(currentTo);
    }, [currentFrom, currentTo, isOpen]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const handleApply = (newFrom: string, newTo: string, preset: DateRangePreset = null) => {
        if (isControlled) {
            onChange({ from: newFrom, to: newTo, preset });
        } else {
            const params = new URLSearchParams(searchParams.toString());
            if (newFrom) params.set('from', newFrom); else params.delete('from');
            if (newTo) params.set('to', newTo); else params.delete('to');
            router.push(`${pathname}?${params.toString()}`);
        }
        setIsOpen(false);
    };

    const applyPreset = (presetId: DateRangePreset) => {
        const preset = PRESETS_CONFIG.find(p => p.id === presetId);
        if (!preset) return;

        const { from, to } = preset.getRange();
        handleApply(formatDate(from), formatDate(to), presetId);
    };

    const handleManualApply = () => {
        handleApply(tempFrom, tempTo, null);
    };

    const handleReset = () => {
        handleApply('', '', null);
    };

    const displayLabel = () => {
        if (currentPreset) {
            const preset = PRESETS_CONFIG.find(p => p.id === currentPreset);
            if (preset) return preset.label;
        }
        if (!currentFrom && !currentTo) return placeholder;
        if (currentFrom === currentTo) return new Date(currentFrom).toLocaleDateString('ru-RU');
        return `${new Date(currentFrom).toLocaleDateString('ru-RU')} — ${new Date(currentTo).toLocaleDateString('ru-RU')}`;
    };

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center justify-between w-full h-9 px-3 py-1 bg-white border border-gray-200 rounded-md text-sm hover:border-blue-400 transition-colors shadow-sm"
            >
                <div className="flex items-center gap-2 truncate">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span className={`text-sm ${!currentFrom ? 'text-gray-400' : 'text-gray-700 font-medium'}`}>
                        {displayLabel()}
                    </span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <>
                    {/* Backdrop for Mobile */}
                    <div
                        className="fixed inset-0 bg-black/50 z-40 md:hidden"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Modal/Popover */}
                    <div className="fixed inset-x-4 top-[20%] z-50 md:absolute md:inset-auto md:top-full md:left-0 md:mt-2 w-auto md:w-[500px] bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col md:flex-row max-h-[80vh] md:max-h-none">
                        {/* Presets Column */}
                        <div className="w-full md:w-48 bg-gray-50/80 p-3 border-b md:border-b-0 md:border-r border-gray-100/50 flex flex-row md:flex-col gap-2 md:gap-1 overflow-x-auto md:overflow-x-visible md:overflow-y-auto max-h-[300px] no-scrollbar">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-2 hidden md:block">Быстрый выбор</span>
                            {PRESETS_CONFIG.map((p) => (
                                <button
                                    key={p.id}
                                    onClick={() => applyPreset(p.id)}
                                    className={`
                                        flex items-center justify-between whitespace-nowrap px-3 py-2 rounded-md text-xs font-medium transition-all shrink-0 md:shrink
                                        ${currentPreset === p.id
                                            ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                                            : 'text-gray-600 hover:bg-white hover:shadow-sm bg-white md:bg-transparent border md:border-0 border-gray-100'
                                        }
                                    `}
                                >
                                    {p.label}
                                    {currentPreset === p.id && <Check className="w-3 h-3 ml-2" />}
                                </button>
                            ))}
                        </div>

                        {/* Manual Range Column */}
                        <div className="flex-1 p-4 md:p-5">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-4 block">Точный диапазон</span>

                            <div className="grid grid-cols-2 gap-3 md:gap-4 mb-6">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-gray-500 ml-1">С даты</label>
                                    <input
                                        type="date"
                                        value={tempFrom}
                                        onChange={(e) => setTempFrom(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 md:p-2.5 text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-gray-500 ml-1">По дату</label>
                                    <input
                                        type="date"
                                        value={tempTo}
                                        onChange={(e) => setTempTo(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 md:p-2.5 text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                                <button
                                    onClick={handleReset}
                                    className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    Сбросить
                                </button>
                                <button
                                    onClick={handleManualApply}
                                    className="flex-1 px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-lg hover:bg-black transition-all shadow-lg shadow-gray-200 active:scale-95"
                                >
                                    Применить
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
