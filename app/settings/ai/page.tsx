
'use client';

import { useState, useEffect } from 'react';

export default function AIPrimitivizationPage() {
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
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
        fetchPrompt();
    }, []);

    async function fetchPrompt() {
        try {
            const res = await fetch('/api/settings/prompts');
            const data = await res.json();
            // Assuming we want 'order_analysis_main'
            const main = data.find((p: any) => p.key === 'order_analysis_main');
            if (main) {
                // Unescape newlines if they are stored as literals
                const unescaped = main.content.replace(/\\n/g, '\n');
                setPrompt(unescaped);
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
                    key: 'order_analysis_main',
                    content: prompt, // Will happen as regular string, JSON.stringify handles escaping
                    description: 'Main Traffic Light Prompt'
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

    async function handleTest() {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await fetch('/api/analysis/test-prompt', {
                method: 'POST',
                body: JSON.stringify({ prompt })
                // user can provide orderId if we add input
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

    if (loading) return <div className="p-8">Loading...</div>;

    return (
        <div className="p-4 md:p-8 max-w-6xl mx-auto">
            <h1 className="text-xl md:text-2xl font-bold mb-6">Обучение ИИ (Настройка Промта)</h1>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Editor */}
                <div className="space-y-4">
                    <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                        <label className="block text-sm font-bold mb-2">Инструкция для ИИ (System Prompt)</label>
                        <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-800 mb-3 space-y-1">
                            <p className="font-bold">📝 Как заполнять:</p>
                            <p>Пишите сюда правила, как для живого сотрудника. Используйте placeholders (заполнители), куда система подставит данные заказа:</p>
                            <ul className="list-disc pl-4 mt-1 space-y-0.5 font-mono">
                                <li>{'{{transcript}}'} - текст разговора с клиентом</li>
                                <li>{'{{days}}'} - дней без движения</li>
                                <li>{'{{sum}}'} - сумма заказа</li>
                                <li>{'{{status}}'} - текущий статус</li>
                            </ul>
                            <p className="mt-2 text-blue-600 italic">ИИ будет использовать эту "шпаргалку" при каждом анализе.</p>
                        </div>
                        <textarea
                            className="w-full h-[400px] md:h-[600px] p-4 text-xs md:text-sm font-mono border rounded bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none leading-relaxed"
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                        />
                        <div className="flex flex-col sm:flex-row justify-between gap-3 mt-4">
                            <button
                                onClick={handleTest}
                                disabled={testing}
                                className="px-4 py-2 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 disabled:opacity-50 w-full sm:w-auto"
                            >
                                {testing ? 'Тестируем...' : '🧪 Тестировать (Случайный заказ)'}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 w-full sm:w-auto"
                            >
                                {saving ? 'Сохраняем...' : '💾 Сохранить'}
                            </button>
                        </div>
                        {error && <div className="mt-2 text-red-500 text-sm">{error}</div>}
                        {success && <div className="mt-2 text-green-500 text-sm">{success}</div>}
                    </div>
                </div>

                {/* Test Result */}
                <div className="space-y-4">
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
                                        <span className="text-2xl md:text-3xl">
                                            {testResult.result?.traffic_light === 'red' ? '🔴' :
                                                testResult.result?.traffic_light === 'yellow' ? '🟡' : '🟢'}
                                        </span>
                                        <div>
                                            <h3 className="font-bold text-base md:text-lg">Оценка ИИ</h3>
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

                                {/* Order Info Card */}
                                {testResult.order && (
                                    <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
                                        <h3 className="font-bold text-md border-b pb-2">📦 Информация о заказе</h3>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                            <div>
                                                <span className="text-gray-500 block">Номер:</span>
                                                <a
                                                    href={testResult.retailCrmUrl ? `${testResult.retailCrmUrl}/orders/${testResult.order.id}/edit` : '#'}
                                                    target={testResult.retailCrmUrl ? '_blank' : undefined}
                                                    className="font-mono font-bold text-blue-600 hover:underline text-lg"
                                                    onClick={e => !testResult.retailCrmUrl && e.preventDefault()}
                                                >
                                                    #{testResult.order.number}
                                                </a>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block">Сумма:</span>
                                                <p className="font-bold text-lg">{testResult.order.totalSum?.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })}</p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block">Менеджер:</span>
                                                <p className="font-medium">{testResult.order.managerName}</p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block">Статус:</span>
                                                <div
                                                    className="inline-block px-2 py-0.5 rounded font-bold text-xs uppercase tracking-wide border"
                                                    style={{
                                                        borderColor: testResult.order.statusColor || '#ccc',
                                                        backgroundColor: testResult.order.statusColor ? `${testResult.order.statusColor}20` : '#f3f4f6',
                                                        color: testResult.order.statusColor || '#374151'
                                                    }}
                                                >
                                                    {testResult.order.status}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block">Категория товара:</span>
                                                <p>{testResult.order.productCategory}</p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block">Категория клиента:</span>
                                                <p>{testResult.order.clientCategory}</p>
                                            </div>
                                        </div>

                                        <div className="pt-2 border-t flex justify-between items-center">
                                            <span className="text-gray-500 text-sm">Дней без обновления:</span>
                                            <p className="font-bold text-orange-600">{testResult.order.daysSinceUpdate}</p>
                                        </div>

                                        {testResult.order.lastCall && (
                                            <div className="pt-2 border-t">
                                                <h4 className="font-semibold text-sm mb-2">📞 Последний звонок</h4>
                                                <div className="text-xs text-gray-600 mb-1 flex items-center gap-2">
                                                    <span className="font-mono bg-gray-100 px-1 rounded">
                                                        {testResult.order.lastCall.timestamp
                                                            ? new Date(testResult.order.lastCall.timestamp).toLocaleString('ru-RU')
                                                            : 'Неизвестно'}
                                                    </span>
                                                    <span>⏱ {testResult.order.lastCall.duration} сек</span>
                                                </div>
                                                {testResult.order.lastCall.transcript ? (
                                                    <div className="bg-gray-50 p-3 rounded text-xs md:text-sm max-h-32 overflow-y-auto mt-2 italic border border-gray-100">
                                                        "{testResult.order.lastCall.transcript}"
                                                    </div>
                                                ) : (
                                                    <div className="text-gray-400 text-xs italic mt-1">Нет транскрипта</div>
                                                )}
                                            </div>
                                        )}

                                        {testResult.order.comments !== 'Нет комментариев' && (
                                            <div className="pt-2 border-t">
                                                <h4 className="font-semibold text-sm mb-2">💬 Комментарии</h4>
                                                <div className="bg-gray-50 p-3 rounded text-xs md:text-sm">
                                                    {testResult.order.comments}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    ) : (
                        <div className="bg-gray-50 text-gray-500 italic p-8 rounded-lg text-center h-[200px] md:h-[600px] flex items-center justify-center text-sm md:text-base">
                            Нажмите "Тестировать" чтобы увидеть как ИИ оценит заказ с вашим промтом
                        </div>
                    )}
                </div>
            </div>

            {/* Save Example Modal */}
            {showSaveModal && testResult?.order && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Сохранить как пример обучения</h2>
                            <button
                                onClick={() => setShowSaveModal(false)}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                ×
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm">
                                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Заказ:</span>
                                        <span className="font-bold">#{testResult.order.number}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Сумма:</span>
                                        <span className="font-bold">{testResult.order.totalSum?.toLocaleString('ru-RU')} ₽</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-500">Статус:</span>
                                        <span
                                            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border"
                                            style={{
                                                borderColor: testResult.order.statusColor || '#ccc',
                                                backgroundColor: testResult.order.statusColor ? `${testResult.order.statusColor}20` : '#fff',
                                                color: testResult.order.statusColor || '#333'
                                            }}
                                        >
                                            {testResult.order.status}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Менеджер:</span>
                                        <span className="font-medium text-xs text-right">{testResult.order.managerName}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Color Selection */}
                            <div>
                                <label className="block font-medium mb-2">Оценка:</label>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setSaveColor('red')}
                                        className={`flex-1 p-3 rounded-lg border-2 ${saveColor === 'red'
                                            ? 'bg-red-100 border-red-500'
                                            : 'bg-white border-gray-200'
                                            }`}
                                    >
                                        🔴 Критичный
                                    </button>
                                    <button
                                        onClick={() => setSaveColor('yellow')}
                                        className={`flex-1 p-3 rounded-lg border-2 ${saveColor === 'yellow'
                                            ? 'bg-yellow-100 border-yellow-500'
                                            : 'bg-white border-gray-200'
                                            }`}
                                    >
                                        🟡 Внимание
                                    </button>
                                    <button
                                        onClick={() => setSaveColor('green')}
                                        className={`flex-1 p-3 rounded-lg border-2 ${saveColor === 'green'
                                            ? 'bg-green-100 border-green-500'
                                            : 'bg-white border-gray-200'
                                            }`}
                                    >
                                        🟢 Норма
                                    </button>
                                </div>
                            </div>

                            {/* Reasoning */}
                            <div>
                                <label className="block font-medium mb-2">Обоснование:</label>
                                <textarea
                                    value={saveReasoning}
                                    onChange={(e) => setSaveReasoning(e.target.value)}
                                    className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    rows={4}
                                    placeholder="Почему эта оценка правильная?"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setShowSaveModal(false)}
                                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    Отмена
                                </button>
                                <button
                                    onClick={handleSaveAsExample}
                                    disabled={savingExample || !saveReasoning.trim()}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {savingExample ? 'Сохранение...' : '💾 Сохранить'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
