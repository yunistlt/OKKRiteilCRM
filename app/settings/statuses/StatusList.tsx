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

    return (
        <div className="max-w-[1000px] mx-auto p-4 md:p-8 min-h-screen bg-white font-sans text-gray-800">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 pb-5 border-b border-gray-100">
                <h1 className="text-2xl md:text-3xl font-bold">Настройка статусов</h1>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className={`w-full sm:w-auto px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold transition hover:bg-blue-700 disabled:opacity-50 ${isSaving ? 'cursor-wait' : 'cursor-pointer'
                        }`}
                >
                    {isSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
            </div>

            {saveError && (
                <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-100">
                    {saveError}
                </div>
            )}

            <div className="space-y-6">
                {groupNames.map(group => (
                    <div key={group} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-gray-50 px-5 py-3 font-semibold text-gray-700 border-b border-gray-200 uppercase text-xs tracking-wider">
                            {group}
                        </div>
                        <div className="divide-y divide-gray-100">
                            {grouped[group].map(status => (
                                <div key={status.code}
                                    className={`p-4 md:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 transition-colors ${status.is_working || status.is_transcribable || status.is_ai_target ? 'bg-blue-50/30' : 'bg-white'
                                        }`}
                                >
                                    <div className="grid grid-cols-2 sm:flex sm:items-center gap-4 md:gap-6 w-full sm:w-auto">
                                        {/* 1. Working Toggle */}
                                        <div
                                            onClick={() => handleLocalToggle(status.code)}
                                            className="flex items-center gap-3 cursor-pointer select-none min-w-[90px]"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={status.is_working}
                                                readOnly
                                                className="w-4 h-4 md:w-5 md:h-5 cursor-pointer accent-blue-600"
                                            />
                                            <span className={`text-[9px] md:text-xs font-bold uppercase transition-colors ${status.is_working ? 'text-blue-600' : 'text-gray-400'
                                                }`}>
                                                Анализ
                                            </span>
                                        </div>

                                        {/* 2. Transcription Toggle */}
                                        <div
                                            onClick={() => handleTranscriptionToggle(status.code)}
                                            className="flex items-center gap-3 cursor-pointer select-none min-w-[120px]"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={status.is_transcribable}
                                                readOnly
                                                className="w-4 h-4 md:w-5 md:h-5 cursor-pointer accent-purple-600"
                                            />
                                            <span className={`text-[9px] md:text-xs font-bold uppercase transition-colors ${status.is_transcribable ? 'text-purple-600' : 'text-gray-400'
                                                }`}>
                                                Транскрибация
                                            </span>
                                        </div>

                                        {/* 3. AI Routing Toggle */}
                                        <div
                                            onClick={() => handleAiRoutingToggle(status.code)}
                                            className="flex items-center gap-3 cursor-pointer select-none min-w-[110px]"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={status.is_ai_target}
                                                readOnly
                                                className="w-4 h-4 md:w-5 md:h-5 cursor-pointer accent-green-600"
                                            />
                                            <span className={`text-[9px] md:text-xs font-bold uppercase transition-colors ${status.is_ai_target ? 'text-green-600' : 'text-gray-400'
                                                }`}>
                                                Роутинг ИИ
                                            </span>
                                        </div>
                                    </div>

                                    {/* 3. Status Info */}
                                    <div className="flex-1 w-full">
                                        <div className="font-semibold flex items-center gap-3 text-sm md:text-base">
                                            {status.name}
                                            {(counts[status.code] || 0) > 0 && (
                                                <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-bold">
                                                    {counts[status.code]}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[10px] md:text-xs text-gray-400 font-mono mt-0.5">{status.code}</div>
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
