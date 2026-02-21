
'use client';

import { useState, useEffect } from 'react';

import { DEFAULT_ROUTING_PROMPT } from '@/lib/prompts';

type PromptKey = 'order_analysis_main' | 'order_routing_main';

export default function AIPrimitivizationPage() {
    const [activeTab, setActiveTab] = useState<PromptKey>('order_analysis_main');
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Testing specific states
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<any>(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Save Example Modal State
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveColor, setSaveColor] = useState<'red' | 'yellow' | 'green'>('green');
    const [saveReasoning, setSaveReasoning] = useState('');
    const [savingExample, setSavingExample] = useState(false);

    useEffect(() => {
        setLoading(true);
        fetchPrompt(activeTab);
    }, [activeTab]);

    async function fetchPrompt(key: PromptKey) {
        try {
            const res = await fetch(`/api/settings/prompts`);
            const data = await res.json();
            const found = data.find((p: any) => p.key === key);

            if (found) {
                const unescaped = found.content.replace(/\\n/g, '\n');
                setPrompt(unescaped);
            } else {
                // Set defaults if missing
                if (key === 'order_routing_main') {
                    setPrompt(DEFAULT_ROUTING_PROMPT);
                } else {
                    setPrompt('');
                }
            }
        } catch (e) {
            setError('Failed to fetch prompt');
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            const res = await fetch('/api/settings/prompts', {
                method: 'POST',
                body: JSON.stringify({
                    key: activeTab,
                    content: prompt,
                    description: activeTab === 'order_analysis_main'
                        ? 'Main Traffic Light Prompt'
                        : 'Main Order Routing System Prompt'
                })
            });
            if (!res.ok) throw new Error('Save failed');
            setSuccess('Prompt saved successfully!');
        } catch (e) {
            setError('Failed to save prompt');
        } finally {
            setSaving(false);
        }
    }

    // Only allow testing for Analysis prompt for now (Routing requires complex setup)
    const canTest = activeTab === 'order_analysis_main';

    async function handleTest() {
        if (!canTest) return;
        setTesting(true);
        setTestResult(null);
        try {
            const res = await fetch('/api/analysis/test-prompt', {
                method: 'POST',
                body: JSON.stringify({ prompt })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setTestResult(data);
        } catch (e: any) {
            setTestResult({ error: e.message });
        } finally {
            setTesting(false);
        }
    }

    // Modal helpers...
    function openSaveModal() {
        if (!testResult?.result || !testResult?.order) return;
        setSaveColor(testResult.result.traffic_light);
        setSaveReasoning(testResult.result.short_reason || '');
        setShowSaveModal(true);
    }

    async function handleSaveAsExample() {
        if (!testResult?.order || !saveReasoning.trim()) {
            alert('Введите обоснование');
            return;
        }
        setSavingExample(true);
        try {
            const res = await fetch('/api/settings/training-examples', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: testResult.order.id,
                    orderNumber: testResult.order.number,
                    trafficLight: saveColor,
                    userReasoning: saveReasoning,
                    orderContext: testResult.order,
                    createdBy: 'test_prompt'
                })
            });
            if (!res.ok) throw new Error('Failed to save');
            alert('✅ Пример сохранен!');
            setShowSaveModal(false);
        } catch (e) {
            alert('Ошибка сохранения примера');
        } finally {
            setSavingExample(false);
        }
    }

    if (loading && !prompt) return <div className="p-8">Loading...</div>;

    return (
        <div className="w-full h-full px-4 py-4 md:px-8">
            <h1 className="text-xl md:text-2xl font-bold mb-6">⚙️ Настройка Логики ИИ</h1>

            {/* Tabs */}
            <div className="flex gap-4 border-b border-gray-200 mb-6 overflow-x-auto">
                <button
                    onClick={() => setActiveTab('order_analysis_main')}
                    className={`pb-3 px-1 text-sm font-bold border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === 'order_analysis_main'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                >
                    <img src="/images/agents/anna.png" alt="Anna" className="w-5 h-5 rounded-full" />
                    Анна: Анализ Эффективности
                </button>
                <button
                    onClick={() => setActiveTab('order_routing_main')}
                    className={`pb-3 px-1 text-sm font-bold border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === 'order_routing_main'
                        ? 'border-purple-600 text-purple-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                >
                    <img src="/images/agents/maxim.png" alt="Maxim" className="w-5 h-5 rounded-full" />
                    Максим: Маршрутизация
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Editor */}
                <div className="space-y-4">
                    <div className="bg-white p-4 rounded-lg shadow border border-gray-200 h-full flex flex-col">
                        <label className="block text-sm font-bold mb-2">
                            System Prompt ({activeTab === 'order_analysis_main' ? 'Анализ' : 'Роутинг'})
                        </label>

                        {activeTab === 'order_analysis_main' ? (
                            <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-800 mb-3 space-y-1">
                                <p className="font-bold">📝 Placeholders для Анализа:</p>
                                <ul className="list-disc pl-4 mt-1 space-y-0.5 font-mono">
                                    <li>{'{{transcript}}'} - текст разговора</li>
                                    <li>{'{{days}}'} - дней без движения</li>
                                    <li>{'{{sum}}'} - сумма заказа</li>
                                    <li>{'{{status}}'} - текущий статус</li>
                                </ul>
                            </div>
                        ) : (
                            <div className="bg-purple-50 p-3 rounded-lg text-xs text-purple-800 mb-3 space-y-1">
                                <p className="font-bold">📝 Placeholders для Роутинга:</p>
                                <ul className="list-disc pl-4 mt-1 space-y-0.5 font-mono">
                                    <li>{'{{statusList}}'} - список доступных статусов (ОБЯЗАТЕЛЬНО)</li>
                                    <li>{'{{contextPrompt}}'} - системное время и обновления</li>
                                    <li>{'{{auditPrompt}}'} - данные аудита (транскрипты/письма)</li>
                                </ul>
                                <p className="mt-1 font-bold text-red-600">Внимание: Это критическая логика смены статусов!</p>
                            </div>
                        )}

                        <textarea
                            className="flex-1 min-h-[500px] w-full p-4 text-xs md:text-sm font-mono border rounded bg-gray-50 focus:ring-2 outline-none leading-relaxed resize-y"
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            style={{ borderColor: activeTab === 'order_routing_main' ? '#d8b4fe' : '#e5e7eb' }}
                        />
                        <div className="flex flex-col sm:flex-row justify-between gap-3 mt-4">
                            {canTest && (
                                <button
                                    onClick={handleTest}
                                    disabled={testing}
                                    className="px-4 py-2 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 disabled:opacity-50 w-full sm:w-auto"
                                >
                                    {testing ? 'Тестируем...' : '🧪 Тестировать (Случайный)'}
                                </button>
                            )}
                            {!canTest && (
                                <button className="px-4 py-2 bg-gray-100 text-gray-400 rounded text-sm cursor-not-allowed w-full sm:w-auto">
                                    Тестирование роутинга только в AI Инструменты
                                </button>
                            )}

                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className={`px-4 py-2 text-white rounded text-sm disabled:opacity-50 w-full sm:w-auto ${activeTab === 'order_routing_main' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'
                                    }`}
                            >
                                {saving ? 'Сохраняем...' : '💾 Сохранить'}
                            </button>
                        </div>
                        {error && <div className="mt-2 text-red-500 text-sm">{error}</div>}
                        {success && <div className="mt-2 text-green-500 text-sm">{success}</div>}
                    </div>
                </div>

                {/* Right Panel (Test Result or Help) */}
                <div className="space-y-4">
                    {activeTab === 'order_analysis_main' ? (
                        <>
                            {/* Existing Analysis Test UI */}
                            <h2 className="text-lg font-semibold">Результат Теста</h2>
                            {testResult ? (
                                testResult.error ? (
                                    <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg text-sm">
                                        <strong>Ошибка:</strong> {testResult.error}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {/* AI Result Card */}
                                        <div className={`p-4 rounded-lg border-2 ${testResult.result?.traffic_light === 'red' ? 'bg-red-50 border-red-300' :
                                            testResult.result?.traffic_light === 'yellow' ? 'bg-yellow-50 border-yellow-300' :
                                                'bg-green-50 border-green-300'
                                            }`}>
                                            <div className="flex items-center gap-3 mb-2">
                                                <img src="/images/agents/anna.png" alt="Anna" className="w-10 h-10 rounded-full border-2 border-white shadow-sm" />
                                                <div>
                                                    <h3 className="font-bold text-base md:text-lg">Вердикт Анны</h3>
                                                    <p className="text-xs md:text-sm text-gray-600">{testResult.result?.short_reason}</p>
                                                </div>
                                            </div>
                                            <div className="mt-2 p-3 bg-white rounded border border-gray-200 text-sm">
                                                <strong>Рекомендация:</strong> {testResult.result?.recommended_action}
                                            </div>

                                            {/* Save as Example Button */}
                                            <div className="mt-3">
                                                <button
                                                    onClick={openSaveModal}
                                                    className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm"
                                                >
                                                    💾 Сохранить как пример обучения
                                                </button>
                                            </div>
                                        </div>

                                        {/* Order Info Card - Rendered simplified here */}
                                        {testResult.order && (
                                            <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-2 text-xs">
                                                <p><strong>Заказ #{testResult.order.number}</strong> ({testResult.order.status})</p>
                                                <p className="italic text-gray-600">{testResult.order.comments}</p>
                                            </div>
                                        )}
                                    </div>
                                )
                            ) : (
                                <div className="bg-gray-50 text-gray-500 italic p-8 rounded-lg text-center h-[200px] flex items-center justify-center text-sm">
                                    Нажмите "Тестировать" чтобы увидеть результат
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-sm text-gray-700 space-y-4">
                            <h3 className="font-bold text-lg text-purple-900">ℹ️ О Пропмте Роутинга</h3>
                            <p>
                                Этот промпт отвечает за принятие решений о смене статуса заказов типа "Согласование отмены".
                                Он получает данные из CRM, транскрипты звонков и переписку (Аудит).
                            </p>
                            <div className="bg-white p-4 rounded border border-gray-200">
                                <h4 className="font-bold mb-2">Логика по умолчанию:</h4>
                                <ul className="list-disc pl-4 space-y-1">
                                    <li>Анализирует комментарий менеджера и Audit Trail.</li>
                                    <li>Если клиент просит счет/не отменять &rarr; переводит в рабочий статус.</li>
                                    <li>Если клиент отказался &rarr; переводит в отмену.</li>
                                    <li>Если есть конфликт &rarr; оставляет на проверку.</li>
                                </ul>
                            </div>
                            <p className="italic text-xs">
                                Чтобы протестировать изменения, перейдите в раздел <strong>AI Инструменты</strong> и запустите "Тест" (Dry Run).
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Save Example Modal */}
            {showSaveModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
                        <h2 className="text-xl font-bold mb-4">Сохранить пример</h2>
                        {/* Simplified Modal Logic for brevity in replace */}
                        <div className="space-y-4">
                            <textarea
                                value={saveReasoning}
                                onChange={(e) => setSaveReasoning(e.target.value)}
                                className="w-full p-2 border rounded"
                                rows={3}
                            />
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 border rounded">Cancel</button>
                                <button onClick={handleSaveAsExample} className="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
