
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
    const [step, setStep] = useState(1); // 1: Prompt, 2: Review

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

    // Auto-fetch managers when step 2 is reached OR when modal opens
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
            setName(data.name || prompt.substring(0, 30)); // Auto-name from AI or fallback
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
                code: 'rule_' + Date.now(), // Auto-generate code
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
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
                <h2 className="text-xl font-bold mb-4">Создание правила (AI)</h2>

                {step === 1 && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Опишите, что искать:</label>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Например: Звонки короче 10 секунд..."
                                className="w-full border rounded-lg p-3 h-32 focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>

                        <div>
                            <span className="text-xs text-gray-500 font-medium block mb-2">
                                {prompt ? 'Подходящие поля (нажмите, чтобы добавить):' : 'Популярные поля:'}
                            </span>
                            <div className="flex flex-wrap gap-2">
                                {(() => {
                                    const TAGS = [
                                        { label: 'Статус заказа', value: 'поле status', keywords: ['статус', 'смена', 'изменил', 'этап'] },
                                        { label: 'Комментарий Менеджера', value: 'поле manager_comment', keywords: ['коммент', 'причина', 'текст', 'написал'] },
                                        { label: 'Сумма заказа', value: 'поле total_sum', keywords: ['сумма', 'деньги', 'стоимость', 'цена', 'бюджет'] },
                                        { label: 'Дата доставки', value: 'поле delivery_date', keywords: ['дата', 'доставка', 'день', 'время'] },
                                        { label: 'Статус оплаты', value: 'поле payment_status', keywords: ['оплата', 'платеж', 'деньги'] },
                                        { label: 'ID Менеджера', value: 'поле manager_id', keywords: ['менеджер', 'сотрудник', 'кто'] },
                                        { label: 'Звонок > 30 сек', value: 'звонки > 30 сек', keywords: ['звонок', 'длительность', 'разговор'] },
                                        { label: 'Статус "Отмена"', value: 'статус Отмена', keywords: ['отмена', 'отказ', 'срыв'] }
                                    ];

                                    const suggestions = prompt
                                        ? TAGS.filter(t => t.keywords.some(k => prompt.toLowerCase().includes(k)))
                                        : TAGS;

                                    const displayTags = suggestions.length > 0 ? suggestions : TAGS;

                                    return displayTags.map(tag => (
                                        <button
                                            key={tag.value}
                                            onClick={() => setPrompt(prev => prev ? `${prev} ${tag.label}` : tag.label)}
                                            className={`px-2 py-1 text-xs rounded-full border transition-colors flex items-center gap-1 ${suggestions.length > 0 && prompt
                                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                                                }`}
                                        >
                                            + {tag.label}
                                        </button>
                                    ));
                                })()}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 text-sm text-gray-500 italic">
                            💡 ИИ понимает контекст лучше, чем строгий SQL.
                        </div>

                        <div className="flex justify-end gap-2">
                            <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Отмена</button>
                            <button
                                onClick={handleGenerate}
                                disabled={!prompt || isLoading}
                                className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {isLoading ? 'Думаю...' : '🚀 Генерировать'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-4">
                        <div className="bg-green-50 p-4 rounded-lg text-sm text-green-800 border border-green-200">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="bg-green-200 text-green-800 text-xs px-2 py-0.5 rounded font-bold uppercase">AI</span>
                                <span className="text-gray-500 text-xs uppercase font-bold tracking-wide">
                                    Тип: {entityType === 'call' ? 'Звонок (Call)' : 'Событие CRM (Event)'}
                                </span>
                            </div>
                            <strong>AI:</strong> {explanation}
                        </div>

                        <div>
                            <label className="block text-xs uppercase text-gray-500 font-bold mb-1">SQL Условие (Condition)</label>
                            <code className="block bg-gray-900 text-green-400 p-3 rounded font-mono text-sm overflow-x-auto">
                                {sql}
                            </code>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Название</label>
                                <input value={name} onChange={e => setName(e.target.value)} className="w-full border rounded p-2" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Критичность</label>
                                <select value={severity} onChange={e => setSeverity(e.target.value)} className="w-full border rounded p-2 bg-white">
                                    <option value="low">Low (Желтый)</option>
                                    <option value="medium">Medium (Оранжевый)</option>
                                    <option value="high">High (Красный)</option>
                                    <option value="critical">CRITICAL (Бордовый)</option>
                                </select>
                            </div>
                        </div>

                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-blue-900 mb-2 flex items-center gap-2">
                                    🕰️ Период действия
                                </label>
                                <select
                                    value={historyDays}
                                    onChange={e => setHistoryDays(Number(e.target.value))}
                                    className="w-full border-blue-200 rounded p-2 bg-white text-sm"
                                >
                                    <option value={0}>С этого момента и всегда</option>
                                    <option value={1}>За последние 24 часа</option>
                                    <option value={7}>За последние 7 дней</option>
                                    <option value={30}>За последние 30 дней</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-blue-900 mb-1 flex items-center gap-2">
                                    👤 Конкретные менеджеры (Опционально)
                                </label>
                                <div className="max-h-32 overflow-y-auto border border-blue-200 rounded bg-white p-2">
                                    {allManagers.map(m => (
                                        <label key={m.id} className="flex items-center gap-2 text-xs py-1 cursor-pointer hover:bg-blue-50">
                                            <input
                                                type="checkbox"
                                                checked={selectedManagers.includes(m.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedManagers([...selectedManagers, m.id]);
                                                    else setSelectedManagers(selectedManagers.filter(id => id !== m.id));
                                                }}
                                                className="rounded border-gray-300"
                                            />
                                            {m.first_name} {m.last_name || ''}
                                        </label>
                                    ))}
                                    {allManagers.length === 0 && <span className="text-gray-400 text-[10px]">Нет активных менеджеров</span>}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-blue-900 mb-1 flex items-center gap-2">
                                    📦 Номера заказов (через запятую)
                                </label>
                                <input
                                    type="text"
                                    value={orderIdsInput}
                                    onChange={e => setOrderIdsInput(e.target.value)}
                                    placeholder="Например: 12345, 12346"
                                    className="w-full border-blue-200 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>

                            <p className="text-[10px] text-blue-600 italic">
                                {historyDays > 0
                                    ? `После создания правила мы сразу проверим историю за ${historyDays} дн. и продолжим следить за новыми событиями.`
                                    : `Правило будет работать только для новых событий в базе.`}
                            </p>
                        </div>

                        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
                            <button onClick={() => setStep(1)} className="px-4 py-2 text-gray-600">← Назад</button>
                            <button
                                onClick={handleSave}
                                disabled={isLoading}
                                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
                            >
                                {isLoading ? 'Сохраняю...' : '💾 Сохранить Правило'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
