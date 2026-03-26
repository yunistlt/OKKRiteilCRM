'use client';

import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_VICTORIA_PROMPT } from '@/lib/reactivation';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface CampaignFilters {
    b2b_only?: boolean;
    months?: number;
    min_ltv?: number;
    min_orders?: number;
    max_orders?: number;
    min_avg_check?: number;
    max_avg_check?: number;
    statuses?: string[];
    custom_fields?: Array<{ field: string; value: string }>;
}

interface CampaignSettings {
    victoria_prompt?: string;
    reply_prompt?: string;
    email_subject?: string;
    on_positive?: 'create_order' | 'send_reply';
    new_order_status?: string;
}

interface Campaign {
    id: string;
    title: string;
    status: 'active' | 'paused' | 'completed';
    filters: CampaignFilters;
    settings: CampaignSettings;
    created_at: string;
}

interface OutreachLog {
    id: string;
    campaign_id: string;
    customer_id: number;
    company_name: string | null;
    customer_email: string | null;
    generated_email: string | null;
    status: 'pending' | 'processing' | 'sent' | 'replied' | 'error';
    client_reply: string | null;
    intent_status: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | null;
    sent_at: string | null;
    replied_at: string | null;
    created_at: string;
}

const RETAILCRM_BASE = process.env.NEXT_PUBLIC_RETAILCRM_URL ?? '';

// ─────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────

function StatusBadge({ status }: { status: OutreachLog['status'] }) {
    const map: Record<string, { label: string; cls: string }> = {
        pending:    { label: 'Ожидает',    cls: 'bg-zinc-700 text-zinc-200' },
        processing: { label: 'В работе',   cls: 'bg-blue-900 text-blue-200' },
        sent:       { label: 'Отправлено', cls: 'bg-indigo-900 text-indigo-200' },
        replied:    { label: 'Ответил',    cls: 'bg-emerald-900 text-emerald-200' },
        error:      { label: 'Ошибка',     cls: 'bg-red-900 text-red-300' },
    };
    const { label, cls } = map[status] ?? { label: status, cls: 'bg-zinc-700 text-zinc-200' };
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function IntentBadge({ intent }: { intent: OutreachLog['intent_status'] }) {
    if (!intent) return <span className="text-zinc-500 text-xs">—</span>;
    const map: Record<string, { label: string; cls: string }> = {
        POSITIVE: { label: '🔥 Горячий',  cls: 'bg-emerald-900 text-emerald-200' },
        NEGATIVE: { label: '🚫 Отказ',    cls: 'bg-red-900 text-red-300' },
        NEUTRAL:  { label: '⏳ Нейтрал',  cls: 'bg-yellow-900 text-yellow-200' },
    };
    const { label, cls } = map[intent] ?? { label: intent, cls: 'bg-zinc-700 text-zinc-200' };
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-1">
            <p className="text-xs text-zinc-500 uppercase tracking-widest">{label}</p>
            <p className="text-3xl font-bold text-white">{value}</p>
            {sub && <p className="text-xs text-zinc-500">{sub}</p>}
        </div>
    );
}

function Label({ children }: { children: React.ReactNode }) {
    return <label className="block text-xs text-zinc-400 mb-1.5">{children}</label>;
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            {...props}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
        />
    );
}

function Textarea({ ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            {...props}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
        />
    );
}

function Select({ ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select
            {...props}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
        />
    );
}

// ─────────────────────────────────────────────
// Log Modal
// ─────────────────────────────────────────────

