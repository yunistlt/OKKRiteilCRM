'use client';

/**
 * Письмо сразу по нескольким заказам.
 *
 * Владелец 05.10.2026: «нужна функция выделения нескольких заказов и
 * возможность отправить все сразу письма-шаблоны, перенос даты после отправки
 * писем».
 *
 * Шаблон применяется к каждому заказу отдельно: с заданием для ИИ письмо
 * пишется под конкретный заказ, обычный — подставляет его данные. Поэтому это
 * не рассылка одинакового текста, а пачка персональных писем.
 */
import { useEffect, useState } from 'react';

type Template = { code: string; name: string; mode?: string };

export default function BulkEmailModal({
    numbers,
    onClose,
    onDone,
}: {
    numbers: string[];
    onClose: () => void;
    onDone: () => void;
}) {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [templateCode, setTemplateCode] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [nextContact, setNextContact] = useState('');
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ sent: number; moved: number; failed: Array<{ number: string; reason?: string }> } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/settings/templates?kind=email&active=true')
            .then((r) => r.json())
            .then((d) => setTemplates(d.email || []))
            .catch(() => undefined);
    }, []);

    const send = async () => {
        setSending(true);
        setError(null);
        try {
            const res = await fetch('/api/orders/bulk-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    numbers,
                    templateCode: templateCode || null,
                    subject: templateCode ? null : subject,
                    body: templateCode ? null : body,
                    nextContact: nextContact || null,
                }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось отправить');
            setResult({ sent: payload.sent ?? 0, moved: payload.moved ?? 0, failed: payload.failed ?? [] });
            onDone();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-start justify-center overflow-auto bg-black/40 p-6" onClick={onClose}>
            <div className="w-full max-w-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between border-b border-gray-200 pb-2">
                    <h3 className="text-lg font-semibold text-gray-900">Письмо по {numbers.length} заказам</h3>
                    <button onClick={onClose} className="px-2 text-xl leading-none text-gray-400 hover:text-gray-900">×</button>
                </div>

                {result ? (
                    <div className="space-y-2 text-sm">
                        <p className="text-gray-900">Отправлено писем: <b>{result.sent}</b> из {numbers.length}.</p>
                        {result.moved > 0 && <p className="text-gray-700">Дата следующего контакта перенесена у {result.moved} заказов.</p>}
                        {result.failed.length > 0 && (
                            <div>
                                <p className="text-gray-700">Не ушли:</p>
                                <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                                    {result.failed.map((f) => (
                                        <li key={f.number}>№{f.number} — {f.reason || 'причина неизвестна'}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <button onClick={onClose} className="mt-2 bg-gray-900 px-4 py-2 text-sm font-semibold text-white">Закрыть</button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Шаблон письма</label>
                            <select
                                value={templateCode}
                                onChange={(e) => setTemplateCode(e.target.value)}
                                className="w-full border border-gray-300 px-2 py-1 text-sm"
                            >
                                <option value="">Свой текст на все заказы</option>
                                {templates.map((t) => (
                                    <option key={t.code} value={t.code}>
                                        {t.name}{t.mode === 'ai' ? ' — письмо под каждый заказ' : ''}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-1 text-[11px] text-gray-500">
                                Шаблон применяется к каждому заказу отдельно: подставятся его номер, клиент и состав.
                            </p>
                        </div>

                        {!templateCode && (
                            <>
                                <div>
                                    <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Тема</label>
                                    <input
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                        placeholder="О чём письмо"
                                        className="w-full border border-gray-300 px-2 py-1 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Текст</label>
                                    <textarea
                                        value={body}
                                        onChange={(e) => setBody(e.target.value)}
                                        rows={8}
                                        placeholder="Текст письма — уйдёт одинаковым по всем выбранным заказам"
                                        className="w-full border border-gray-300 px-2 py-1 text-sm"
                                    />
                                </div>
                            </>
                        )}

                        <div>
                            <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">
                                Перенести дату следующего контакта
                            </label>
                            <input
                                type="date"
                                value={nextContact}
                                onChange={(e) => setNextContact(e.target.value)}
                                className="border border-gray-300 px-2 py-1 text-sm"
                            />
                            <p className="mt-1 text-[11px] text-gray-500">
                                Дату двигаем только тем заказам, по которым письмо действительно ушло.
                            </p>
                        </div>

                        {error && <p className="bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

                        <div className="flex items-center gap-2 border-t border-gray-200 pt-3">
                            <button
                                onClick={send}
                                disabled={sending || (!templateCode && !(subject.trim() && body.trim()))}
                                className="bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300"
                            >
                                {sending ? 'Отправляем…' : `Отправить по ${numbers.length} заказам`}
                            </button>
                            <button onClick={onClose} className="border border-gray-300 px-4 py-2 text-sm text-gray-700">Отмена</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
