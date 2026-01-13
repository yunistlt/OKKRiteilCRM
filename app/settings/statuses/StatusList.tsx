'use client';

import { useState } from 'react';
import { saveSettingsBatch } from './actions';

// We define this interface to match what's passed from the server page
export interface StatusItem {
    code: string;
    name: string;
    is_active?: boolean;
    is_working: boolean;
    is_transcribable: boolean;
    is_ai_target: boolean;
    ordering: number;
    group_name: string;
}

interface StatusListProps {
    initialStatuses: StatusItem[];
    counts?: Record<string, number>;
}

export default function StatusList({ initialStatuses, counts = {} }: StatusListProps) {
    const [statuses, setStatuses] = useState<StatusItem[]>(initialStatuses);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);

    function handleLocalToggle(code: string) {
        setHasChanges(true);
        setStatuses(prev => prev.map(s =>
            s.code === code ? { ...s, is_working: !s.is_working } : s
        ));
    }

    function handleTranscriptionToggle(code: string) {
        setHasChanges(true);
        setStatuses(prev => prev.map(s =>
            s.code === code ? { ...s, is_transcribable: !s.is_transcribable } : s
        ));
    }

    function handleAiRoutingToggle(code: string) {
        setHasChanges(true);
        setStatuses(prev => prev.map(s =>
            s.code === code ? { ...s, is_ai_target: !s.is_ai_target } : s
        ));
    }

    async function handleSave() {
        if (isSaving) return;
        setIsSaving(true);
        setSaveError(null);

        try {
            const payload = statuses.map(s => ({
                code: s.code,
                is_working: s.is_working,
                is_transcribable: s.is_transcribable,
                is_ai_target: s.is_ai_target
            }));

            const result = await saveSettingsBatch(payload);
            if (!result.success) throw new Error(result.error);
            setHasChanges(false);
            window.location.href = '/';
        } catch (err: any) {
            console.error('Save Failed:', err);
            setSaveError(`Не удалось сохранить: ${err.message}`);
        } finally {
            setIsSaving(false);
        }
    }

    const grouped: Record<string, StatusItem[]> = {};
    statuses.forEach(s => {
        if (s.is_active === false) return;
        const g = s.group_name || 'Без группы';
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push(s);
    });

    const groupNames = Object.keys(grouped).sort();

    const tooltips = {
        analysis: "КОНТРОЛЬ ЗАВИСАНИЯ: Если галочка стоит, система следит за временем нахождения заказа в этом статусе. Если движения нет слишком долго — заказ подсветится красным.",
        transcription: "ПЕРЕВОД В ТЕКСТ: Автоматическое преобразование звонков в текст для этого статуса. Это топливо для ИИ-анализа разговоров.",
        routing: "РАЗРЕШЕННЫЕ ЦЕЛИ: Список статусов, в которые ИИ разрешено переводить заказы. Если галочка снята — ИИ никогда не выберет этот статус как цель."
    };

    return (
        <div className="max-w-[1000px] mx-auto p-4 md:p-8 min-h-screen bg-white font-sans text-gray-800">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 pb-5 border-b border-gray-100">
                <div className="flex items-center gap-4">
                    <a href="/" className="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                        <span className="text-lg">←</span>
                    </a>
                    <h1 className="text-2xl md:text-3xl font-black tracking-tight">Настройка ОКК</h1>
                </div>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className={`w-full sm:w-auto px-8 py-3 bg-gray-900 text-white rounded-xl font-black uppercase text-xs tracking-widest transition-all hover:bg-blue-600 shadow-xl shadow-blue-200 active:scale-95 disabled:opacity-50 ${isSaving ? 'cursor-wait' : 'cursor-pointer'
                        }`}
                >
                    {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
            </div>

            {saveError && (
                <div className="bg-red-50 text-red-700 p-4 rounded-xl mb-6 border border-red-100 font-bold text-sm">
                    {saveError}
                </div>
            )}

            {/* Column Headers with Tooltips */}
            <div className="hidden sm:grid grid-cols-[320px_1fr] gap-4 px-5 py-3 mb-2">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Название статуса</div>
                <div className="flex gap-6">
                    <div className="group relative min-w-[90px] cursor-help">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 border-b border-dotted border-gray-300">Анализ</span>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-4 bg-gray-900 text-white text-[11px] leading-relaxed rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                            {tooltips.analysis}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-900"></div>
                        </div>
                    </div>
                    <div className="group relative min-w-[120px] cursor-help">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 border-b border-dotted border-gray-300">Транскрибация</span>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-4 bg-gray-900 text-white text-[11px] leading-relaxed rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                            {tooltips.transcription}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-900"></div>
                        </div>
                    </div>
                    <div className="group relative min-w-[110px] cursor-help">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 border-b border-dotted border-gray-300">Роутинг ИИ</span>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-4 bg-gray-900 text-white text-[11px] leading-relaxed rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                            {tooltips.routing}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-900"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                {groupNames.map(group => (
                    <div key={group} className="bg-white rounded-[24px] overflow-hidden border border-gray-100 shadow-xl shadow-gray-200/40">
                        <div className="bg-gray-50/50 px-5 py-3 font-black text-gray-400 uppercase text-[9px] tracking-[0.3em] border-b border-gray-100">
                            {group}
                        </div>
                        <div className="divide-y divide-gray-50">
                            {grouped[group].map(status => (
                                <div key={status.code}
                                    className={`p-4 flex flex-col gap-3 transition-all hover:bg-gray-50/50 ${status.is_working || status.is_transcribable || status.is_ai_target ? 'bg-blue-50/10' : 'bg-white'
                                        }`}
                                >
                                    {/* Status Name */}
                                    <div className="font-bold flex items-center gap-3 text-sm text-gray-900 tracking-tight">
                                        {status.name}
                                        {(counts[status.code] || 0) > 0 && (
                                            <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-[10px] font-black">
                                                {counts[status.code]}
                                            </span>
                                        )}
                                    </div>

                                    {/* Toggles Row */}
                                    <div className="flex items-center gap-4 md:gap-6 w-full overflow-x-auto no-scrollbar pt-1">
                                        {/* 1. Working Toggle */}
                                        <div
                                            onClick={() => handleLocalToggle(status.code)}
                                            className="flex items-center gap-2 cursor-pointer select-none shrink-0"
                                        >
                                            <div className={`w-4 h-4 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${status.is_working ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
                                                {status.is_working && <span className="text-white text-[10px] font-bold">✓</span>}
                                            </div>
                                            <span className={`text-[10px] font-bold uppercase tracking-wider ${status.is_working ? 'text-blue-600' : 'text-gray-400'}`}>
                                                Анализ
                                            </span>
                                        </div>

                                        {/* 2. Transcription Toggle */}
                                        <div
                                            onClick={() => handleTranscriptionToggle(status.code)}
                                            className="flex items-center gap-2 cursor-pointer select-none shrink-0"
                                        >
                                            <div className={`w-4 h-4 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${status.is_transcribable ? 'bg-purple-600 border-purple-600' : 'bg-white border-gray-300'}`}>
                                                {status.is_transcribable && <span className="text-white text-[10px] font-bold">✓</span>}
                                            </div>
                                            <span className={`text-[10px] font-bold uppercase tracking-wider ${status.is_transcribable ? 'text-purple-600' : 'text-gray-400'}`}>
                                                Текст
                                            </span>
                                        </div>

                                        {/* 3. AI Routing Toggle */}
                                        <div
                                            onClick={() => handleAiRoutingToggle(status.code)}
                                            className="flex items-center gap-2 cursor-pointer select-none shrink-0"
                                        >
                                            <div className={`w-4 h-4 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${status.is_ai_target ? 'bg-green-600 border-green-600' : 'bg-white border-gray-300'}`}>
                                                {status.is_ai_target && <span className="text-white text-[10px] font-bold">✓</span>}
                                            </div>
                                            <span className={`text-[10px] font-bold uppercase tracking-wider ${status.is_ai_target ? 'text-green-600' : 'text-gray-400'}`}>
                                                Роутинг
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-12 flex justify-center pb-12">
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className={`w-full md:w-auto px-12 py-4 bg-blue-600 text-white rounded-xl text-lg font-bold shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 ${isSaving ? 'cursor-wait' : 'cursor-pointer'
                        }`}
                >
                    {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
            </div>
        </div>
    );
}