function LogModal({ log, onClose }: { log: OutreachLog; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
                    <div>
                        <p className="font-semibold text-white">{log.company_name ?? `Клиент #${log.customer_id}`}</p>
                        <p className="text-xs text-zinc-500">{log.customer_email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <StatusBadge status={log.status} />
                        <IntentBadge intent={log.intent_status} />
                        <button onClick={onClose} className="ml-2 text-zinc-500 hover:text-white transition-colors text-xl">✕</button>
                    </div>
                </div>
                <div className="overflow-auto flex-1 p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-2">
                        <p className="text-xs uppercase tracking-widest text-zinc-500">📤 Наше письмо</p>
                        <div className="bg-zinc-800 rounded-xl p-4 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed flex-1 min-h-[200px]">
                            {log.generated_email ?? <span className="text-zinc-500 italic">Не сгенерировано</span>}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <p className="text-xs uppercase tracking-widest text-zinc-500">📩 Ответ клиента</p>
                        <div className="bg-zinc-800 rounded-xl p-4 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed flex-1 min-h-[200px]">
                            {log.client_reply ?? <span className="text-zinc-500 italic">Не получен</span>}
                        </div>
                        {log.intent_status && <IntentBadge intent={log.intent_status} />}
                    </div>
                </div>
                <div className="px-6 py-3 border-t border-zinc-800 flex items-center gap-4 text-xs text-zinc-500">
                    {log.sent_at && <span>Отправлено: {new Date(log.sent_at).toLocaleString('ru')}</span>}
                    {log.replied_at && <span>Ответ: {new Date(log.replied_at).toLocaleString('ru')}</span>}
                    {RETAILCRM_BASE && (
                        <a href={`${RETAILCRM_BASE}/customers/${log.customer_id}/edit`} target="_blank" rel="noopener noreferrer"
                            className="ml-auto text-indigo-400 hover:text-indigo-300">
                            Открыть в RetailCRM →
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

type Tab = 'filters' | 'agents' | 'logs';

export default function ReactivationPage() {
    const [tab, setTab] = useState<Tab>('filters');
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [logs, setLogs] = useState<OutreachLog[]>([]);
    const [totalLogs, setTotalLogs] = useState(0);
    const [selectedLog, setSelectedLog] = useState<OutreachLog | null>(null);
    const [selectedCampaignId, setSelectedCampaignId] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Stats
    const [stats, setStats] = useState({ total_sent: 0, total_replied: 0, total_positive: 0 });

    // ── Form: Filters ──
    const [title, setTitle] = useState('');
    const [b2bOnly, setB2bOnly] = useState(true);
    const [months, setMonths] = useState('6');
    const [minLtv, setMinLtv] = useState('');
    const [minOrders, setMinOrders] = useState('');
    const [maxOrders, setMaxOrders] = useState('');
    const [minAvgCheck, setMinAvgCheck] = useState('');
    const [maxAvgCheck, setMaxAvgCheck] = useState('');
    const [customFields, setCustomFields] = useState<Array<{ field: string; value: string }>>([]);

    // ── Form: Agent Settings ──
    const [victoriaPrompt, setVictoriaPrompt] = useState('');
    const [replyPrompt, setReplyPrompt] = useState('');
    const [onPositive, setOnPositive] = useState<'create_order' | 'send_reply'>('create_order');
    const [newOrderStatus, setNewOrderStatus] = useState('new');

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [cRes, lRes] = await Promise.all([
                fetch('/api/reactivation/campaigns'),
                fetch(`/api/reactivation/logs?limit=200${selectedCampaignId ? `&campaign_id=${selectedCampaignId}` : ''}`),
            ]);
            const cData = await cRes.json();
            const lData = await lRes.json();
            setCampaigns(cData.campaigns ?? []);
            const logsList: OutreachLog[] = lData.data ?? [];
            setLogs(logsList);
            setTotalLogs(lData.total ?? 0);

            const sent = logsList.filter(l => ['sent', 'replied'].includes(l.status)).length;
            const replied = logsList.filter(l => l.status === 'replied').length;
            const positive = logsList.filter(l => l.intent_status === 'POSITIVE').length;
            setStats({ total_sent: sent, total_replied: replied, total_positive: positive });
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    }, [selectedCampaignId]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const addCustomField = () => setCustomFields(p => [...p, { field: '', value: '' }]);
    const removeCustomField = (i: number) => setCustomFields(p => p.filter((_, idx) => idx !== i));
    const updateCustomField = (i: number, key: 'field' | 'value', val: string) =>
        setCustomFields(p => p.map((cf, idx) => idx === i ? { ...cf, [key]: val } : cf));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        setSubmitting(true);
        setError(null);
        setSuccess(null);

        const filters: CampaignFilters = {
            b2b_only: b2bOnly || undefined,
            months: months ? parseInt(months) : undefined,
            min_ltv: minLtv ? parseFloat(minLtv) : undefined,
            min_orders: minOrders ? parseInt(minOrders) : undefined,
            max_orders: maxOrders ? parseInt(maxOrders) : undefined,
            min_avg_check: minAvgCheck ? parseFloat(minAvgCheck) : undefined,
            max_avg_check: maxAvgCheck ? parseFloat(maxAvgCheck) : undefined,
            custom_fields: customFields.filter(cf => cf.field && cf.value),
        };

        const settings: CampaignSettings = {
            victoria_prompt: victoriaPrompt.trim() || undefined,
            reply_prompt: replyPrompt.trim() || undefined,
            on_positive: onPositive,
            new_order_status: newOrderStatus || 'new',
        };

        try {
            const res = await fetch('/api/reactivation/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title.trim(), filters, settings }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error ?? 'Error');
            setSuccess(`✅ Кампания создана! В очередь добавлено ${data.queued_customers} клиентов.`);
            setTitle('');
            await fetchAll();
        } catch (e: any) { setError(e.message); }
        finally { setSubmitting(false); }
    };

    const handleStatusChange = async (id: string, status: Campaign['status']) => {
        await fetch(`/api/reactivation/campaigns/${id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        await fetchAll();
    };

    const replyRate = stats.total_sent > 0 ? Math.round((stats.total_replied / stats.total_sent) * 100) : 0;
    const convRate = stats.total_sent > 0 ? Math.round((stats.total_positive / stats.total_sent) * 100) : 0;

    return (
        <div className="min-h-screen bg-zinc-950 text-white px-4 py-8 md:px-10">
            <div className="max-w-7xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex items-end justify-between">
                    <div>
                        <p className="text-xs uppercase tracking-widest text-indigo-400 mb-1">ИИ-Агент</p>
                        <h1 className="text-3xl font-bold">Виктория — Реактиватор B2B</h1>
                        <p className="text-zinc-500 mt-1 text-sm">Автоматические персональные письма для возврата «отказников»</p>
                    </div>
                    <button onClick={fetchAll} className="text-xs text-zinc-500 hover:text-white border border-zinc-800 rounded-lg px-3 py-1.5">↻ Обновить</button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <StatCard label="Отправлено" value={stats.total_sent} />
                    <StatCard label="Ответили" value={stats.total_replied} />
                    <StatCard label="Горячих" value={stats.total_positive} />
                    <StatCard label="Reply Rate" value={`${replyRate}%`} />
                    <StatCard label="Конверсия" value={`${convRate}%`} sub="POSITIVE / Отправлено" />
                </div>

                {/* Alerts */}
                {error && <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 text-sm">{error}</div>}
                {success && <div className="bg-emerald-950 border border-emerald-800 text-emerald-300 rounded-xl px-4 py-3 text-sm">{success}</div>}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* ── Campaign Form ── */}
                    <div className="lg:col-span-1 space-y-4">
                        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden sticky top-8">
                            {/* Form Tabs */}
                            <div className="flex border-b border-zinc-800">
                                {([['filters', 'Фильтры'], ['agents', 'Агенты']] as [Tab, string][]).map(([t, label]) => (
                                    <button key={t} onClick={() => setTab(t)}
                                        className={`flex-1 py-3 text-xs font-medium transition-colors ${tab === t ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-white'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <form onSubmit={handleSubmit} className="p-5 space-y-4">
                                <div>
                                    <Label>Название кампании</Label>
                                    <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Строители 2025 — Отказники" required />
                                </div>

                                {tab === 'filters' && (
                                    <>
                                        <div>
                                            <Label>Давность последнего заказа (месяцев)</Label>
                                            <Input type="number" value={months} onChange={e => setMonths(e.target.value)} placeholder="6" min="1" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <Label>Мин. заказов</Label>
                                                <Input type="number" value={minOrders} onChange={e => setMinOrders(e.target.value)} placeholder="1" min="0" />
                                            </div>
                                            <div>
                                                <Label>Макс. заказов</Label>
                                                <Input type="number" value={maxOrders} onChange={e => setMaxOrders(e.target.value)} placeholder="∞" min="0" />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <Label>Мин. средний чек ₽</Label>
                                                <Input type="number" value={minAvgCheck} onChange={e => setMinAvgCheck(e.target.value)} placeholder="0" min="0" />
                                            </div>
                                            <div>
                                                <Label>Макс. средний чек ₽</Label>
                                                <Input type="number" value={maxAvgCheck} onChange={e => setMaxAvgCheck(e.target.value)} placeholder="∞" min="0" />
                                            </div>
                                        </div>
                                        <div>
                                            <Label>Мин. LTV (общая сумма) ₽</Label>
                                            <Input type="number" value={minLtv} onChange={e => setMinLtv(e.target.value)} placeholder="0" min="0" />
                                        </div>

                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input type="checkbox" checked={b2bOnly} onChange={e => setB2bOnly(e.target.checked)} className="w-4 h-4 rounded accent-indigo-500" />
                                            <span className="text-sm text-zinc-300">Только юр. лица (B2B)</span>
                                        </label>

                                        {/* Кастомные поля */}
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <Label>Фильтр по доп. полям</Label>
                                                <button type="button" onClick={addCustomField}
                                                    className="text-xs text-indigo-400 hover:text-indigo-300">+ Добавить</button>
                                            </div>
                                            <div className="space-y-2">
                                                {customFields.map((cf, i) => (
                                                    <div key={i} className="flex gap-2">
                                                        <Input placeholder="Код поля" value={cf.field} onChange={e => updateCustomField(i, 'field', e.target.value)} />
                                                        <Input placeholder="Значение" value={cf.value} onChange={e => updateCustomField(i, 'value', e.target.value)} />
                                                        <button type="button" onClick={() => removeCustomField(i)} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                )}

                                {tab === 'agents' && (
                                    <>
                                        <div>
                                            <Label>Промпт Агента-Писателя (Виктория)</Label>
                                            <Textarea
                                                rows={6}
                                                value={victoriaPrompt}
                                                onChange={e => setVictoriaPrompt(e.target.value)}
                                                placeholder={DEFAULT_VICTORIA_PROMPT}
                                            />
                                            <p className="text-xs text-zinc-600 mt-1">Оставьте пустым — используется дефолтный промпт</p>
                                        </div>

                                        <div>
                                            <Label>Действие при положительном ответе</Label>
                                            <Select value={onPositive} onChange={e => setOnPositive(e.target.value as any)}>
                                                <option value="create_order">Создать заказ</option>
                                                <option value="send_reply">Написать ответное письмо</option>
                                            </Select>
                                        </div>

                                        {onPositive === 'create_order' && (
                                            <div>
                                                <Label>Статус нового заказа</Label>
                                                <Input value={newOrderStatus} onChange={e => setNewOrderStatus(e.target.value)} placeholder="new" />
                                                <p className="text-xs text-zinc-600 mt-1">Код статуса из RetailCRM (напр. «new»)</p>
                                            </div>
                                        )}

                                        {onPositive === 'send_reply' && (
                                            <div>
                                                <Label>Промпт ответного письма</Label>
                                                <Textarea
                                                    rows={4}
                                                    value={replyPrompt}
                                                    onChange={e => setReplyPrompt(e.target.value)}
                                                    placeholder="Ты B2B-менеджер. Клиент ответил. Напиши краткий живой ответ..."
                                                />
                                            </div>
                                        )}
                                    </>
                                )}

                                <button type="submit" disabled={submitting}
                                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
                                    {submitting ? 'Запускаем...' : '🚀 Запустить кампанию'}
                                </button>
                            </form>
                        </div>

                        {/* Campaigns List */}
                        {campaigns.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-xs uppercase tracking-widest text-zinc-500">Кампании</h3>
                                {campaigns.map(c => (
                                    <div key={c.id}
                                        onClick={() => setSelectedCampaignId(p => p === c.id ? '' : c.id)}
                                        className={`bg-zinc-900 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${selectedCampaignId === c.id ? 'border-indigo-600' : 'border-zinc-800 hover:border-zinc-700'}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="text-sm font-medium text-white truncate">{c.title}</p>
                                            <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${c.status === 'active' ? 'bg-emerald-900 text-emerald-300' : c.status === 'paused' ? 'bg-yellow-900 text-yellow-300' : 'bg-zinc-700 text-zinc-400'}`}>
                                                {c.status === 'active' ? 'Активна' : c.status === 'paused' ? 'Пауза' : 'Завершена'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-zinc-500 mt-1">
                                            {new Date(c.created_at).toLocaleDateString('ru')} ·{' '}
                                            {c.filters.months ?? '?'} мес. ·{' '}
                                            {c.settings?.on_positive === 'send_reply' ? '✉️ Отвечает' : '📋 Создаёт заказ'}
                                        </p>
                                        <div className="flex gap-3 mt-2 text-xs" onClick={e => e.stopPropagation()}>
                                            {c.status !== 'active' && <button onClick={() => handleStatusChange(c.id, 'active')} className="text-emerald-400 hover:text-emerald-300">Возобновить</button>}
                                            {c.status === 'active' && <button onClick={() => handleStatusChange(c.id, 'paused')} className="text-yellow-400 hover:text-yellow-300">Пауза</button>}
                                            {c.status !== 'completed' && <button onClick={() => handleStatusChange(c.id, 'completed')} className="text-zinc-500 hover:text-zinc-400">Завершить</button>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── Logs Table ── */}
                    <div className="lg:col-span-2">
                        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
                                <h2 className="font-semibold">
                                    Очередь рассылки
                                    {totalLogs > 0 && <span className="ml-2 text-xs text-zinc-500 font-normal">{totalLogs} записей</span>}
                                </h2>
                                {selectedCampaignId && (
                                    <button onClick={() => setSelectedCampaignId('')} className="text-xs text-zinc-500 hover:text-white">× Сбросить</button>
                                )}
                            </div>

                            {loading ? (
                                <div className="flex items-center justify-center py-20 text-zinc-600 text-sm">Загрузка...</div>
                            ) : logs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-600">
                                    <span className="text-4xl">📭</span>
                                    <p className="text-sm">Создайте кампанию, чтобы заполнить очередь.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
                                                <th className="text-left px-4 py-3 font-medium">Клиент</th>
                                                <th className="text-left px-4 py-3 font-medium">Email</th>
                                                <th className="text-left px-4 py-3 font-medium">Статус</th>
                                                <th className="text-left px-4 py-3 font-medium">Намерение</th>
                                                <th className="px-4 py-3" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {logs.map(log => (
                                                <tr key={log.id}
                                                    className="border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-colors cursor-pointer"
                                                    onClick={() => setSelectedLog(log)}>
                                                    <td className="px-4 py-3">
                                                        <p className="font-medium text-white truncate max-w-[160px]">
                                                            {log.company_name ?? `Клиент #${log.customer_id}`}
                                                        </p>
                                                        {RETAILCRM_BASE ? (
                                                            <a href={`${RETAILCRM_BASE}/customers/${log.customer_id}/edit`} target="_blank" rel="noopener noreferrer"
                                                                onClick={e => e.stopPropagation()} className="text-xs text-indigo-400 hover:text-indigo-300">
                                                                #{log.customer_id}
                                                            </a>
                                                        ) : (
                                                            <span className="text-xs text-zinc-500">#{log.customer_id}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-zinc-400 text-xs truncate max-w-[160px]">{log.customer_email ?? '—'}</td>
                                                    <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                                                    <td className="px-4 py-3"><IntentBadge intent={log.intent_status} /></td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button onClick={e => { e.stopPropagation(); setSelectedLog(log); }}
                                                            className="text-xs text-zinc-500 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded px-2 py-1 transition-colors">
                                                            Просмотр
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {selectedLog && <LogModal log={selectedLog} onClose={() => setSelectedLog(null)} />}
        </div>
    );
}
