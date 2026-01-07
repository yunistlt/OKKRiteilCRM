
'use client'

import { useState, useEffect } from 'react';
import { createRule } from '@/app/actions/rules';

export default function NewRuleModal({ initialPrompt, trigger }: { initialPrompt?: string, trigger?: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState(initialPrompt || '');
    const [isLoading, setIsLoading] = useState(false);

    // Draft State
    const [sql, setSql] = useState('');
    const [explanation, setExplanation] = useState('');
    const [name, setName] = useState('');
    const [entityType, setEntityType] = useState<'call' | 'event'>('call');
    const [severity, setSeverity] = useState('medium');
    const [historyDays, setHistoryDays] = useState(0);
    const [step, setStep] = useState(1); // 1: Input & Filters, 2: Review SQL

    // Filters State
    const [selectedManagers, setSelectedManagers] = useState<number[]>([]);
    const [orderIdsInput, setOrderIdsInput] = useState('');
    const [allManagers, setAllManagers] = useState<any[]>([]);

    const fetchManagers = async () => {
        try {
            const mRes = await fetch('/api/managers');
            const mData = await mRes.json();
            const sRes = await fetch('/api/managers/controlled');
            const sData = await sRes.json();
            const controlledIds = new Set((sData || []).map((s: any) => s.id));
            setAllManagers((mData || []).filter((m: any) => controlledIds.has(m.id)));
        } catch (e) {
            console.error('Failed to fetch managers:', e);
        }
    };

    useEffect(() => {
        if (isOpen) fetchManagers();
    }, [isOpen]);

    const handleGenerate = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/ai/generate-rule', {
                method: 'POST',
                body: JSON.stringify({ prompt })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            setSql(data.sql);
            setExplanation(data.explanation);
            setName(data.name || prompt.substring(0, 30));
            setEntityType(data.entity_type || 'call');
            setStep(2);
        } catch (e) {
            alert('AI Generation Failed: ' + e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsLoading(true);
        try {
            await createRule({
                code: 'rule_' + Date.now(),
                name,
                description: explanation,
                entity_type: entityType,
                condition_sql: sql,
                severity,
                parameters: {
                    manager_ids: selectedManagers,
                    order_ids: orderIdsInput.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
                },
                is_active: true
            }, historyDays);
            setIsOpen(false);
            setStep(1);
            setPrompt('');
            setSelectedManagers([]);
            setOrderIdsInput('');
        } catch (e) {
            alert('Save Failed: ' + e);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) {
        if (trigger) {
            return <div onClick={() => setIsOpen(true)}>{trigger}</div>;
        }
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition flex items-center gap-2"
            >
                ✨ Создать с ИИ
            </button>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[95vh] overflow-y-auto">
                <h2 className="text-xl font-bold mb-4">Создание правила (AI)</h2>

                {step === 1 && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Опишите, что искать:</label>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Например: Звонки короче 10 секунд..."
                                className="w-full border-2 border-indigo-50 rounded-lg p-3 h-24 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                        </div>

                        {/* Filters on Home Screen */}
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-4">
                            <h3 className="text-xs font-black uppercase tracking-widest text-gray-400">Настройки применения</h3>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-2">
                                    🕰️ Период действия
                                </label>
                                <select
                                    value={historyDays}
                                    onChange={e => setHistoryDays(Number(e.target.value))}
                                    className="w-full border-gray-200 rounded-lg p-2 bg-white text-sm"
                                >
                                    <option value={0}>С этого момента и всегда</option>
                                    <option value={1}>За последние 24 часа + будущее</option>
                                    <option value={7}>За последние 7 дней + будущее</option>
                                    <option value={30}>За последние 30 дней + будущее</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    👤 Менеджеры (Опционально)
                                </label>
                                <div className="max-h-24 overflow-y-auto border border-gray-200 rounded-lg bg-white p-2">
                                    {allManagers.map(m => (
                                        <label key={m.id} className="flex items-center gap-2 text-xs py-1 cursor-pointer hover:bg-indigo-50 px-1 rounded transition-colors text-gray-600">
                                            <input
                                                type="checkbox"
                                                checked={selectedManagers.includes(m.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedManagers([...selectedManagers, m.id]);
                                                    else setSelectedManagers(selectedManagers.filter(id => id !== m.id));
                                                }}
                                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            {m.first_name} {m.last_name || ''}
                                        </label>
                                    ))}
                                    {allManagers.length === 0 && <span className="text-gray-400 text-[10px] italic">Нет активных менеджеров</span>}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    📦 Номера заказов (через запятую)
                                </label>
                                <input
                                    type="text"
                                    value={orderIdsInput}
                                    onChange={e => setOrderIdsInput(e.target.value)}
                                    placeholder="Например: 12345, 12346"
                                    className="w-full border-gray-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-gray-300"
                                />
                            </div>
                        </div>

                        {/* Tags */}
                        <div>
                            <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider block mb-2">Подсказки:</span>
                            <div className="flex flex-wrap gap-1.5">
                                {(() => {
                                    const TAGS = [
                                        { label: 'Статус заказа', value: 'поле status' },
                                        { label: 'Комментарий', value: 'комментарий' },
                                        { label: 'Сумма', value: 'сумма' },
                                        { label: 'Длительность', value: 'длительность' },
                                        { label: 'Отмена', value: 'отмена' }
                                    ];
                                    return TAGS.map(tag => (
                                        <button
                                            key={tag.value}
                                            onClick={() => setPrompt(prev => prev ? `${prev} ${tag.label}` : tag.label)}
                                            className="px-2 py-1 text-[10px] rounded-lg border border-gray-100 bg-white text-gray-500 hover:border-indigo-200 hover:text-indigo-600 transition-all font-bold"
                                        >
                                            + {tag.label}
                                        </button>
                                    ));
                                })()}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t mt-4">
                            <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-50 rounded-xl transition-colors">Отмена</button>
                            <button
                                onClick={handleGenerate}
                                disabled={!prompt || isLoading}
                                className="bg-indigo-600 text-white px-8 py-2 rounded-xl hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-200 disabled:opacity-50 transition-all font-black uppercase tracking-widest text-xs flex items-center gap-2"
                            >
                                {isLoading ? 'Думаю...' : 'Продолжить 🚀'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-4">
                        <div className="bg-indigo-50 p-4 rounded-xl text-sm text-indigo-900 border border-indigo-100">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="bg-indigo-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-wider">AI Анализ</span>
                                <span className="text-gray-500 text-[10px] uppercase font-black tracking-widest">
                                    {entityType === 'call' ? '📞 Звонки' : '📑 События'}
                                </span>
                            </div>
                            <p className="leading-relaxed">{explanation}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Название правила</label>
                                <input value={name} onChange={e => setName(e.target.value)} className="w-full border-gray-200 rounded-lg p-3 text-sm font-bold" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Критичность</label>
                                <select value={severity} onChange={e => setSeverity(e.target.value)} className="w-full border-gray-200 rounded-lg p-3 text-sm font-bold bg-white">
                                    <option value="low">🟡 Низкая</option>
                                    <option value="medium">🟠 Средняя</option>
                                    <option value="high">🔴 Высокая</option>
                                    <option value="critical">🆘 Критическая</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Тип проверки</label>
                                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs font-bold text-gray-600">
                                    {entityType === 'call' ? '📞 Транскрипты' : '📑 История CRM'}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
                            <button onClick={() => setStep(1)} className="px-4 py-2 text-gray-500 font-bold">← Назад</button>
                            <button
                                onClick={handleSave}
                                disabled={isLoading}
                                className="bg-green-600 text-white px-8 py-2 rounded-xl hover:bg-green-700 transition-all font-black uppercase tracking-widest text-xs"
                            >
                                {isLoading ? 'Создание...' : '💾 Сохранить и запустить'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
