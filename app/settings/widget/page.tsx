'use client';

import { useState, useEffect } from 'react';

const DEFAULTS = {
    enabled: true,
    agent_name: 'Елена (ЗМК)',
    agent_title: 'В сети • Продуктолог',
    agent_avatar_url: 'https://okk.zmksoft.com/images/agents/elena.png',
    primary_color: '#10b981',
    position_bottom: 260,
    position_right: 20,
    auto_expand_delay_ms: 30000,
    greeting_delay1_ms: 10000,
    greeting_delay2_ms: 20000,
    quick_buttons_delay_ms: 25000,
    exit_intent_enabled: true,
    email_capture_enabled: true,
    quick_buttons_enabled: true,
    hide_on_mobile: false,
    position_x_percent: 95,
    position_y_percent: 95,
};

type Config = typeof DEFAULTS;

export default function WidgetSettingsPage() {
    const [cfg, setCfg] = useState<Config>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetch('/api/settings/widget')
            .then(r => r.json())
            .then(data => {
                if (data && typeof data === 'object' && !data.error) {
                    setCfg({ ...DEFAULTS, ...data });
                }
            })
            .finally(() => setLoading(false));
    }, []);

    function set<K extends keyof Config>(key: K, value: Config[K]) {
        setCfg(prev => ({ ...prev, [key]: value }));
        setSaved(false);
    }

    async function handleSave() {
        setSaving(true); setError(''); setSaved(false);
        try {
            const res = await fetch('/api/settings/widget', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cfg),
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Ошибка сохранения');
            setSaved(true);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    const embedCode = `<script src="https://okk.zmksoft.com/api/widget/embed" async></script>`;

    if (loading) return <div className="p-8 text-gray-500">Загрузка настроек...</div>;

    return (
        <div className="max-w-2xl mx-auto p-8">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Настройки виджета Ловца Лидов</h1>
                <p className="mt-1 text-sm text-gray-500">
                    Управляйте внешним видом и поведением чат-виджета на сайте.
                </p>
            </div>

            {/* Код для вставки */}
            <div className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="mb-2 text-sm font-semibold text-emerald-800">Код для вставки в Webasyst</div>
                <div className="text-xs text-gray-500 mb-2">Вставьте один раз в блок сайта — больше ничего трогать не нужно:</div>
                <pre className="bg-white rounded-lg border border-emerald-100 p-3 text-xs font-mono text-gray-800 overflow-x-auto select-all">
                    {embedCode}
                </pre>
            </div>

            <div className="space-y-6">
                {/* Вкл/выкл */}
                <Section title="Статус виджета">
                    <Toggle
                        label="Виджет включён"
                        description="Если выключить — скрипт перестанет загружать виджет на сайте"
                        value={cfg.enabled}
                        onChange={v => set('enabled', v)}
                    />
                </Section>

                {/* Агент */}
                <Section title="Агент">
                    <Field label="Имя агента">
                        <input
                            className="input"
                            value={cfg.agent_name}
                            onChange={e => set('agent_name', e.target.value)}
                            placeholder="Елена (ЗМК)"
                        />
                    </Field>
                    <Field label="Статус / должность">
                        <input
                            className="input"
                            value={cfg.agent_title}
                            onChange={e => set('agent_title', e.target.value)}
                            placeholder="В сети • Продуктолог"
                        />
                    </Field>
                    <Field label="URL аватара">
                        <input
                            className="input"
                            value={cfg.agent_avatar_url}
                            onChange={e => set('agent_avatar_url', e.target.value)}
                            placeholder="https://..."
                        />
                        {cfg.agent_avatar_url && (
                            <img
                                src={cfg.agent_avatar_url}
                                alt="avatar"
                                className="mt-2 w-10 h-10 rounded-full object-cover border"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                        )}
                    </Field>
                </Section>

                {/* Внешний вид */}
                <Section title="Внешний вид">
                    <Field label="Основной цвет">
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={cfg.primary_color}
                                onChange={e => set('primary_color', e.target.value)}
                                className="w-10 h-10 rounded cursor-pointer border border-gray-200"
                            />
                            <input
                                className="input w-32"
                                value={cfg.primary_color}
                                onChange={e => set('primary_color', e.target.value)}
                                placeholder="#10b981"
                            />
                        </div>
                    </Field>
                    <div className="mt-6">
                        <label className="mb-2 block text-sm font-medium text-gray-700">Расположение на экране</label>
                        <p className="text-xs text-gray-500 mb-6">Настройте положение виджета, передвигая ползунки (в процентах от краев экрана).</p>
                        
                        <div className="flex gap-6 items-start max-w-xl">
                            {/* Vertical slider */}
                            <div className="flex flex-col items-center justify-between h-[300px]">
                                <span className="text-[10px] font-bold text-gray-400 mb-2">0% (Верх)</span>
                                <input 
                                    type="range" 
                                    min="0" max="100" 
                                    value={cfg.position_y_percent}
                                    onChange={e => set('position_y_percent', Number(e.target.value))}
                                    className="w-[250px] transform -rotate-90 origin-center accent-emerald-500 cursor-pointer"
                                    style={{ margin: '125px 0' }}
                                />
                                <span className="text-[10px] font-bold text-gray-400 mt-2">100% (Низ)</span>
                            </div>
                            
                            <div className="flex-1 flex flex-col">
                                {/* Horizontal slider */}
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-[10px] font-bold text-gray-400 mr-2">0% (Лево)</span>
                                    <input 
                                        type="range" 
                                        min="0" max="100" 
                                        value={cfg.position_x_percent}
                                        onChange={e => set('position_x_percent', Number(e.target.value))}
                                        className="flex-1 accent-emerald-500 cursor-pointer"
                                    />
                                    <span className="text-[10px] font-bold text-gray-400 ml-2">100% (Право)</span>
                                </div>
                                
                                {/* Preview Box */}
                                <div className="relative w-full h-[300px] bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-inner" style={{ backgroundImage: 'radial-gradient(#e5e7eb 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
                                    {/* Simulated Widget Button */}
                                    <div 
                                        className="absolute w-10 h-10 rounded-full shadow-lg border-2 border-white flex items-center justify-center transition-all duration-75"
                                        style={{ 
                                            left: `calc(${cfg.position_x_percent}% - 20px)`, 
                                            top: `calc(${cfg.position_y_percent}% - 20px)`,
                                            backgroundColor: cfg.primary_color
                                        }}
                                    >
                                        <div className="w-5 h-5 bg-white rounded-full opacity-30 animate-pulse"></div>
                                    </div>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-40">
                                        <svg viewBox="0 0 24 24" width="48" height="48" fill="#9ca3af" className="mb-2"><path d="M19,2H5A3,3 0 0,0 2,5V19A3,3 0 0,0 5,22H19A3,3 0 0,0 22,19V5A3,3 0 0,0 19,2M19,19H5V5H19V19M11,17V15H13V17H11M11,13V7H13V13H11Z"/></svg>
                                        <span className="text-xl font-black uppercase tracking-widest text-gray-400">Сайт</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Section>

                {/* Поведение */}
                <Section title="Поведение">
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Авто-раскрытие (сек)">
                            <input
                                type="number"
                                className="input"
                                value={cfg.auto_expand_delay_ms / 1000}
                                onChange={e => set('auto_expand_delay_ms', Number(e.target.value) * 1000)}
                                min={5}
                            />
                        </Field>
                        <Field label="1-е приветствие (сек)">
                            <input
                                type="number"
                                className="input"
                                value={cfg.greeting_delay1_ms / 1000}
                                onChange={e => set('greeting_delay1_ms', Number(e.target.value) * 1000)}
                                min={1}
                            />
                        </Field>
                        <Field label="2-е приветствие (сек)">
                            <input
                                type="number"
                                className="input"
                                value={cfg.greeting_delay2_ms / 1000}
                                onChange={e => set('greeting_delay2_ms', Number(e.target.value) * 1000)}
                                min={1}
                            />
                        </Field>
                        <Field label="Кнопки действий (сек)">
                            <input
                                type="number"
                                className="input"
                                value={cfg.quick_buttons_delay_ms / 1000}
                                onChange={e => set('quick_buttons_delay_ms', Number(e.target.value) * 1000)}
                                min={1}
                            />
                        </Field>
                    </div>
                </Section>

                {/* Функции */}
                <Section title="Функции">
                    <Toggle
                        label="Скрывать на мобильных"
                        description="Не загружать и не показывать виджет на экранах телефонов (ширина < 768px)"
                        value={cfg.hide_on_mobile}
                        onChange={v => set('hide_on_mobile', v)}
                    />
                    <Toggle
                        label="Exit-intent (показ при уходе)"
                        description="Виджет открывается когда посетитель двигает мышь к закрытию вкладки"
                        value={cfg.exit_intent_enabled}
                        onChange={v => set('exit_intent_enabled', v)}
                    />
                    <Toggle
                        label="Захват email (wishlist)"
                        description="Предложение отправить список просмотренных товаров на почту"
                        value={cfg.email_capture_enabled}
                        onChange={v => set('email_capture_enabled', v)}
                    />
                    <Toggle
                        label="Кнопки быстрых действий"
                        description="КП / Позвоните мне / Есть вопрос — через N секунд после приветствия"
                        value={cfg.quick_buttons_enabled}
                        onChange={v => set('quick_buttons_enabled', v)}
                    />
                </Section>
            </div>

            {/* Кнопка сохранения */}
            <div className="mt-8 flex items-center gap-4">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                    {saving ? 'Сохраняю...' : 'Сохранить настройки'}
                </button>
                {saved && <span className="text-sm text-emerald-600 font-medium">✓ Сохранено</span>}
                {error && <span className="text-sm text-red-600">{error}</span>}
            </div>

            <p className="mt-3 text-xs text-gray-400">
                Изменения вступят в силу в течение 60 секунд (кеш CDN).
            </p>

            <style jsx>{`
                .input {
                    width: 100%;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    padding: 8px 12px;
                    font-size: 14px;
                    outline: none;
                    transition: border-color 0.15s;
                }
                .input:focus { border-color: #10b981; }
            `}</style>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
            {children}
        </div>
    );
}

function Toggle({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-4 py-1">
            <div>
                <div className="text-sm font-medium text-gray-800">{label}</div>
                {description && <div className="text-xs text-gray-500 mt-0.5">{description}</div>}
            </div>
            <button
                type="button"
                onClick={() => onChange(!value)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${value ? 'bg-emerald-500' : 'bg-gray-200'}`}
            >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${value ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
        </div>
    );
}
