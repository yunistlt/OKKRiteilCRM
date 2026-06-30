'use client';

import { useState } from 'react';

interface ManagerOption {
    id: number;
    name: string;
    active: boolean;
}

interface CandidateRow {
    orderId: number;
    number: string;
    total: number;
    customerName: string | null;
    contactName: string | null;
    toEmail: string | null;
    movedAt: string;
    itemsCount: number;
    reasonSnippet: string;
    lastSentAt: string | null;
}

interface PreviewState {
    orderId: number;
    number: string;
    to: string;
    subjectText: string;
    html: string;
    aiUsed: boolean;
}

function fmtRub(n: number): string {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽';
}
function fmtDate(s: string): string {
    try { return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch { return '—'; }
}
function fmtDateTime(s: string): string {
    try { return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return '—'; }
}

export default function RelevanceClient({ managers }: { managers: ManagerOption[] }) {
    const today = new Date();
    const defFrom = new Date(today.getFullYear(), today.getMonth() - 3, 1).toISOString().slice(0, 10);
    const defTo = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

    const [managerId, setManagerId] = useState<string>('');
    const [from, setFrom] = useState<string>(defFrom);
    const [to, setTo] = useState<string>(defTo);
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<CandidateRow[] | null>(null);
    const [err, setErr] = useState<string | null>(null);

    // Предпросмотр / отправка
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendResult, setSendResult] = useState<string | null>(null);
    // Заказы, по которым письмо уже отправлено в этой сессии — защита от повторной отправки.
    const [sentOrders, setSentOrders] = useState<Set<number>>(new Set());
    // Конфликт идемпотентности: по заказу уже отправляли (с сервера, переживает перезагрузку).
    const [conflict, setConflict] = useState<{ at: string; to: string } | null>(null);

    async function loadCandidates() {
        setLoading(true); setErr(null); setRows(null);
        try {
            const params = new URLSearchParams({ from: `${from}T00:00:00`, to: `${to}T23:59:59` });
            if (managerId) params.set('managerId', managerId);
            const res = await fetch(`/api/orders/postponed-relevance?${params.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Ошибка загрузки');
            setRows(data.candidates);
        } catch (e: any) {
            setErr(e?.message || 'Ошибка');
        } finally {
            setLoading(false);
        }
    }

    async function openPreview(row: CandidateRow) {
        setPreviewLoading(true); setSendResult(null); setPreview(null);
        setConflict(row.lastSentAt ? { at: row.lastSentAt, to: row.toEmail || '' } : null);
        try {
            const res = await fetch('/api/orders/relevance-email/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: row.orderId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Ошибка генерации');
            setPreview({
                orderId: data.orderId,
                number: data.number,
                to: data.toEmail || '',
                subjectText: data.subjectText,
                html: data.html,
                aiUsed: data.aiUsed,
            });
        } catch (e: any) {
            setSendResult(`Ошибка: ${e?.message || e}`);
            setPreview({ orderId: row.orderId, number: row.number, to: row.toEmail || '', subjectText: '', html: '', aiUsed: false });
        } finally {
            setPreviewLoading(false);
        }
    }

    async function send(force = false) {
        if (!preview) return;
        if (!preview.to) { setSendResult('Укажите адрес получателя'); return; }
        setSending(true); setSendResult(null);
        try {
            const res = await fetch('/api/orders/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderNumber: preview.number,
                    orderId: preview.orderId,
                    to: preview.to,
                    subjectText: preview.subjectText,
                    html: preview.html,
                    force,
                }),
            });
            const data = await res.json();
            if (res.status === 409 && data?.error === 'already_sent') {
                // По заказу уже отправляли — показываем предупреждение и даём осознанный повтор.
                setConflict({ at: data.lastSentAt, to: data.lastTo || preview.to });
                setSendResult(null);
                return;
            }
            if (!res.ok || !data.ok) {
                throw new Error(data?.error || data?.appendError || 'Ошибка отправки');
            }
            const warn = data.appendedToSent
                ? `привязано к заказу, копия в «${data.sentFolder || 'Отправленные'}»`
                : '⚠ отправлено, но копия НЕ легла в Sent (в CRM может не отобразиться)';
            setSendResult(`✅ Отправлено: ${data.subject} — ${warn}`);
            setConflict(null);
            // Помечаем заказ как отправленный — кнопка «Отправить» больше не покажется.
            setSentOrders((prev) => new Set(prev).add(preview.orderId));
        } catch (e: any) {
            setSendResult(`Ошибка: ${e?.message || e}`);
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="text-sm text-slate-800">
            {/* Фильтры */}
            <div className="flex flex-wrap items-end gap-3 border border-slate-200 bg-white p-3">
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Менеджер</span>
                    <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className="border border-slate-300 px-2 py-1 text-sm">
                        <option value="">Все менеджеры</option>
                        {managers.map((m) => (
                            <option key={m.id} value={String(m.id)}>{m.name}{m.active ? '' : ' (неактивен)'}</option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Переведён в «Отложено» с</span>
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">по</span>
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <button onClick={loadCandidates} disabled={loading}
                    className="bg-slate-800 px-4 py-1.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50">
                    {loading ? 'Загрузка…' : 'Показать заказы'}
                </button>
            </div>

            {err && <div className="mt-3 border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}

            {/* Таблица кандидатов */}
            {rows && (
                <div className="mt-3 border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Найдено заказов: {rows.length}
                    </div>
                    {rows.length === 0 && <div className="px-3 py-4 text-xs text-slate-500">Нет отложенных заказов за выбранный период.</div>}
                    {rows.length > 0 && (
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-400">
                                    <th className="px-3 py-2 font-bold">Заказ</th>
                                    <th className="px-3 py-2 font-bold">Клиент / контакт</th>
                                    <th className="px-3 py-2 font-bold">Email</th>
                                    <th className="px-3 py-2 font-bold">Сумма</th>
                                    <th className="px-3 py-2 font-bold">Отложен</th>
                                    <th className="px-3 py-2 font-bold">Причина (комментарий)</th>
                                    <th className="px-3 py-2 font-bold"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.orderId} className="border-b border-slate-100 align-top hover:bg-slate-50">
                                        <td className="px-3 py-2">
                                            <a href={`https://zmktlt.retailcrm.ru/orders/${r.orderId}/edit`} target="_blank" rel="noreferrer"
                                                className="font-bold text-blue-600 hover:underline">#{r.number}</a>
                                            <div className="text-[10px] text-slate-400">{r.itemsCount} поз.</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="font-semibold">{r.customerName || '—'}</div>
                                            <div className="text-[10px] text-slate-500">{r.contactName || ''}</div>
                                        </td>
                                        <td className="px-3 py-2">{r.toEmail || <span className="text-red-500">нет</span>}</td>
                                        <td className="px-3 py-2 whitespace-nowrap font-semibold">{fmtRub(r.total)}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.movedAt)}</td>
                                        <td className="px-3 py-2 text-[11px] text-slate-500">{r.reasonSnippet || '—'}</td>
                                        <td className="px-3 py-2">
                                            {sentOrders.has(r.orderId) ? (
                                                <span className="inline-block bg-slate-100 px-3 py-1 text-[11px] font-bold text-emerald-700">✓ Отправлено</span>
                                            ) : r.lastSentAt ? (
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[11px] font-bold text-emerald-700" title={`Отправлено ${fmtDateTime(r.lastSentAt)}`}>✓ Отправлено {fmtDate(r.lastSentAt)}</span>
                                                    <button onClick={() => openPreview(r)} disabled={!r.toEmail}
                                                        className="self-start text-[10px] text-slate-400 underline hover:text-slate-600 disabled:opacity-40">
                                                        отправить ещё раз
                                                    </button>
                                                </div>
                                            ) : (
                                                <button onClick={() => openPreview(r)} disabled={!r.toEmail}
                                                    className="bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
                                                    title={r.toEmail ? '' : 'У заказа нет email'}>
                                                    Подготовить
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Модалка предпросмотра / отправки */}
            {(previewLoading || preview) && (
                <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
                    <div className="mt-8 w-full max-w-3xl border border-slate-300 bg-white">
                        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
                            <div className="text-sm font-black uppercase tracking-wide text-slate-700">
                                Письмо по заказу {preview ? `#${preview.number}` : '…'}
                            </div>
                            <button onClick={() => { setPreview(null); setSendResult(null); }} className="text-slate-400 hover:text-slate-700">✕</button>
                        </div>

                        {previewLoading && <div className="p-6 text-sm text-slate-500">Генерирую письмо…</div>}

                        {preview && (
                            <div className="p-4">
                                {preview.aiUsed === false && (
                                    <div className="mb-2 border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                                        Сгенерировано по шаблону (LLM недоступен) — проверьте текст перед отправкой.
                                    </div>
                                )}
                                <label className="mb-2 block">
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Кому</span>
                                    <input value={preview.to} onChange={(e) => setPreview({ ...preview, to: e.target.value })}
                                        className="mt-1 w-full border border-slate-300 px-2 py-1 text-sm" />
                                </label>
                                <label className="mb-2 block">
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Тема (тег [#N/{preview.number}] добавится автоматически)</span>
                                    <input value={preview.subjectText} onChange={(e) => setPreview({ ...preview, subjectText: e.target.value })}
                                        className="mt-1 w-full border border-slate-300 px-2 py-1 text-sm" />
                                </label>
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Предпросмотр</div>
                                <div className="max-h-72 overflow-auto border border-slate-200 bg-white p-3"
                                    dangerouslySetInnerHTML={{ __html: preview.html }} />
                                <details className="mt-2">
                                    <summary className="cursor-pointer text-[11px] text-slate-500">Редактировать HTML</summary>
                                    <textarea value={preview.html} onChange={(e) => setPreview({ ...preview, html: e.target.value })}
                                        className="mt-1 h-40 w-full border border-slate-300 p-2 font-mono text-[11px]" />
                                </details>

                                {sendResult && (
                                    <div className="mt-3 border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{sendResult}</div>
                                )}

                                {conflict && !sentOrders.has(preview.orderId) && (
                                    <div className="mt-3 border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                                        ⚠ По заказу №{preview.number} письмо уже отправляли: {fmtDateTime(conflict.at)}
                                        {conflict.to ? ` → ${conflict.to}` : ''}. Повторная отправка отправит клиенту ещё одно письмо.
                                    </div>
                                )}

                                <div className="mt-4 flex items-center justify-end gap-2">
                                    <button onClick={() => { setPreview(null); setSendResult(null); setConflict(null); }}
                                        className="border border-slate-300 px-4 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100">
                                        {sentOrders.has(preview.orderId) ? 'Закрыть' : 'Отмена'}
                                    </button>
                                    {sentOrders.has(preview.orderId) ? (
                                        <span className="bg-slate-100 px-5 py-1.5 text-sm font-bold text-emerald-700">✓ Отправлено</span>
                                    ) : conflict ? (
                                        <button onClick={() => send(true)} disabled={sending || !preview.subjectText || !preview.html}
                                            className="bg-amber-600 px-5 py-1.5 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50">
                                            {sending ? 'Отправка…' : 'Всё равно отправить'}
                                        </button>
                                    ) : (
                                        <button onClick={() => send(false)} disabled={sending || !preview.subjectText || !preview.html}
                                            className="bg-emerald-600 px-5 py-1.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                                            {sending ? 'Отправка…' : 'Отправить клиенту'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
