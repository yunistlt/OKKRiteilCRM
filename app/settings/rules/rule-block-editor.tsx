
'use client'

import React from 'react';

export interface RuleLogic {
    trigger: { block: string; params: any } | null;
    conditions: { block: string; params: any }[];
}

interface RuleBlockEditorProps {
    logic: RuleLogic;
    onChange: (logic: RuleLogic) => void;
    statuses: { code: string; name: string }[];
}

export default function RuleBlockEditor({ logic, onChange, statuses }: RuleBlockEditorProps) {
    const updateTriggerParam = (key: string, value: any) => {
        if (!logic.trigger) return;
        const newTrigger = { ...logic.trigger, params: { ...logic.trigger.params, [key]: value } };
        onChange({ ...logic, trigger: newTrigger });
    };

    const updateConditionParam = (index: number, key: string, value: any) => {
        const newConditions = [...logic.conditions];
        newConditions[index] = { ...newConditions[index], params: { ...newConditions[index].params, [key]: value } };
        onChange({ ...logic, conditions: newConditions });
    };

    return (
        <div className="space-y-3">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Конструктор логики</h4>

            {/* Trigger Block */}
            {logic.trigger && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-indigo-600"></div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="bg-indigo-600 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-widest">Триггер</span>
                        <span className="text-xs font-bold text-indigo-900 capitalize">
                            {logic.trigger.block === 'status_change' ? 'Смена статуса' : logic.trigger.block}
                        </span>
                    </div>

                    {logic.trigger.block === 'status_change' && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-indigo-400">На статус:</span>
                            <select
                                value={logic.trigger.params.target_status}
                                onChange={(e) => updateTriggerParam('target_status', e.target.value)}
                                className="bg-white border border-indigo-200 rounded-lg py-1 px-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                {statuses.map(s => (
                                    <option key={s.code} value={s.code}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            )}

            {/* Link line */}
            <div className="flex justify-center -my-1">
                <div className="w-[1px] h-3 bg-gray-200"></div>
            </div>

            {/* Conditions Blocks */}
            <div className="space-y-2">
                {logic.conditions.map((cond, idx) => (
                    <div key={idx} className="bg-white border border-gray-200 rounded-xl p-3 relative shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="bg-gray-400 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-widest">Условие</span>
                            <span className="text-xs font-bold text-gray-700 capitalize">
                                {cond.block === 'time_elapsed' ? 'Ожидание' :
                                    cond.block === 'field_empty' ? 'Пустое поле' :
                                        cond.block === 'semantic_check' ? 'AI Анализ смыслов' : cond.block}
                            </span>
                        </div>

                        {cond.block === 'time_elapsed' && (
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-gray-400">Прошло более:</span>
                                <input
                                    type="number"
                                    value={cond.params.hours}
                                    onChange={(e) => updateConditionParam(idx, 'hours', parseInt(e.target.value))}
                                    className="w-16 bg-gray-50 border border-gray-200 rounded-lg py-1 px-2 text-xs font-bold outline-none"
                                />
                                <span className="text-[10px] font-bold text-gray-400">часов</span>
                            </div>
                        )}

                        {cond.block === 'semantic_check' && (
                            <div className="space-y-1">
                                <span className="text-[10px] font-bold text-gray-400">Инструкция для ИИ:</span>
                                <textarea
                                    value={cond.params.prompt}
                                    onChange={(e) => updateConditionParam(idx, 'prompt', e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-lg py-1 px-2 text-[10px] font-medium outline-none min-h-[60px]"
                                />
                            </div>
                        )}

                        {cond.block === 'field_empty' && (
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-gray-400">Поле:</span>
                                <select
                                    value={cond.params.field_path}
                                    onChange={(e) => updateConditionParam(idx, 'field_path', e.target.value)}
                                    className="bg-gray-50 border border-gray-200 rounded-lg py-1 px-2 text-xs font-bold outline-none"
                                >
                                    <option value="manager_comment">Комментарий менеджера</option>
                                    <option value="next_contact_date">Дата след. контакта</option>
                                </select>
                                <span className="text-[10px] font-bold text-gray-400">= ПУСТО</span>
                            </div>
                        )}
                    </div>
                ))}

                {logic.conditions.length === 0 && (
                    <div className="text-center py-4 border-2 border-dashed border-gray-100 rounded-xl text-xs text-gray-300 italic">
                        Условия не заданы (сработает сразу)
                    </div>
                )}
            </div>
        </div>
    );
}
