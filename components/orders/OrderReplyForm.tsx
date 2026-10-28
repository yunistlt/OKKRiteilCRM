'use client';

import { uploadOrderFile } from '@/lib/orders/upload-order-file';

import { useEffect, useRef, useState } from 'react';
import { Loader, Send } from 'lucide-react';
import { stripOrderThreadTag } from '@/lib/email-subject';
import { fetchJsonRetry } from '@/lib/fetch-json';

interface OrderReplyFormProps {
    orderNumber: string;
    onClose: () => void;
    onSent?: () => void;
    /**
     * Ответ на конкретное письмо: адрес, тема и цитата приходят от него.
     * Раньше форма всегда начиналась с чистого листа, и менеджер вручную искал,
     * кому и на что отвечает (просьба Жени Матвеевой 05.10.2026).
     */
    replyTo?: { to?: string | null; subject?: string | null; quote?: string | null; cc?: string[] } | null;
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
export default function OrderReplyForm({ orderNumber, onClose, onSent, replyTo }: OrderReplyFormProps) {
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
    /**
     * Файлы заказа, выбранные руками.
     *
     * Ирина Гордеева 08.10.2026: «нет кнопки отправить договор, приходится
     * пересохранять его на комп». Договор, чертёж, паспорт — всё это уже лежит
     * в заказе, и письму достаточно назвать их по номеру.
     *
     * Выбор именно руками, а не «приложить всё»: по заказу бывает несколько
     * договоров и версий КП, и отправить клиенту не тот — дороже, чем выбрать
     * из списка (требование владельца 08.10.2026).
     */
    const [attachedFileIds, setAttachedFileIds] = useState<number[]>([]);
    const [orderFiles, setOrderFiles] = useState<Array<{ id: number; name: string; size: number | null; note: string | null }> | null>(null);
    const [filesPicker, setFilesPicker] = useState(false);
    /** Список файлов не прочитался — это не «файлов нет». */
    const [orderFilesFailed, setOrderFilesFailed] = useState(false);

    const loadOrderFiles = async () => {
        setFilesPicker((open) => !open);
        if (orderFiles !== null) return;
        try {
            const payload: any = await fetchJsonRetry(`/api/orders/${encodeURIComponent(orderNumber)}/files`);
            // Отправить письмом можно только то, что лежит у нас файлом:
            // у почтовых вложений своего номера в заказе нет.
            setOrderFiles(((payload.files || []) as any[])
                .filter((f) => f.fileId)
                .map((f) => ({ id: Number(f.fileId), name: String(f.filename), size: f.size ?? null, note: f.note ?? null })));
            setOrderFilesFailed(false);
        } catch {
            // «Файлы не прочитались» — не то же самое, что «файлов нет»
            // (Ирина Гордеева 23.10.2026 по заказу 900160).
            setOrderFiles([]);
            setOrderFilesFailed(true);
        }
    };

    /** Отметить, что к письму нужно приложить КП или счёт по этому заказу. */
    const attachOrderDocument = (kind: 'proposal' | 'invoice') => {
        setDocuments((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
    };
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    /**
     * Отмена отправки: письмо уходит не сразу, а через несколько секунд — всё
     * это время его можно вернуть (ТЗ §4, «самая дешёвая и самая нужная
     * функция»). Отправлено не то и не тому — обычная цена спешки.
     */
    const [holdLeft, setHoldLeft] = useState<number | null>(null);
    /**
     * Ключ этого письма. Рождается, когда композер открыли, и живёт до
     * успешной отправки: сервер по нему узнаёт повтор и второй раз письмо не
     * шлёт. Защита кнопкой не спасает — страницу перезагружают, запрос
     * повторяют, письмо уходит при закрытии карточки.
     */
    const clientKey = useRef<string>(makeKey());
    /** Сервер сказал, что адрес не клиента этого заказа: ждём подтверждения. */
    const [foreignWarning, setForeignWarning] = useState<string | null>(null);
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelled = useRef(false);
    /** Вложения уже выгружаются — второй раз не начинаем. */
    /**
     * Заливка файлов в заказ идёт из трёх мест: сохранение черновика,
     * подготовка во время отсчёта и сама отправка. Замок общий и хранит
     * начатую работу, а не просто флаг: иначе «Отправить» во время подготовки
     * видел files ещё непустым и заливал те же файлы второй раз — в заказе
     * появлялись пары одинаковых вложений (Андрей 14.10.2026).
     */
    const uploading = useRef<Promise<number[]> | null>(null);

    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    /**
     * Копия и скрытая копия (ТЗ §4). Копию заполняет «ответить всем», скрытую
     * — человек руками: показать письмо руководителю, не втягивая его в
     * переписку.
     */
    const [cc, setCc] = useState('');
    const [bcc, setBcc] = useState('');
    const [copyOpen, setCopyOpen] = useState(false);
    /** Файл тащат мышью на письмо — подсвечиваем, куда бросать (ТЗ §4). */
    const [dragging, setDragging] = useState(false);
    /**
     * Отложенная отправка: во сколько письмо уедет само. Пусто — сейчас.
     * Письмо уходит из очереди задач, а не из браузера: человек уйдёт домой,
     * а оно уедет вовремя.
     */
    const [sendAt, setSendAt] = useState('');
    const [laterOpen, setLaterOpen] = useState(false);
    const [scheduledNote, setScheduledNote] = useState<string | null>(null);
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
                setTo(replyTo?.to || data.to || '');
                if (replyTo?.cc?.length) {
                    setCc(replyTo.cc.join(', '));
                    setCopyOpen(true);
                }
                // Отвечаем — тема письма с «Re:», иначе обычная тема по заказу.
                // Номер заказа в тему ставит сервер — здесь только человеческая
                // часть. Поэтому чистим тему исходного письма от тега и от
                // цепочки Re:, иначе номер встал бы в тему дважды.
                const human = replyTo?.subject ? stripOrderThreadTag(replyTo.subject) : '';
                setSubject(human ? `Re: ${human}` : data.subjectText || `По заказу №${orderNumber}`);
                // Подпись ставим сразу: менеджер дописывает письмо над ней, как в RetailCRM.
                // При ответе под подписью цитируем исходное письмо.
                const quote = replyTo?.quote
                    ? `\n\n${String(replyTo.quote).split('\n').map((line) => `> ${line}`).join('\n')}`
                    : '';
                if (data.signature || quote) setBody(`\n\n${data.signature ?? ''}${quote}`);

                const tplRes = await fetch('/api/settings/templates?kind=email&active=true');
                const tplData = await tplRes.json();
                if (!cancelled && tplRes.ok) setTemplates(tplData.email || []);

                // Недописанное письмо возвращаем на место, вместе с тем, что
                // человек уже набрал: иначе он начинает заново.
                // Отвечаем на конкретное письмо — черновик не подставляем: он
                // перебил бы адрес, тему и цитату чужим недописанным текстом.
                const draftRes = replyTo
                    ? null
                    : await fetch(`/api/orders/${orderNumber}/email-draft`);
                const draftData = draftRes ? await draftRes.json().catch(() => null) : null;
                if (!cancelled && draftRes?.ok && draftData?.draft) {
                    if (draftData.draft.to) setTo(draftData.draft.to);
                    if (draftData.draft.subject) setSubject(draftData.draft.subject);
                    if (draftData.draft.body) setBody(draftData.draft.body);
                    setDraftSavedAt(draftData.draft.savedAt || null);
                    if (draftData.draft.orderFileIds?.length) setAttachedFileIds(draftData.draft.orderFileIds.map(Number));
                    if (draftData.draft.documents?.length) setDocuments(draftData.draft.documents);
                    const kept = (draftData.draft.orderFileIds || []).length + (draftData.draft.documents || []).length;
                    const oldNames = (draftData.draft.attachments || []);
                    setDraftNote(
                        kept
                            ? `Черновик восстановлен вместе с вложениями (${kept}).`
                            : oldNames.length
                                // Старые черновики помнили только названия — у них вложений нет.
                                ? `Черновик восстановлен. К нему прикладывали: ${oldNames.join(', ')} — эти файлы приложите заново.`
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
    }, [orderNumber, replyTo]);


    const applyTemplate = async (code: string) => {
        if (!code) return;
        setApplyingTemplate(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderNumber}/email-template/${code}`);
            const data = await res.json();
            // Адрес не числится за клиентом заказа: показываем и ждём решения.
            if (res.status === 409 && data?.error === 'foreign_recipient') {
                setForeignWarning(data.message || 'Адрес не числится за клиентом этого заказа.');
                return;
            }

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
            /**
             * Файлы с компьютера кладём в заказ прямо сейчас и запоминаем их
             * номерами. Раньше черновик держал только названия, и, вернувшись
             * к письму, человек читал «вложения нужно приложить заново» —
             * приложенное один раз отваливаться не должно (решение владельца
             * 12.10.2026).
             */
            const keptIds = await uploadPending();

            if (files.length) {
                void loadOrderFiles();
            }

            const res = await fetch(`/api/orders/${orderNumber}/email-draft`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: to.trim(),
                    subject: subject.trim(),
                    body,
                    attachments: files.map((f) => f.name),
                    orderFileIds: keptIds,
                    documents,
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

    /** Сколько секунд письмо ждёт перед отправкой. */
    /**
     * Сколько секунд письмо можно вернуть.
     *
     * Было восемь, и Ирина Гордеева 12.10.2026: «можно убрать это время
     * ожидания? потом идёт отправка — ещё ожидание». Решение владельца —
     * три секунды: спохватиться успеваешь, ждать не успеваешь. Тяжёлую часть,
     * выгрузку вложений, делаем прямо во время отсчёта, чтобы после него
     * оставалась только сама отправка.
     */
    const HOLD_SECONDS = 3;

    /** Нажали «Отправить»: запускаем обратный отсчёт, а не отправку. */
    const startSend = () => {
        setError(null);
        if (!to.trim() || !subject.trim() || !body.trim()) {
            setError('Заполните адресата, тему и текст письма.');
            return;
        }

        cancelled.current = false;
        setHoldLeft(HOLD_SECONDS);
        // Пока человек может передумать, молча готовим вложения.
        void prepareAttachments();
    };

    /**
     * Выгрузить файлы с компьютера в заказ заранее.
     *
     * Это самая долгая часть отправки: паспорт на пять мегабайт едет секунды.
     * Делаем её во время отсчёта — к моменту отправки остаётся лёгкий запрос.
     * Ошибку здесь не показываем: если что-то не выгрузилось, отправка
     * попробует ещё раз и скажет сама.
     */
    const uploadPending = (): Promise<number[]> => {
        // Кто-то уже везёт эти файлы — ждём его, а не везём второй раз.
        if (uploading.current) return uploading.current;
        if (!files.length) return Promise.resolve([...attachedFileIds]);

        const pending = files;
        const work = (async () => {
            const ids = [...attachedFileIds];
            for (const file of pending) {
                const uploaded = await uploadOrderFile(orderNumber, file);
                ids.push(Number(uploaded.id));
            }

            // Файлы уехали в заказ: в списке «с компьютера» им больше не место.
            setAttachedFileIds(ids);
            setFiles([]);
            return ids;
        })();

        uploading.current = work;
        void work.catch(() => {}).finally(() => { uploading.current = null; });
        return work;
    };

    /**
     * Выгрузить файлы с компьютера в заказ заранее.
     *
     * Это самая долгая часть отправки: паспорт на пять мегабайт едет секунды.
     * Делаем её во время отсчёта — к моменту отправки остаётся лёгкий запрос.
     * Ошибку здесь не показываем: если что-то не выгрузилось, отправка
     * попробует ещё раз и скажет сама.
     */
    const prepareAttachments = async () => {
        try {
            await uploadPending();
        } catch {
            // Молча: отправка повторит и объяснит человеку сама.
        }
    };

    /** Передумали — письмо остаётся в композере, как его и писали. */
    const cancelSend = () => {
        cancelled.current = true;
        if (holdTimer.current) clearTimeout(holdTimer.current);
        setHoldLeft(null);
    };

    useEffect(() => {
        if (holdLeft === null) return;
        if (holdLeft <= 0) {
            setHoldLeft(null);
            if (!cancelled.current) void send();
            return;
        }
        holdTimer.current = setTimeout(() => setHoldLeft((left) => (left === null ? null : left - 1)), 1000);
        return () => { if (holdTimer.current) clearTimeout(holdTimer.current); };
        // send меняется на каждый ввод — в зависимости его не берём намеренно.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [holdLeft]);

    /**
     * Карточку закрыли, пока шёл обратный отсчёт.
     *
     * Письмо человек уже отправил — терять его нельзя. Досылаем немедленно,
     * с `keepalive`, чтобы запрос пережил закрытие вкладки. Повтора не
     * будет: у письма свой ключ.
     */
    useEffect(() => {
        const flush = () => {
            if (holdLeft === null || cancelled.current) return;
            cancelled.current = true;
            void send(true);
        };

        window.addEventListener('pagehide', flush);
        return () => {
            window.removeEventListener('pagehide', flush);
            flush();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [holdLeft]);

    const send = async (immediate = false) => {
        setError(null);

        setSending(true);
        try {
            const html = body
                .split('\n')
                .map((line) => (line.trim() ? `<p>${line.replace(/</g, '&lt;')}</p>` : '<p>&nbsp;</p>'))
                .join('');

            /**
             * Файлы с компьютера сперва кладём в заказ, а письму передаём только
             * их номера.
             *
             * Раньше содержимое шло прямо в теле письма строкой base64: паспорт
             * и сертификат на пять мегабайт превращались в семь, запрос не
             * проходил, и менеджер видел «Unexpected token R» (Ирина 02.10.2026).
             * Попутно файл остаётся в разделе «Файлы» заказа — его видно всем,
             * кто работает с заказом.
             */
            const orderFileIds: number[] = await uploadPending();

            const res = await fetch('/api/orders/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Карточку закрывают — запрос должен пережить закрытие вкладки.
                keepalive: immediate,
                // force: письмо пишет человек, он и решает, сколько раз отвечать по
                // заказу. От повтора защищает clientKey — он же на сервере.
                body: JSON.stringify({
                    orderNumber,
                    to: to.trim(),
                    subjectText: subject.trim(),
                    html,
                    force: true,
                    clientKey: clientKey.current,
                    ...(sendAt ? { sendAt: new Date(sendAt).toISOString() } : {}),
                    ...(addressList(cc).length ? { cc: addressList(cc) } : {}),
                    ...(addressList(bcc).length ? { bcc: addressList(bcc) } : {}),
                    documents,
                    orderFileIds,
                    // Человек уже увидел предупреждение про чужой адрес и всё равно шлёт.
                    allowForeignRecipient: Boolean(foreignWarning),
                }),
            });

            // Ответ не всегда JSON: при слишком тяжёлом письме сервер отвечает
            // текстом, и разбор падал технической ошибкой «Unexpected token…».
            const data = await res.json().catch(() => null);
            if (!data) {
                throw new Error(res.status === 413
                    ? 'Письмо слишком тяжёлое — уберите часть вложений и отправьте отдельным письмом'
                    : `Сервер ответил ошибкой (${res.status}) — письмо не ушло`);
            }
            /**
             * Адрес не числится за клиентом заказа — это развилка для человека,
             * а не ошибка: показываем предупреждение и ждём второго нажатия.
             * Раньше в поле ошибки стоял код `foreign_recipient` — человеку он
             * не говорит ничего (жалоба Евгении Матвеевой 12.10.2026).
             */
            if (res.status === 409 && data.error === 'foreign_recipient') {
                setForeignWarning(data.message || 'Адрес не числится за клиентом этого заказа.');
                return;
            }

            if (!res.ok || !data.ok) {
                throw new Error(humanError(data, res.status));
            }

            // Письмо ушло — черновик больше не нужен, иначе он всплывёт снова.
            await fetch(`/api/orders/${orderNumber}/email-draft`, { method: 'DELETE' }).catch(() => undefined);

            if (data.scheduled || data.queuedAfterFailure) {
                setError(null);
                setScheduledNote(data.message || 'Письмо поставлено в очередь и уйдёт в назначенное время.');
            }
            setDone(true);
            // Письмо ушло — следующее будет со своим ключом.
            clientKey.current = makeKey();
            onSent?.();

            // Копия в «Отправленные» уезжает фоном — это нормальный путь, а не
            // сбой: ругаемся только когда её не взяли ни фоном, ни сразу.
            if (data.appendedToSent === false && data.appendQueued !== true) {
                setError('Письмо клиенту ушло, но копия не легла в «Отправленные» — в почтовом ящике его не будет видно.');
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

    /**
     * Вложения перетаскиванием.
     *
     * Файл из переписки в мессенджере или с рабочего стола тащат мышью — это
     * привычнее, чем «Файл с компьютера» и окно выбора. Падает в тот же
     * список, что и выбранное кнопкой: дальше оно одинаково уедет в файлы
     * заказа и приложится к письму.
     */
    const onDrop = (event: React.DragEvent) => {
        event.preventDefault();
        setDragging(false);
        const dropped = Array.from(event.dataTransfer?.files ?? []);
        if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
    };

    return (
        <div
            className={`border bg-gray-50 p-4 ${dragging ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}
            onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
            onDragLeave={(e) => {
                // Уход на дочерний элемент — не уход с письма.
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDragging(false);
            }}
            onDrop={onDrop}
        >
            {dragging && (
                <p className="mb-2 border border-dashed border-blue-500 bg-white px-2 py-3 text-center text-sm font-semibold text-blue-700">
                    Бросьте файлы сюда — приложим к письму
                </p>
            )}
        <div className="contents">
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
                    {!copyOpen && (
                        <button
                            type="button"
                            onClick={() => setCopyOpen(true)}
                            className="mt-1 text-[11px] font-semibold text-blue-700 hover:underline"
                        >
                            Добавить копию
                        </button>
                    )}
                </div>

                {/* Копия и скрытая копия. Открываются по надобности: обычное
                    письмо идёт одному человеку, и два пустых поля над каждым
                    ответом только мешают. */}
                {copyOpen && (
                    <>
                        <div>
                            <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">
                                Копия · её видят все получатели
                            </label>
                            <input
                                type="text"
                                value={cc}
                                onChange={(e) => setCc(e.target.value)}
                                placeholder="бухгалтер@example.com, начальник@example.com"
                                className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">
                                Скрытая копия · получателям не видна
                            </label>
                            <input
                                type="text"
                                value={bcc}
                                onChange={(e) => setBcc(e.target.value)}
                                placeholder="руководитель@zmktlt.ru"
                                className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                            />
                        </div>
                    </>
                )}

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
                {/* Файлы заказа: договор, чертежи, паспорта — выбираем галочками. */}
                <button
                    onClick={loadOrderFiles}
                    className={`border px-3 py-2 text-sm font-bold ${
                        attachedFileIds.length
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                >
                    {attachedFileIds.length ? `Файлы заказа: ${attachedFileIds.length} ✓` : 'Файлы заказа'}
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
                {foreignWarning && (
                    <span className="order-1 w-full border border-amber-500 bg-amber-50 px-2 py-1 text-[12px] text-amber-900">
                        {foreignWarning} Нажмите «Отправить» ещё раз, если всё верно.
                    </span>
                )}
                {/* Отложенная отправка: кнопкой, чтобы поле времени не висело
                    над каждым обычным письмом. */}
                {!laterOpen ? (
                    <button
                        type="button"
                        onClick={() => setLaterOpen(true)}
                        className="border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100"
                    >
                        Отправить позже
                    </button>
                ) : (
                    <span className="flex items-center gap-2">
                        <input
                            type="datetime-local"
                            value={sendAt}
                            onChange={(e) => setSendAt(e.target.value)}
                            className="border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                        />
                        <button
                            type="button"
                            onClick={() => { setSendAt(''); setLaterOpen(false); }}
                            className="text-[11px] font-semibold text-gray-500 hover:underline"
                        >
                            отправить сразу
                        </button>
                    </span>
                )}
                {scheduledNote && (
                    <span className="order-1 w-full border border-blue-500 bg-blue-50 px-2 py-1 text-[12px] text-blue-900">
                        {scheduledNote}
                    </span>
                )}
                {holdLeft === null ? (
                    <button
                        onClick={startSend}
                        disabled={sending}
                        className="flex items-center gap-1.5 bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
                    >
                        {sending ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                        {sending ? 'Отправляем…' : sendAt ? 'Поставить в очередь' : 'Отправить'}
                    </button>
                ) : (
                    /* Письмо уже уходит — эти секунды даны на «ой, не то».
                       Говорим именно так: раньше кнопка читалась как «ждите»
                       (Ирина Гордеева 12.10.2026). */
                    <button
                        onClick={cancelSend}
                        className="flex items-center gap-1.5 border border-amber-600 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100"
                        title="Письмо уйдёт само через несколько секунд. Нажмите, если передумали."
                    >
                        Уходит… вернуть? · {holdLeft}
                    </button>
                )}
                <span className="text-[11px] text-gray-500">Уйдёт с общего ящика компании rop@zmktlt.ru</span>
            </div>

            {filesPicker && (
                <div className="mt-2 border border-gray-300 bg-white p-2">
                    <p className="mb-1 text-[10px] font-black uppercase text-gray-400">Что приложить из заказа</p>
                    {orderFiles === null && <p className="text-xs text-gray-500">Смотрим файлы заказа…</p>}
                    {orderFiles !== null && !orderFiles.length && (
                        <p className="text-xs text-gray-500">
                            {orderFilesFailed
                                ? 'Файлы заказа не прочитались — это сбой, а не пустой заказ. Закройте и откройте список ещё раз.'
                                : 'В заказе нет файлов — приложите с компьютера.'}
                        </p>
                    )}
                    <ul className="max-h-48 space-y-1 overflow-y-auto">
                        {(orderFiles ?? []).map((file) => (
                            <li key={file.id}>
                                <label className="flex cursor-pointer items-baseline gap-2 text-[13px]">
                                    <input
                                        type="checkbox"
                                        checked={attachedFileIds.includes(file.id)}
                                        onChange={() => setAttachedFileIds((prev) => (
                                            prev.includes(file.id) ? prev.filter((id) => id !== file.id) : [...prev, file.id]
                                        ))}
                                    />
                                    <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
                                    {file.note && <span className="shrink-0 text-[11px] text-gray-400">{file.note}</span>}
                                    <span className="shrink-0 text-[11px] text-gray-400">
                                        {file.size ? `${Math.round(file.size / 1024)} КБ` : ''}
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {(files.length > 0 || documents.length > 0 || attachedFileIds.length > 0) && (
                <div className="mt-2 border border-gray-200 bg-white p-2">
                    <p className="mb-1 text-[10px] font-black uppercase text-gray-400">Вложения</p>
                    <ul className="space-y-1">
                        {/* Документы заказа — в том же списке, что и файлы с диска.
                            Раньше о них говорила только надпись на кнопке, и человек
                            не видел, приложилось ли: «КП не прикрепляет к письму.
                            Получается нужно сохранять на комп и добавлять файлом»
                            (Ирина Гордеева 05.10.2026). Сам файл собирается при
                            отправке — из этого же заказа, поэтому размер неизвестен. */}
                        {documents.map((kind) => (
                            <li key={kind} className="flex items-center justify-between text-xs text-gray-700">
                                <span>
                                    {kind === 'proposal' ? `КП №${orderNumber}.pdf` : `Счёт №${orderNumber}.pdf`}
                                    <span className="ml-2 text-gray-400">соберётся при отправке</span>
                                </span>
                                <button
                                    onClick={() => attachOrderDocument(kind)}
                                    className="px-2 text-gray-400 hover:text-red-600"
                                    title="Убрать документ"
                                >
                                    ×
                                </button>
                            </li>
                        ))}
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
        </div>
    );
}

/** Переводит HTML шаблона в текст для поля ввода: менеджер правит словами, а не разметкой. */
/** Адреса из строки: через запятую, точку с запятой или пробел. */
function addressList(value: string): string[] {
    return Array.from(new Set(
        String(value ?? '')
            .split(/[,;\s]+/)
            .map((item) => item.trim().toLowerCase())
            .filter((item) => item.includes('@')),
    ));
}

/**
 * Ответ сервера человеческим языком.
 *
 * Сервер отвечает кодом (`smtp_not_configured`, `foreign_recipient`) и
 * отдельным пояснением. Показывать код нельзя: менеджер видит
 * «ETIMEDOUT 77.88.21.158:465» или «foreign_recipient» и идёт к разработчику
 * вместо того, чтобы понять, что делать (жалоба 12.10.2026).
 */
function humanError(data: any, status: number): string {
    const code = String(data?.error ?? '');
    const text = String(data?.message ?? '').trim();

    if (code === 'smtp_not_configured') return 'Почта не настроена на сервере — письмо не отправлено.';
    if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket close/i.test(code)) {
        return 'Почтовый сервер не отвечает — письмо не ушло. Нажмите «Отправить» ещё раз через минуту; '
            + 'если повторится, скажите мне: это сбой почты, а не ваша ошибка.';
    }
    if (status === 413) return 'Письмо слишком тяжёлое — уберите часть вложений и отправьте отдельным письмом.';

    // Понятное пояснение от сервера лучше кода; кода человеку не показываем.
    if (text) return text;
    if (code && /^[a-z_]+$/.test(code)) return `Письмо не ушло: сбой на сервере (${code}). Скажите мне — разберусь.`;
    return code || 'Письмо не ушло';
}

/** Ключ письма: одно нажатие «Отправить» — один ключ. */
function makeKey(): string {
    const random = globalThis.crypto?.randomUUID?.();
    return random ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
