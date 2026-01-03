'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

const PRESETS = [
    { label: 'Сегодня', days: 0 },
    { label: '1 день', days: 1 },
    { label: '2 дня', days: 2 },
    { label: '3 дня', days: 3 },
    { label: '4 дня', days: 4 },
    { label: '5 дней', days: 5 },
    { label: '6 дней', days: 6 },
    { label: '1 неделя', days: 7 },
    { label: '2 недели', days: 14 },
    { label: '3 недели', days: 21 },
    { label: '1 месяц', days: 30 },
    { label: '2 месяца', days: 60 },
    { label: '3 месяца', days: 90 },
    { label: 'полгода', days: 180 },
    { label: '1 год', days: 365 },
];

export default function DateRangePicker() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';

    const [tempFrom, setTempFrom] = useState(from);
    const [tempTo, setTempTo] = useState(to);

    useEffect(() => {
        setTempFrom(from);
        setTempTo(to);
    }, [from, to]);

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

    const updateUrl = (newFrom: string, newTo: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (newFrom) params.set('from', newFrom); else params.delete('from');
        if (newTo) params.set('to', newTo); else params.delete('to');
        router.push(`${pathname}?${params.toString()}`);
        setIsOpen(false);
    };

    const applyPreset = (days: number) => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - days);

        const fromStr = start.toISOString().split('T')[0];
        const toStr = end.toISOString().split('T')[0];
        updateUrl(fromStr, toStr);
    };

    const handleReset = () => {
        updateUrl('', '');
    };

    const displayDate = () => {
        if (!from && !to) return 'Выберите период';
        if (from === to) return from;
        return `${from || '...'} — ${to || '...'}`;
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-3 px-4 py-2 bg-gray-800 border border-gray-700 rounded-xl hover:border-blue-500 transition-all text-sm font-black tracking-tight group"
            >
                <span className="text-blue-400 group-hover:scale-110 transition-transform">📅</span>
                <span className="text-gray-100">{displayDate()}</span>
                <svg className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-3 w-[320px] bg-white rounded-3xl shadow-2xl shadow-black/20 border border-gray-100 z-[100] p-6 animate-in fade-in zoom-in-95 duration-200">
                    <div className="mb-6">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Преднастроенные периоды (Назад)</p>
                        <div className="flex flex-wrap gap-2">
                            {PRESETS.map((p) => (
                                <button
                                    key={p.label}
                                    onClick={() => applyPreset(p.days)}
                                    className="px-3 py-1.5 bg-gray-50 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-bold text-gray-500 transition-all border border-gray-100"
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-gray-100 pt-6">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Свой диапазон</p>
                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 mb-2 ml-1">ОТ</label>
                                <input
                                    type="date"
                                    value={tempFrom}
                                    onChange={(e) => setTempFrom(e.target.value)}
                                    className="w-full bg-gray-50 border-0 rounded-xl p-3 text-xs font-black text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 mb-2 ml-1">ДО</label>
                                <input
                                    type="date"
                                    value={tempTo}
                                    onChange={(e) => setTempTo(e.target.value)}
                                    className="w-full bg-gray-50 border-0 rounded-xl p-3 text-xs font-black text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleReset}
                                className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-200 transition-all"
                            >
                                Сбросить
                            </button>
                            <button
                                onClick={() => updateUrl(tempFrom, tempTo)}
                                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 shadow-lg shadow-blue-100 transition-all"
                            >
                                Применить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
