
'use client'

import { useState } from 'react';
import { updateRuleStatus, updateRuleParams } from '@/app/actions/rules';
import NewRuleModal from './new-rule-modal';

export default function RuleCard({ rule, violationCount }: { rule: any, violationCount: number }) {
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
        // Doing onBlur for simplicity.
        try {
            await updateRuleParams(rule.code, newParams);
        } catch (e) {
            console.error(e);
        }
    };

    const handleRunAudit = async () => {
        const daysStr = prompt('Сколько дней проверить в истории?', '7');
        if (!daysStr) return;
        const days = parseInt(daysStr);
        if (isNaN(days) || days <= 0) {
            alert('Введите корректное число дней');
            return;
        }

        if (!confirm(`Запустить проверку событий за последние ${days} дней? Это может занять время.`)) return;

        setIsLoading(true); // Reusing existing loading state
        try {
            const baseUrl = window.location.origin;
            const res = await fetch(`${baseUrl}/api/rules/audit-history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ruleId: rule.id,
                    days: days
                })
            });
            const data = await res.json();

            if (data.count > 0) {
                alert(`✅ Готово! Найдено НОВЫХ нарушений: ${data.count}.\nОни добавлены в отчет.`);
                // Trigger refresh if possible?
                window.location.reload(); // Simple refresh to update counts
            } else {
                alert('✅ Проверка завершена. Нарушений за этот период не найдено.');
            }
        } catch (e: any) {
            alert('Ошибка запуска: ' + e.message);
        } finally {
            setIsLoading(false);
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

        if (Object.keys(params).length === 0) return null;

        return (
            <div className="mt-4 text-xs text-gray-500 bg-gray-50 p-2 rounded">
                <pre>{JSON.stringify(params, null, 2)}</pre>
                <div className="mt-1 italic">Параметры редактируются через JSON (пока не добавлен UI)</div>
            </div>
        );
    };

    return (
        <div className={`border rounded-lg p-4 md:p-6 shadow-sm transition-all ${rule.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-75'}`}>
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="flex-1 min-w-0 w-full">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="text-base md:text-lg font-medium text-gray-900 truncate">
                            {rule.name}
                        </h3>
                        <span className={`text-[10px] md:text-xs px-2 py-0.5 rounded-full uppercase ${rule.severity === 'critical' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                            {rule.severity}
                        </span>
                    </div>
                    <p className="text-xs md:text-sm text-gray-500 line-clamp-2 md:line-clamp-none mb-3" title={rule.description}>
                        {rule.description}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {params.manager_ids?.length > 0 && (
                            <span className="bg-blue-50 text-blue-700 text-[10px] px-2 py-0.5 rounded font-bold border border-blue-100 flex items-center gap-1">
                                👤 {params.manager_ids.length} Менедж.
                            </span>
                        )}
                        {params.order_ids?.length > 0 && (
                            <span className="bg-purple-50 text-purple-700 text-[10px] px-2 py-0.5 rounded font-bold border border-purple-100 flex items-center gap-1">
                                📦 {params.order_ids.length} Заказа
                            </span>
                        )}
                        {rule.created_at && (
                            <span className="bg-gray-50 text-gray-400 text-[10px] px-2 py-0.5 rounded font-medium border border-gray-100 italic">
                                📅 с {new Date(rule.created_at).toLocaleDateString()}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-between w-full sm:w-auto gap-2 md:gap-3 shrink-0">
                    <div className="flex items-center gap-1 md:gap-2">
                        {/* Violation Count Badge */}
                        {violationCount > 0 && (
                            <div className="px-2 py-1 bg-gray-100 rounded-full text-[10px] md:text-xs font-bold text-gray-600 flex items-center gap-1" title="Найдено нарушений по этому правилу">
                                ⚠️ {violationCount}
                            </div>
                        )}

                        {/* Edit As New Version */}
                        <NewRuleModal
                            initialPrompt={rule.description}
                            trigger={
                                <button className="text-gray-400 hover:text-blue-600 p-2 md:p-1" title="Создать новую версию (Edit)">
                                    ✏️
                                </button>
                            }
                        />

                        <button
                            onClick={handleRunAudit}
                            className="text-gray-400 hover:text-indigo-600 p-2 md:p-1"
                            title="Проверить историю (Audit)"
                        >
                            🕰️
                        </button>

                        <button
                            onClick={async () => {
                                if (confirm('Вы уверены? Правило будет перенесено в архив (выключено).')) {
                                    await updateRuleStatus(rule.code, false);
                                }
                            }}
                            className="text-gray-400 hover:text-red-500 p-2 md:p-1"
                            title="Архивировать (Выключить)"
                        >
                            🗑️
                        </button>
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
            </div>

            {rule.is_active && (
                <div className="mt-4 border-t pt-4">
                    {renderInputs()}
                </div>
            )}
        </div>
    );
}
