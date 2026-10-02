'use client';

import { useEffect, useState } from 'react';
import { Loader, Send } from 'lucide-react';

interface OrderReplyFormProps {
    orderNumber: string;
    onClose: () => void;
    onSent?: () => void;
}

interface ThreadState {
    to: string | null;
    /** Подпись менеджера заказа — подставляется в пустое письмо. */
    signature?: string | null;
    subjectText: string;
    hasThread: boolean;
    thread: Array<{ from: string | null; fromName: string | null; receivedAt: string | null; preview: string }>;
}

/**
 * Ответ клиенту по заказу. Почта у компании одна, поэтому письмо привязывается к заказу
 * служебным тегом в теме — его добавляет сервер, менеджеру этого видеть не нужно.
 */
export default function OrderReplyForm({ orderNumber, onClose, onSent }: OrderReplyFormProps) {
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    // Вложения: клиенту часто нужно приложить КП, счёт или чертёж.
    const [files, setFiles] = useState<File[]>([]);
    /**
     * КП и счёт собирает сервер — через браузер они больше не ходят.
     * Раньше документ скачивался сюда и уходил обратно строкой base64: вместе с
     * паспортами и сертификатами письмо упиралось в лимит запроса и падало
     * непонятной ошибкой (Ирина 02.10.2026).
     */
    const [documents, setDocuments] = useState<Array<'proposal' | 'invoice'>>([]);

    /** Отметить, что к письму нужно приложить КП или счёт по этому заказу. */
    const attachOrderDocument = (kind: 'proposal' | 'invoice') => {
        setDocuments((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
    };
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [thread, setThread] = useState<ThreadState | null>(null);
    const [templates, setTemplates] = useState<Array<{ id: string; code: string; name: string; mode?: string }>>([]);
    const [applyingTemplate, setApplyingTemplate] = useState(false);
    // Черновик: письмо часто пишут не за один присест — ждут расчёт или уходят на звонок.
    const [savingDraft, setSavingDraft] = useState(false);
    const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
    const [draftNote, setDraftNote] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/orders/${orderNumber}/email-thread`);
                const data = await res.json();
                if (cancelled) return;
                if (!res.ok) throw new Error(data.error || 'Не удалось загрузить переписку');
                setThread(data);
                setTo(data.to || '');
                setSubject(data.subjectText || `По заказу №${orderNumber}`);
                // Подпись ставим сразу: менеджер дописывает письмо над ней, как в RetailCRM.
                if (data.signature) setBody(`\n\n${data.signature}`);

                const tplRes = await fetch('/api/settings/templates?kind=email&active=true');
                const tplData = await tplRes.json();
                if (!cancelled && tplRes.ok) setTemplates(tplData.email || []);

                // Недописанное письмо возвращаем на место, вместе с тем, что
                // человек уже набрал: иначе он начинает заново.
                const draftRes = await fetch(`/api/orders/${orderNumber}/email-draft`);
                const draftData = await draftRes.json().catch(() => null);
                if (!cancelled && draftRes.ok && draftData?.draft) {
                    if (draftData.draft.to) setTo(draftData.draft.to);
                    if (draftData.draft.subject) setSubject(draftData.draft.subject);
                    if (draftData.draft.body) setBody(draftData.draft.body);
                    setDraftSavedAt(draftData.draft.savedAt || null);
                    setDraftNote(
                        (draftData.draft.attachments || []).length
                            ? `Черновик восстановлен. К нему прикладывали: ${(draftData.draft.attachments || []).join(', ')} — вложения нужно приложить заново.`
                            : 'Черновик восстановлен.',
                    );
                }
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить переписку');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [orderNumber]);


    const applyTemplate = async (code: string) => {
        if (!code) return;
        setApplyingTemplate(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderNumber}/email-template/${code}`);
            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(
                    data.details
                        || (data.error === 'ai_failed' ? 'ИИ не смог написать письмо — напишите руками.' : null)
                        || (data.error === 'template_without_prompt' ? 'У шаблона нет задания для ИИ — поправьте его в настройках.' : null)
                        || 'Шаблон не собрался',
                );
            }
            setSubject(data.subject || '');
            // Тело приходит готовым HTML — в поле показываем текстом, разметку уберём при отправке.
            // Подпись дописываем, если шаблон её не содержит: письмо без подписи не уходит.
            const templateBody = htmlToPlainText(data.html || '');
            const sign = thread?.signature;
            setBody(sign && !templateBody.includes('С уважением') ? `${templateBody}\n\n${sign}` : templateBody);
            // Письмо от ИИ читает человек: он отвечает за то, что уйдёт клиенту.
            setDraftNote(data.byAi ? 'Письмо написал ИИ по данным заказа — прочитайте и поправьте перед отправкой.' : null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Шаблон не собрался');
        } finally {
            setApplyingTemplate(false);
        }
    };

    /** Сохранить письмо, не отправляя. Вложения не храним — только их названия. */
    const saveDraft = async () => {
        setError(null);
        setSavingDraft(true);
        try {
            const res = await fetch(`/api/orders/${orderNumber}/email-draft`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: to.trim(),
                    subject: subject.trim(),
                    body,
                    attachments: files.map((f) => f.name),
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) throw new Error(data?.error || 'Черновик не сохранился');
            setDraftSavedAt(data.savedAt);
            setDraftNote('Черновик сохранён — письмо не отправлено.');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Черновик не сохранился');
        } finally {
            setSavingDraft(false);
        }
    };

    const send = async () => {
        setError(null);

        if (!to.trim() || !subject.trim() || !body.trim()) {
            setError('Заполните адресата, тему и текст письма.');
            return;
        }

        setSending(true);
        try {
            const html = body
                .split('\n')
                .map((line) => (line.trim() ? `<p>${line.replace(/</g, '&lt;')}</p>` : '<p>&nbsp;</p>'))
                .join('');

            // Вложения отправляем вместе с письмом: читаем файлы в браузере и
            // передаём содержимое строкой — отдельного хранилища для этого не нужно.
            // Файлы с компьютера всё ещё идут телом запроса — но теперь это только
            // то, что человек выбрал сам, и мы заранее предупреждаем о размере.
            const tooBig = files.reduce((sum, f) => sum + f.size, 0) > 8 * 1024 * 1024;
            if (tooBig) {
                throw new Error('Файлы с компьютера тяжелее 8 МБ — приложите их по одному или через раздел «Файлы» заказа');
            }
            const attachments = await Promise.all(files.map(async (file) => ({
                filename: file.name,
                contentType: file.type || 'application/octet-stream',
                contentBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
            })));

            const res = await fetch('/api/orders/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // force: письмо пишет человек, он и решает, сколько раз отвечать по заказу.
                // Защита от двойного клика — блокировка кнопки на время отправки.
                body: JSON.stringify({ orderNumber, to: to.trim(), subjectText: subject.trim(), html, force: true, attachments, documents }),
            });

            // Ответ не всегда JSON: при слишком тяжёлом письме сервер отвечает
            // текстом, и разбор падал технической ошибкой «Unexpected token…».
            const data = await res.json().catch(() => null);
            if (!data) {
                throw new Error(res.status === 413
                    ? 'Письмо слишком тяжёлое — уберите часть вложений и отправьте отдельным письмом'
                    : `Сервер ответил ошибкой (${res.status}) — письмо не ушло`);
            }
            if (!res.ok || !data.ok) {
                throw new Error(data.error === 'smtp_not_configured'
                    ? 'Почта не настроена на сервере — письмо не отправлено.'
                    : (data.error || 'Письмо не ушло'));
            }

            // Письмо ушло — черновик больше не нужен, иначе он всплывёт снова.
            await fetch(`/api/orders/${orderNumber}/email-draft`, { method: 'DELETE' }).catch(() => undefined);

            setDone(true);
            onSent?.();

            if (data.appendedToSent === false) {
                setError('Письмо клиенту ушло, но копия не легла в «Отправленные» — в переписке RetailCRM его может не быть.');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Письмо не ушло');
        } finally {
            setSending(false);
        }
    };

    if (loading) {
        return <div className="border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">Загружаем переписку…</div>;
    }

    if (done) {
        return (
            <div className="border border-green-600 bg-green-50 p-4">
                <p className="text-sm font-bold text-green-800">Письмо отправлено на {to}</p>
                {error && <p className="mt-1 text-xs text-amber-800">{error}</p>}
                <button onClick={onClose} className="mt-3 border border-gray-300 px-3 py-1.5 text-xs font-bold hover:bg-gray-900 hover:text-white">
                    Закрыть
                </button>
            </div>
        );
    }

    return (
        <div className="border border-gray-300 bg-gray-50 p-4">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {thread?.hasThread ? 'Ответ в переписку по заказу' : 'Первое письмо по заказу'}
                </span>
                <button onClick={onClose} className="text-xs font-bold text-gray-500 hover:text-gray-900">Отменить</button>
            </div>

            {templates.length > 0 && (
                <div className="mb-3 border border-gray-200 bg-white px-2 py-2">
                    <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">Взять шаблон</label>
                    <select
                        defaultValue=""
                        disabled={applyingTemplate}
                        onChange={(e) => applyTemplate(e.target.value)}
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                    >
                        <option value="">{applyingTemplate ? 'Подставляем…' : 'Без шаблона — напишу сам'}</option>
                        {templates.map((t) => (
                            <option key={t.id} value={t.code}>{t.name}</option>
                        ))}
                    </select>
                    <p className="mt-1 text-[11px] text-gray-500">
                        Тема и текст подставятся из шаблона, дальше правьте руками. Шаблоны с пометкой «ИИ» пишут письмо под этот заказ.
                    </p>
                </div>
            )}

            <div className="space-y-2">
                <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">Кому</label>
                    <input
                        type="email"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        placeholder="client@example.com"
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                    />
                </div>

                <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">Тема</label>
                    <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                        Номер заказа в тему подставится сам — по нему RetailCRM привяжет письмо к заказу.
                    </p>
                </div>

                <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">Текст письма</label>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={8}
                        placeholder="Здравствуйте!"
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                    />
                </div>
            </div>

            {error && <p className="mt-2 border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}

            {draftNote && (
                <p className="mt-2 border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600">
                    {draftNote}
                    {draftSavedAt && <span className="ml-1 text-gray-400">({new Date(draftSavedAt).toLocaleString('ru-RU')})</span>}
                </p>
            )}

            <div className="mt-3 flex items-center gap-3">
                {/* Документы по заказу прикладываются одной кнопкой: искать их на
                    диске незачем, они формируются из этой же карточки. */}
                <button
                    onClick={() => attachOrderDocument('proposal')}
                    className={`border px-3 py-2 text-sm font-bold ${
                        documents.includes('proposal')
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                >
                    {documents.includes('proposal') ? 'КП приложено ✓' : 'Приложить КП'}
                </button>
                <button
                    onClick={() => attachOrderDocument('invoice')}
                    className={`border px-3 py-2 text-sm font-bold ${
                        documents.includes('invoice')
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                >
                    {documents.includes('invoice') ? 'Счёт приложен ✓' : 'Приложить счёт'}
                </button>
                <label className="cursor-pointer border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100">
                    Файл с компьютера
                    <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
                    />
                </label>
                <button
                    onClick={saveDraft}
                    disabled={savingDraft || sending}
                    className="border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100 disabled:text-gray-400"
                >
                    {savingDraft ? 'Сохраняем…' : 'Сохранить черновик'}
                </button>
                <button
                    onClick={send}
                    disabled={sending}
                    className="flex items-center gap-1.5 bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
                >
                    {sending ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                    {sending ? 'Отправляем…' : 'Отправить'}
                </button>
                <span className="text-[11px] text-gray-500">Уйдёт с общего ящика компании rop@zmktlt.ru</span>
            </div>

            {files.length > 0 && (
                <div className="mt-2 border border-gray-200 bg-white p-2">
                    <p className="mb-1 text-[10px] font-black uppercase text-gray-400">Вложения</p>
                    <ul className="space-y-1">
                        {files.map((file, index) => (
                            <li key={`${file.name}-${index}`} className="flex items-center justify-between text-xs text-gray-700">
                                <span>{file.name} · {Math.round(file.size / 1024)} КБ</span>
                                <button
                                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                                    className="px-2 text-gray-400 hover:text-red-600"
                                    title="Убрать вложение"
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {thread?.thread?.length ? (
                <div className="mt-4 border-t border-gray-200 pt-3">
                    <p className="mb-2 text-[10px] font-black uppercase text-gray-400">Что было в переписке</p>
                    <ul className="space-y-2">
                        {thread.thread.map((m, i) => (
                            <li key={i} className="text-xs text-gray-600">
                                <span className="font-bold text-gray-900">{m.fromName || m.from || 'Без адреса'}</span>
                                {m.receivedAt && <span className="ml-2 text-gray-400">{new Date(m.receivedAt).toLocaleString('ru-RU')}</span>}
                                {m.preview && <p className="mt-0.5">{m.preview}</p>}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

/** Переводит HTML шаблона в текст для поля ввода: менеджер правит словами, а не разметкой. */
function htmlToPlainText(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
