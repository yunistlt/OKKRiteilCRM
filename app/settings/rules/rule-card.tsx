
'use client'

import { useState, useEffect } from 'react';
import { updateRuleStatus, updateRuleParams } from '@/app/actions/rules';
import { supabase } from '@/utils/supabase';
import Link from 'next/link';
import NewRuleModal from './new-rule-modal';

export default function RuleCard({ rule, violationCount, roleNames = {} }: { rule: any, violationCount: number, roleNames?: Record<string, string> }) {
    const targetRoles: string[] = Array.isArray(rule.target_roles) ? rule.target_roles : [];
    const [isLoading, setIsLoading] = useState(false);
    const [params, setParams] = useState(rule.parameters);
    const [auditStatus, setAuditStatus] = useState(rule.parameters?.audit_status || 'idle');
    const [notifyTelegram, setNotifyTelegram] = useState(rule.notify_telegram || false);

    // Polling while auditing
    useEffect(() => {
        let interval: any;
        if (auditStatus === 'running') {
            interval = setInterval(async () => {
                const { data } = await supabase.from('okk_rules').select('parameters').eq('code', rule.code).single();
                if (data?.parameters?.audit_status !== 'running') {
                    setAuditStatus(data?.parameters?.audit_status || 'idle');
                    setParams(data?.parameters);
                    clearInterval(interval);
                    // Optionally refresh violations count
                    window.location.reload();
                }
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [auditStatus, rule.code]);

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

    const handleNotifyToggle = async () => {
        const newValue = !notifyTelegram;
        setNotifyTelegram(newValue);
        try {
            await supabase.from('okk_rules').update({ notify_telegram: newValue }).eq('code', rule.code);
        } catch (e) {
            console.error('Failed to update notify_telegram', e);
            setNotifyTelegram(!newValue); // manual rollback
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
        setAuditStatus('running');
        try {
            const baseUrl = window.location.origin;
            const res = await fetch(`${baseUrl}/api/rules/audit-history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ruleId: rule.code, // Changed from id to code
                    days: days
                })
            });
            const data = await res.json();
            // Polling will handle the UI update
        } catch (e: any) {
            alert('Ошибка запуска: ' + e.message);
            setAuditStatus('error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleTestRule = async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (!confirm('Запустить синтетическую проверку правила? Будет создан временный заказ и событие.')) return;

        setIsLoading(true);
        try {
            const payload = { ruleId: rule.code };
            console.log('[RuleCard] Sending test request:', payload);

            if (!rule.code) {
                alert('Ошибка: Отсутствует код правила (rule.code is missing)');
                console.error('[RuleCard] rule object:', rule);
                return;
            }

            const res = await fetch('/api/rules/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            console.log('[RuleCard] Test response:', res.status, data);

            if (data.success) {
                alert(`✅ Проверка пройдена!\n\n${data.message}`);
            } else {
                console.error('[RuleCard] Test failed:', data);
                alert(`❌ Проверка не пройдена!\n\n${data.error || data.message || 'Неизвестная ошибка'}`);
            }
        } catch (e: any) {
            alert('Ошибка при выполнении теста: ' + e.message);
        } finally {
            setIsLoading(false);
            // Refresh counts if needed
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
                        <span
                            className={`text-[10px] px-2 py-0.5 rounded font-bold border flex items-center gap-1 ${targetRoles.length > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-50 text-gray-400 border-gray-100'}`}
                            title={targetRoles.length > 0 ? 'Правило оценивает только выбранные роли' : 'Правило применяется ко всем ролям'}
                        >
                            🏷️ {targetRoles.length > 0
                                ? targetRoles.map((c) => roleNames[c] || c).join(', ')
                                : 'Все роли'}
                        </span>
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
                                📅 с {(() => {
                                    const d = new Date(rule.created_at);
                                    if (params.audit_days) d.setDate(d.getDate() - params.audit_days);
                                    return d.toLocaleDateString();
                                })()}
                            </span>
                        )}
                        <button
                            onClick={handleNotifyToggle}
                            className={`text-[10px] px-2 py-0.5 rounded font-bold border flex items-center gap-1 transition-colors ${notifyTelegram
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'
                                : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100 grayscale'}`}
                            title={notifyTelegram ? 'Уведомления в Telegram включены' : 'Уведомления отключены'}
                        >
                            {notifyTelegram ? '🔔 Notify ON' : '🔕 Notify OFF'}
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-between w-full sm:w-auto gap-2 md:gap-3 shrink-0">
                    {/* Audit Progress UI */}
                    {(auditStatus === 'running' || params.audit_status === 'running') && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full animate-pulse border border-indigo-100 shadow-inner">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                            </span>
                            <img src="/images/agents/semen.png" alt="Semen" className="w-5 h-5 rounded-full border border-indigo-200 shadow-sm" />
                            <span className="text-[10px] font-black uppercase tracking-widest flex flex-col leading-none">
                                <span>Семён</span>
                                <span className="text-[7px] text-indigo-400">Архивариус</span>
                            </span>
                        </div>
                    )}

                    <div className="flex items-center gap-1 md:gap-2">
                        {/* Violation Count Badge */}
                        {violationCount > 0 && (
                            <Link
                                href={`/violations?rule=${rule.code}`}
                                className="px-2 py-1 bg-yellow-50 hover:bg-yellow-100 rounded-full text-[10px] md:text-xs font-bold text-yellow-700 flex items-center gap-1 border border-yellow-200 transition-colors cursor-pointer"
                                title="Показать нарушения по этому правилу"
                            >
                                ⚠️ {violationCount}
                            </Link>
                        )}

                        {/* Edit As New Version */}
                        <NewRuleModal
                            initialPrompt={rule.description}
                            initialRule={rule} // Pass full rule for editing
                            trigger={
                                <button className="text-gray-400 hover:text-blue-600 p-2 md:p-1" title="Редактировать правило (Edit)">
                                    ✏️
                                </button>
                            }
                        />

                        <button
                            onClick={handleRunAudit}
                            className="text-gray-400 hover:text-indigo-600 p-1 rounded-lg hover:bg-indigo-50 transition-all flex items-center gap-1 group"
                            title="Семён: Проверить историю (Audit)"
                        >
                            <img src="/images/agents/semen.png" alt="Semen" className="w-6 h-6 rounded-lg border border-gray-100 group-hover:border-indigo-200 transition-colors shadow-sm" />
                        </button>

                        <button
                            type="button"
                            onClick={handleTestRule}
                            className="text-gray-400 hover:text-orange-500 p-2 md:p-1"
                            title="Синтетическая проверка (Test)"
                            disabled={isLoading}
                        >
                            {isLoading ? '⏳' : '🧪'}
                        </button>

                        <button
                            onClick={handleNotifyToggle}
                            className={`text-[10px] px-2 py-0.5 rounded font-bold border flex items-center gap-1 transition-colors ${notifyTelegram
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'
                                : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100 grayscale'}`}
                            title={notifyTelegram ? 'Уведомления в Telegram включены' : 'Уведомления отключены'}
                        >
                            {notifyTelegram ? '🔔' : '🔕'}
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

            {
                rule.is_active && (
                    <div className="mt-4 border-t pt-4">
                        {renderInputs()}
                    </div>
                )
            }
        </div >
    );
}
