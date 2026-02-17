
'use client'

import { useState, useEffect } from 'react';
import { createRule } from '@/app/actions/rules';
import RuleBlockEditor, { RuleLogic } from './rule-block-editor';
import ChecklistEditor, { ChecklistSection } from './checklist-editor';

export default function NewRuleModal({ initialPrompt, trigger }: { initialPrompt?: string, trigger?: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState(initialPrompt || '');
    const [isLoading, setIsLoading] = useState(false);

    // Draft State
    const [logic, setLogic] = useState<RuleLogic | null>(null);
    const [checklist, setChecklist] = useState<ChecklistSection[]>([]); // New state
    const [ruleMode, setRuleMode] = useState<'standard' | 'checklist'>('standard'); // New state

    const [explanation, setExplanation] = useState('');
    const [name, setName] = useState('');
    const [entityType, setEntityType] = useState<'call' | 'event' | 'order'>('call');
    const [severity, setSeverity] = useState('medium');
    const [points, setPoints] = useState(10);
    const [notifyTelegram, setNotifyTelegram] = useState(false);
    const [historyDays, setHistoryDays] = useState(0);
    const [step, setStep] = useState(1); // 1: Input, 2: Review & Edit

    // Dry Run State
    const [dryRunLoading, setDryRunLoading] = useState(false);
    const [dryRunResults, setDryRunResults] = useState<{ count: number, violations: any[] } | null>(null);

    // Synthetic Test State
    const [syntheticLoading, setSyntheticLoading] = useState(false);
    const [syntheticResult, setSyntheticResult] = useState<{ success: boolean, message?: string, error?: string, steps?: string[] } | null>(null);
    const [mockTranscript, setMockTranscript] = useState('Менеджер: Добрый день, компания Окна. Меня зовут Иван. Клиент: Здравствуйте, хочу заказать окно.');

    // Metadata
    const [allManagers, setAllManagers] = useState<any[]>([]);
    const [statuses, setStatuses] = useState<{ code: string, name: string }[]>([]);

    const fetchData = async () => {
        try {
            const [mRes, sRes, stRes] = await Promise.all([
                fetch('/api/managers'),
                fetch('/api/managers/controlled'),
                fetch('/api/statuses')
            ]);

            const mData = await mRes.json();
            const sData = await sRes.json();
            const stData = await stRes.json();

            const controlledIds = new Set((sData || []).map((s: any) => s.id));
            setAllManagers((mData || []).filter((m: any) => controlledIds.has(m.id)));
            setStatuses(stData || []);
        } catch (e) {
            console.error('Failed to fetch data:', e);
        }
    };

    useEffect(() => {
        if (isOpen) fetchData();
    }, [isOpen]);

    const handleGenerate = async () => {
        setIsLoading(true);
        try {
            // If user selected "Checklist" explicitly via prompt tags or just generic, we might want to auto-detect.
            // For now, let's just proceed to step 2 and let user choose mode if AI doesn't decide.
            // But actually, the prompt generation is for "Standard" rules mostly.
            // If user wants a checklist, they might skip generation?
            // Let's keep generation for now, it populates Name/Explanation/Logic.

            const res = await fetch('/api/ai/generate-rule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            setLogic(data.logic);
            setExplanation(data.description || data.explanation);
            setName(data.name || prompt.substring(0, 30));
            setEntityType(data.entity_type || 'call');
            setStep(2);
            setDryRunResults(null); // Reset preview

            // Heuristic to switch to checklist mode? 
            if (prompt.toLowerCase().includes('скрипт') || prompt.toLowerCase().includes('чек-лист')) {
                setRuleMode('checklist');
                setEntityType('call');
            } else {
                setRuleMode('standard');
            }

        } catch (e) {
            alert('AI Generation Failed: ' + e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleManualCreate = () => {
        // Set defaults for manual creation
        setLogic({
            trigger: { block: 'status_change', params: { target_status: 'new' } },
            conditions: []
        });
        setExplanation('Ручное создание правила');
        setName(prompt || 'Новое правило');
        setEntityType('order'); // Default to order, user can change
        setStep(2);
        setDryRunResults(null);

        // Auto-detect checklist mode if keywords are present, otherwise default to standard
        if (prompt.toLowerCase().includes('скрипт') || prompt.toLowerCase().includes('чек-лист')) {
            setRuleMode('checklist');
            setEntityType('call');
        } else {
            setRuleMode('standard');
        }
    };

    const handleDryRun = async () => {
        if (!logic && ruleMode === 'standard') return;

        // For checklist, we might not have a dry run yet, or we simulate it.
        // Let's disable dry run for checklist for now or mock it.
        if (ruleMode === 'checklist') {
            alert('Предпросмотр для чек-листов пока не доступен');
            return;
        }

        setDryRunResults(null);
        setDryRunLoading(true);
        try {
            const res = await fetch('/api/rules/dry-run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logic, entity_type: entityType, days: 7 })
            });
            const data = await res.json();
            setDryRunResults(data);
        } catch (e) {
            console.error('Dry Run Failed:', e);
        } finally {
            setDryRunLoading(false);
        }
    };

    const handleSyntheticTest = async () => {


        if (!logic) return;
        setSyntheticLoading(true);
        setSyntheticResult(null);
        try {
            const res = await fetch('/api/rules/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    adHocLogic: logic,
                    entity_type: entityType,
                    severity: severity,
                    mockTranscript: ruleMode === 'checklist' ? mockTranscript : undefined,
                    checklist: ruleMode === 'checklist' ? checklist : undefined
                })
            });
            const data = await res.json();
            setSyntheticResult(data);
        } catch (e) {
            console.error('Synthetic Test Failed:', e);
            setSyntheticResult({ success: false, message: 'Ошибка при выполнении теста' });
        } finally {
            setSyntheticLoading(false);
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
                logic: ruleMode === 'checklist' ? {
                    trigger: { block: 'new_call_transcribed', params: {} },
                    conditions: []
                } : logic, // Create dummy logic for checklist rules
                severity,
                points,
                notify_telegram: notifyTelegram,
                is_active: true,
                checklist: ruleMode === 'checklist' ? checklist : undefined
            }, historyDays);

            setIsOpen(false);
            setStep(1);
            setPrompt('');
            setLogic(null);
            setChecklist([]);
        } catch (e) {
            alert('Save Failed: ' + e);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) {
        if (trigger) return <div onClick={() => setIsOpen(true)}>{trigger}</div>;
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 my-8 relative animate-in fade-in zoom-in duration-200">
                <button onClick={() => setIsOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <h2 className="text-2xl font-black mb-6 flex items-center gap-3">
                    <span className="p-2 bg-indigo-50 rounded-xl text-indigo-600">✨</span>
                    Создание правила
                </h2>

                {step === 1 && (
                    <div className="space-y-6">
                        <div>
                            <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Что нужно проверять?</label>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Опишите правило своими словами. Например: 'Забыли позвонить по новому заказу в течение часа' или 'Нет комментария при отмене'"
                                className="w-full border-2 border-gray-100 rounded-2xl p-4 h-32 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-lg font-medium resize-none shadow-inner bg-gray-50/30"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {['Забытый заказ', 'Отмена без комментария', 'Грубость менеджера', 'Длинная пауза', 'Скрипт звонка'].map(tag => (
                                <button
                                    key={tag}
                                    onClick={() => setPrompt(tag)}
                                    className="px-3 py-1.5 text-xs rounded-full border border-gray-100 bg-white text-gray-500 hover:border-indigo-200 hover:text-indigo-600 transition-all font-bold"
                                >
                                    + {tag}
                                </button>
                            ))}
                        </div>

                        <div className="flex justify-between items-center pt-6 border-t font-black">
                            <button
                                onClick={handleManualCreate}
                                className="text-indigo-600 hover:text-indigo-800 text-[10px] uppercase tracking-widest font-bold px-2"
                            >
                                🛠 Создать вручную
                            </button>
                            <div className="flex gap-3">
                                <button onClick={() => setIsOpen(false)} className="px-6 py-3 text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest text-xs">Отмена</button>
                                <button
                                    onClick={handleGenerate}
                                    disabled={!prompt || isLoading}
                                    className="bg-black text-white px-10 py-3 rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-all uppercase tracking-widest text-xs flex items-center gap-3 shadow-lg group"
                                >
                                    {isLoading ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                            Генерирую...
                                        </>
                                    ) : (
                                        <>Далее <span className="group-hover:translate-x-1 transition-transform">→</span></>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {step === 2 && logic && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-h-[70vh] overflow-y-auto pr-2">
                        <div className="space-y-6">

                            {/* Mode Switcher */}
                            <div className="bg-gray-100 p-1 rounded-xl flex">
                                <button
                                    onClick={() => setRuleMode('standard')}
                                    className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${ruleMode === 'standard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                >
                                    Обычное правило
                                </button>
                                <button
                                    onClick={() => { setRuleMode('checklist'); setEntityType('call'); }}
                                    className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${ruleMode === 'checklist' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                >
                                    Контроль качества (Чек-лист)
                                </button>
                            </div>

                            <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100/50">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="bg-indigo-600 text-white text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider">
                                        {ruleMode === 'checklist' ? 'Контекст' : 'AI Анализ'}
                                    </span>
                                </div>
                                <textarea
                                    value={explanation}
                                    onChange={(e) => setExplanation(e.target.value)}
                                    className="w-full bg-transparent text-sm font-medium text-indigo-900 leading-relaxed italic outline-none resize-none h-20"
                                />
                            </div>

                            {ruleMode === 'standard' ? (
                                <RuleBlockEditor
                                    logic={logic}
                                    onChange={setLogic}
                                    statuses={statuses}
                                />
                            ) : (
                                <ChecklistEditor
                                    checklist={checklist}
                                    onChange={setChecklist}
                                />
                            )}

                            <div className="pt-4 border-t space-y-4">
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Название правила</label>
                                    <input value={name} onChange={e => setName(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm font-bold focus:border-indigo-500 outline-none transition-all" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Критичность</label>
                                        <select value={severity} onChange={e => setSeverity(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm font-bold bg-white outline-none focus:border-indigo-500 transition-all cursor-pointer">
                                            <option value="low">🟡 Низкая</option>
                                            <option value="medium">🟠 Средняя</option>
                                            <option value="high">🔴 Высокая</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Сущность</label>
                                        <select
                                            value={entityType}
                                            onChange={e => setEntityType(e.target.value as any)}
                                            disabled={ruleMode === 'checklist'} // Fixed to 'call' for checklist
                                            className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm font-bold bg-white outline-none focus:border-indigo-500 transition-all cursor-pointer disabled:bg-gray-50 disabled:text-gray-400"
                                        >
                                            <option value="order">📦 Заказ (State)</option>
                                            <option value="call">📞 Звонок</option>
                                        </select>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Штрафные баллы</label>
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                value={points}
                                                onChange={e => setPoints(parseInt(e.target.value) || 0)}
                                                className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                                            />
                                            <span className="text-xs text-gray-400 font-medium whitespace-nowrap">баллов за нарушение</span>
                                        </div>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="flex items-center justify-between p-3 border-2 border-gray-100 rounded-xl cursor-pointer hover:border-indigo-200 transition-all bg-white select-none">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${notifyTelegram ? 'bg-indigo-600' : 'bg-gray-200'}`}>
                                                    <div className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${notifyTelegram ? 'translate-x-4' : 'translate-x-0'}`} />
                                                </div>
                                                <span className="text-sm font-bold text-gray-700">🔔 Отправлять уведомление в Telegram</span>
                                            </div>
                                            <input
                                                type="checkbox"
                                                checked={notifyTelegram}
                                                onChange={e => setNotifyTelegram(e.target.checked)}
                                                className="hidden"
                                            />
                                        </label>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Проверка истории</label>
                                        <select
                                            value={historyDays}
                                            onChange={e => setHistoryDays(parseInt(e.target.value))}
                                            className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm font-bold bg-white outline-none focus:border-indigo-500 transition-all cursor-pointer"
                                        >
                                            <option value={0}>⚡️ Только новые (с момента создания)</option>
                                            <option value={1}>🕒 За последние 24 часа</option>
                                            <option value={3}>📅 За последние 3 дня</option>
                                            <option value={7}>🗓️ За последние 7 дней</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="sticky top-0 bg-white pt-2 z-10">
                                {ruleMode === 'checklist' && (
                                    <div className="mb-3">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                                            Тестовый диалог (для проверки)
                                        </label>
                                        <textarea
                                            className="w-full text-xs border border-gray-200 rounded-lg p-2 h-24 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none resize-none"
                                            placeholder="Вставьте сюда текст диалога для проверки..."
                                            value={mockTranscript}
                                            onChange={(e) => setMockTranscript(e.target.value)}
                                        />
                                    </div>
                                )}

                                <div className="grid grid-cols-1 gap-2">
                                    {ruleMode === 'standard' && (
                                        <button
                                            onClick={handleDryRun}
                                            disabled={dryRunLoading}
                                            className="w-full bg-white border-2 border-indigo-600 text-indigo-600 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-indigo-600 hover:text-white transition-all flex items-center justify-center gap-2 shadow-sm"
                                        >
                                            {dryRunLoading ? 'Проверка...' : '🔍 Предпросмотр (Dry Run)'}
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSyntheticTest}
                                        disabled={syntheticLoading}
                                        className="w-full bg-indigo-50 border-2 border-indigo-100 text-indigo-700 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-indigo-100 transition-all flex items-center justify-center gap-2"
                                    >
                                        {syntheticLoading ? 'Запуск теста...' : '🧪 Проверка Синтетикой'}
                                    </button>
                                </div>
                            </div>

                            {syntheticResult && (
                                <div className={`mt-2 p-3 rounded-xl border text-[10px] font-bold ${syntheticResult.success ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                                    <div className="flex items-center gap-2 uppercase tracking-widest mb-1">
                                        <span>{syntheticResult.success ? '✅' : '❌'}</span>
                                        {syntheticResult.message || syntheticResult.error || 'Ошибка проверки'}
                                    </div>

                                    {/* Display Checklist Breakdown if available */}
                                    {(syntheticResult as any).checklistResult ? (
                                        <div className="mt-2 bg-white/50 rounded-lg p-2 border border-black/5">
                                            <div className="flex justify-between items-center mb-2 pb-1 border-b border-black/5">
                                                <span className="uppercase tracking-wider opacity-70">Оценка AI</span>
                                                <span className="text-lg font-black">
                                                    {(syntheticResult as any).checklistResult.totalScore}/100
                                                </span>
                                            </div>
                                            <div className="space-y-1">
                                                {(syntheticResult as any).checklistResult.sectionScores?.map((s: any, i: number) => (
                                                    <div key={i} className="flex justify-between text-[9px]">
                                                        <span>{s.section}</span>
                                                        <span className={s.score < s.maxScore ? 'text-red-600' : 'text-green-600'}>
                                                            {s.score}/{s.maxScore}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="mt-2 pt-1 border-t border-black/5 italic opacity-80 leading-tight">
                                                {(syntheticResult as any).checklistResult.summary}
                                            </div>
                                        </div>
                                    ) : (
                                        syntheticResult.steps && syntheticResult.steps.length > 0 && (
                                            <div className="mt-2 space-y-1 border-t border-current/20 pt-2 opacity-80 font-medium">
                                                {syntheticResult.steps.map((s, i) => (
                                                    <div key={i} className="flex gap-2 leading-tight">
                                                        <span className="opacity-50">•</span>
                                                        <span>{s}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )
                                    )}
                                </div>
                            )}

                            {dryRunResults && (
                                <div className="animate-in slide-in-from-top-2 duration-300">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Найдено нарушений</span>
                                        <span className={`text-xs font-black px-2 py-1 rounded-lg ${dryRunResults.count > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                                            {dryRunResults.count} шт
                                        </span>
                                    </div>
                                    <div className="space-y-1.5">
                                        {dryRunResults.violations.slice(0, 5).map((v, i) => (
                                            <div key={i} className="text-[11px] p-2 bg-gray-50 rounded-lg flex justify-between border border-transparent hover:border-indigo-100 transition-all group">
                                                <span className="font-bold">Заказ #{v.order_id || v.id}</span>
                                                <span className="text-gray-400 group-hover:text-indigo-400">
                                                    {new Date(v.violation_time || v.occurredAt).toLocaleDateString()}
                                                </span>
                                            </div>
                                        ))}
                                        {dryRunResults.count > 5 && (
                                            <p className="text-center text-[9px] text-gray-400 font-bold italic py-2">...и еще {dryRunResults.count - 5} нарушений</p>
                                        )}
                                        {dryRunResults.count === 0 && (
                                            <div className="text-center py-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                                                <p className="text-xs text-gray-400 font-bold">Нарушений не найдено ✨</p>
                                                <p className="text-[9px] text-gray-400 mt-1">Попробуйте изменить условия</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="pt-20">
                                <div className="p-4 bg-yellow-50 rounded-2xl border border-yellow-100">
                                    <h5 className="text-[10px] font-black uppercase tracking-widest text-yellow-700 mb-1">💡 Совет</h5>
                                    <p className="text-[10px] text-yellow-800 leading-normal">
                                        После сохранения правило начнет проверять все новые данные. Если нужно проверить старые — выберите "За последние X дней" при сохранении.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="col-span-1 md:col-span-2 flex justify-end gap-3 pt-6 border-t mt-4 sticky bottom-0 bg-white">
                            <button onClick={() => setStep(1)} className="px-6 py-3 text-gray-400 font-black uppercase tracking-widest text-xs hover:text-gray-600">← Назад</button>
                            <button
                                onClick={handleSave}
                                disabled={isLoading}
                                className="bg-green-600 text-white px-12 py-3 rounded-xl hover:bg-green-700 transition-all font-black uppercase tracking-widest text-xs shadow-lg shadow-green-100"
                            >
                                {isLoading ? 'Сохранение...' : '🚀 Запустить правило'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}
