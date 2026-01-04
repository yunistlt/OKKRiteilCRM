
'use client'

import { useState } from 'react';
import { updateRuleStatus, updateRuleParams } from '@/app/actions/rules';

export default function RuleCard({ rule }: { rule: any }) {
    const [isLoading, setIsLoading] = useState(false);
    const [params, setParams] = useState(rule.parameters);

    const handleToggle = async () => {
        setIsLoading(true);
        try {
            await updateRuleStatus(rule.code, !rule.is_active);
        } finally {
            setIsLoading(false);
        }
    };

    const handleParamChange = async (key: string, value: any) => {
        const newParams = { ...params, [key]: Number(value) }; // Assuming numeric for now
        setParams(newParams);
        // Debounce? For now just save on blur or button?
        // Let's simple "Save" button or onBlur.
        // Doing onBlur for simplicity.
        try {
            await updateRuleParams(rule.code, newParams);
        } catch (e) {
            console.error(e);
        }
    };

    // Render Specific Inputs based on Rule Code (Variant A: Hardcoded UX)
    const renderInputs = () => {
        if (rule.code === 'SHORT_CALL') {
            return (
                <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700">Минимальная длительность (сек)</label>
                    <input
                        type="number"
                        defaultValue={params.min_duration}
                        onBlur={(e) => handleParamChange('min_duration', e.target.value)}
                        className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">Звонки короче этого времени считаются нарушением / сбросом.</p>
                </div>
            );
        }
        if (rule.code === 'SLA_BREACH') {
            return (
                <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700">SLA на обработку (минут)</label>
                    <input
                        type="number"
                        defaultValue={params.sla_minutes}
                        onBlur={(e) => handleParamChange('sla_minutes', e.target.value)}
                        className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                    />
                </div>
            );
        }

        // Default Key-Value renderer for unknown/other rules
        return (
            <div className="mt-4 text-xs text-gray-500 bg-gray-50 p-2 rounded">
                <pre>{JSON.stringify(params, null, 2)}</pre>
                <div className="mt-1 italic">Параметры редактируются через JSON (пока не добавлен UI)</div>
            </div>
        );
    };

    return (
        <div className={`border rounded-lg p-6 shadow-sm transition-all ${rule.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-75'}`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                        {rule.name}
                        <span className={`text-xs px-2 py-0.5 rounded-full uppercase ${rule.severity === 'critical' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                            {rule.severity}
                        </span>
                    </h3>
                    <p className="mt-1 text-sm text-gray-500 max-w-xl">{rule.description}</p>
                </div>
                <button
                    onClick={handleToggle}
                    disabled={isLoading}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${rule.is_active ? 'bg-green-600' : 'bg-gray-200'}`}
                >
                    <span className="sr-only">Use setting</span>
                    <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${rule.is_active ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                </button>
            </div>

            {rule.is_active && (
                <div className="mt-4 border-t pt-4">
                    {renderInputs()}
                </div>
            )}
        </div>
    );
}
