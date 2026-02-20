
'use client'

import { useState, useEffect } from 'react';
import { createRule } from '@/app/actions/rules';
import RuleBlockEditor, { RuleLogic } from './rule-block-editor';
import ChecklistEditor, { ChecklistSection } from './checklist-editor';

export default function NewRuleModal({ initialPrompt, trigger, initialRule }: { initialPrompt?: string, trigger?: React.ReactNode, initialRule?: any }) {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState(initialPrompt || '');
    const [isLoading, setIsLoading] = useState(false);

    // Draft State
    const [logic, setLogic] = useState<RuleLogic | null>(null);
    const [checklist, setChecklist] = useState<ChecklistSection[]>([]); // New state
    const [ruleMode, setRuleMode] = useState<'standard' | 'checklist'>('standard'); // New state

    const [explanation, setExplanation] = useState('');
    const [name, setName] = useState('');
    const [entityType, setEntityType] = useState<'call' | 'event' | 'order' | 'stage'>('call');
    const [severity, setSeverity] = useState('medium');
    const [points, setPoints] = useState(10);
    const [notifyTelegram, setNotifyTelegram] = useState(false);
    const [historyDays, setHistoryDays] = useState(0);
    const [stageStatus, setStageStatus] = useState<string>('any');
    const [step, setStep] = useState(1); // 1: Input, 2: Review & Edit

    // Initialize from initialRule when opening
    useEffect(() => {
        if (isOpen && initialRule) {
            setPrompt(initialRule.description || '');
            setLogic(initialRule.logic || {
                trigger: { block: 'status_change', params: { target_status: 'new' } },
                conditions: []
            });
            setChecklist(initialRule.checklist || []);
            setRuleMode(!!initialRule.checklist && initialRule.checklist.length > 0 ? 'checklist' : 'standard');
            setExplanation(initialRule.description || '');
            setName(initialRule.name || '');
            setEntityType(initialRule.entity_type || 'call');
            setSeverity(initialRule.severity || 'medium');
            setPoints(initialRule.points || 10);
            setNotifyTelegram(initialRule.notify_telegram || false);
            setStageStatus(initialRule.parameters?.stage_status || 'any');
            setStep(2); // Jump straight to editor
        } else if (isOpen && !initialRule) {
            // Reset for new rule
            if (initialPrompt) setPrompt(initialPrompt);
        }
    }, [isOpen, initialRule, initialPrompt]);

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
                logic: ruleMode === 'checklist' ? (
                    entityType === 'stage' ? {
                        trigger: { block: 'status_change', params: { target_status: 'any' } },
                        conditions: []
                    } : {
                        trigger: { block: 'new_call_transcribed', params: {} },
                        conditions: []
                    }
                ) : logic,
                parameters: entityType === 'stage' ? { stage_status: stageStatus } : {},
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
            <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full p-8 my-8 relative animate-in fade-in zoom-in duration-200">
                <button onClick={() => setIsOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <h2 className="text-2xl font-black mb-6 flex items-center gap-3">
                    <span className="p-2 bg-indigo-50 rounded-xl text-indigo-600">✨</span>
                    {initialRule ? 'Редактирование правила' : 'Создание правила'}
                </h2>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Left Column: Basic Info & AI Input */}
                    <div className="lg:col-span-4 space-y-6">
                        <div>
                            <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Что нужно проверять?</label>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Опишите правило своими словами..."
                                className="w-full border-2 border-gray-100 rounded-2xl p-4 h-32 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-sm font-medium resize-none shadow-inner bg-gray-50/30"
                            />
                            <div className="flex gap-2 mt-2">
                                <button
                                    onClick={handleGenerate}
                                    disabled={!prompt || isLoading}
                                    className="flex-1 bg-black text-white px-4 py-2 rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-all uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 shadow-sm"
                                >
                                    {isLoading ? '...' : '✨ Сгенерировать ИИ'}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Название</label>
                                <input value={name} onChange={e => setName(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm font-bold focus:border-indigo-500 outline-none transition-all" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Сущность (ГДЕ ИСКАТЬ?)</label>
                                <select
                                    value={entityType}
                                    onChange={e => setEntityType(e.target.value as any)}
                                    className="w-full border-2 border-indigo-600 rounded-xl p-3 text-sm font-black bg-white text-indigo-600 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all cursor-pointer"
                                >
                                    <option value="stage">🏢 Стадия (Stage Audit)</option>
                                    <option value="call">📞 Звонок</option>
                                    <option value="order">📦 Заказ (State)</option>
                                </select>
                            </div>
                            {entityType === 'stage' && (
                                <div className="col-span-2">
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-2">Стадия для проверки (OLD STATUS)</label>
                                    <select
                                        value={stageStatus}
                                        onChange={e => setStageStatus(e.target.value)}
                                        className="w-full border-2 border-indigo-200 rounded-xl p-3 text-sm font-bold bg-white text-indigo-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all cursor-pointer shadow-sm"
                                    >
                                        <option value="any">Все стадии (любая смена статуса)</option>
                                        {statuses.map(s => (
                                            <option key={s.code} value={s.code}>{s.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-[10px] text-gray-400 mt-1 pl-1 italic">
                                        Проверка сработает в момент **выхода** из этой стадии.
                                    </p>
                                </div>
                            )}
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Критичность</label>
                                <select value={severity} onChange={e => setSeverity(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm font-bold bg-white outline-none focus:border-indigo-500 transition-all cursor-pointer">
                                    <option value="low">🟡 Низкая</option>
                                    <option value="medium">🟠 Средняя</option>
                                    <option value="high">🔴 Высокая</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="flex items-center justify-between p-3 border-2 border-gray-100 rounded-xl cursor-pointer hover:border-indigo-200 transition-all bg-white select-none">
                                <span className="text-xs font-bold text-gray-700">🔔 Telegram</span>
                                <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${notifyTelegram ? 'bg-indigo-600' : 'bg-gray-200'}`}>
                                    <div className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${notifyTelegram ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <input type="checkbox" checked={notifyTelegram} onChange={e => setNotifyTelegram(e.target.checked)} className="hidden" />
                            </label>

                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Штраф</label>
                                <input type="number" value={points} onChange={e => setPoints(parseInt(e.target.value) || 0)} className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm font-bold outline-none" />
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Logic / Checklist Editor */}
                    <div className="lg:col-span-8 space-y-6 border-l lg:pl-8">
                        {/* Mode Switcher */}
                        <div className="bg-gray-100 p-1 rounded-xl flex max-w-md">
                            <button
                                onClick={() => setRuleMode('standard')}
                                className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${ruleMode === 'standard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                Обычное правило
                            </button>
                            <button
                                onClick={() => { setRuleMode('checklist'); }}
                                className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${ruleMode === 'checklist' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                Чек-лист (Контроль качества)
                            </button>
                        </div>

                        <div className="max-h-[50vh] overflow-y-auto pr-4 scrollbar-thin">
                            {ruleMode === 'standard' ? (
                                <RuleBlockEditor
                                    logic={logic || { trigger: { block: 'status_change', params: { target_status: 'new' } }, conditions: [] }}
                                    onChange={setLogic}
                                    statuses={statuses}
                                />
                            ) : (
                                <ChecklistEditor
                                    checklist={checklist}
                                    onChange={setChecklist}
                                />
                            )}
                        </div>

                        {/* Test Area */}
                        <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Тестирование</h4>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleSyntheticTest}
                                        disabled={syntheticLoading}
                                        className="bg-white border border-indigo-200 text-indigo-600 px-4 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-indigo-50 transition-all shadow-sm"
                                    >
                                        {syntheticLoading ? '...' : '🧪 Проверить логику'}
                                    </button>
                                </div>
                            </div>

                            {syntheticResult && (
                                <div className={`p-3 rounded-xl border text-[10px] font-bold ${syntheticResult.success ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                                    {syntheticResult.message || syntheticResult.error}
                                    {(syntheticResult as any).checklistResult && (
                                        <div className="mt-1 opacity-80">Результат: {(syntheticResult as any).checklistResult.totalScore}/100</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-8 border-t mt-8">
                    <button onClick={() => setIsOpen(false)} className="px-8 py-3 text-gray-400 font-black uppercase tracking-widest text-xs hover:text-gray-600">Отмена</button>
                    <button
                        onClick={handleSave}
                        disabled={isLoading}
                        className="bg-green-600 text-white px-16 py-4 rounded-xl hover:bg-green-700 transition-all font-black uppercase tracking-widest text-sm shadow-xl shadow-green-100 active:scale-95"
                    >
                        {isLoading ? 'Сохранение...' : '🚀 Запустить правило'}
                    </button>
                </div>
            </div>
        </div>
    );
}
