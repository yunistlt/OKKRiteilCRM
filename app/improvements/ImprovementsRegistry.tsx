'use client';

/**
 * Реестр доработок.
 *
 * Задание владельца 15.10.2026: «сделать реестр доработок, в левом меню
 * отдельную вкладку ДОРАБОТКИ. Нужно, чтобы девочки туда писали все доработки,
 * я буду его смотреть и после выполнения ставить отметку выполнено».
 *
 * Поэтому экран устроен просто: сверху форма на одно поле, под ней открытые
 * доработки, а выполненные свёрнуты внизу отдельным списком. Раздел и заказ —
 * необязательные: чем проще форма, тем чаще в неё пишут.
 */
import { type ClipboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import { NAV_GROUPS } from '@/lib/nav';

type Improvement = {
    id: number;
    text: string;
    section: string | null;
    orderNumber: string | null;
    screenshotName: string | null;
    screenshotUrl: string | null;
    author: string;
    createdAt: string;
    doneAt: string | null;
    doneBy: string | null;
};

/**
 * Разделы для выбора — из меню приложения: названия разделов живут в
 * `lib/nav.ts`, и второй их копии здесь не заводим (ЗАКОН «один источник
 * правды»).
 */
const SECTIONS = NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ href: item.href, name: item.name, group: group.title })));

function sectionName(href: string | null): string | null {
    if (!href) return null;
    return SECTIONS.find((section) => section.href === href)?.name ?? href;
}

function when(value: string): string {
    return new Date(value).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

export default function ImprovementsRegistry() {
    const [open, setOpen] = useState<Improvement[]>([]);
    const [done, setDone] = useState<Improvement[]>([]);
    const [canClose, setCanClose] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [text, setText] = useState('');
    const [section, setSection] = useState('');
    const [orderNumber, setOrderNumber] = useState('');
    const [sending, setSending] = useState(false);
    const [showDone, setShowDone] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    /**
     * Скриншот: один на доработку, откуда бы он ни пришёл — из буфера или
     * файлом. Владелец 15.10.2026: «а то файлом это неудобно».
     */
    const [shot, setShot] = useState<File | null>(null);
    const [shotPreview, setShotPreview] = useState<string | null>(null);

    const attach = useCallback((file: File | null) => {
        setShot(file);
        setShotPreview((current) => {
            if (current) URL.revokeObjectURL(current);
            return file ? URL.createObjectURL(file) : null;
        });
    }, []);

    /**
     * Картинка из буфера прямо в поле: Cmd+V после снимка экрана.
     *
     * Браузер кладёт её в `clipboardData` без имени файла («image.png»), и
     * отличить её от скопированного текста можно только по типу.
     */
    const pasteShot = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const image = Array.from(event.clipboardData?.items ?? [])
            .find((item) => item.kind === 'file' && item.type.startsWith('image/'));
        if (!image) return;

        const file = image.getAsFile();
        if (!file) return;

        // Текст из буфера не трогаем — вставляем только картинку.
        event.preventDefault();
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        attach(new File([file], file.name || `screenshot-${stamp}.png`, { type: file.type || 'image/png' }));
        if (fileInput.current) fileInput.current.value = '';
    };

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/improvements');
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Реестр не прочитался');
            setOpen(payload.open ?? []);
            setDone(payload.done ?? []);
            setCanClose(Boolean(payload.canClose));
            setError(null);
        } catch (e: any) {
            setError(e.message || 'Реестр не прочитался');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const send = async () => {
        if (!text.trim() || sending) return;
        setSending(true);
        setError(null);
        try {
            const form = new FormData();
            form.set('text', text.trim());
            if (section) form.set('section', section);
            if (orderNumber.trim()) form.set('orderNumber', orderNumber.trim());
            if (shot) form.set('screenshot', shot);

            const res = await fetch('/api/improvements', { method: 'POST', body: form });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Доработка не записалась');

            setText('');
            setSection('');
            setOrderNumber('');
            attach(null);
            if (fileInput.current) fileInput.current.value = '';
            await load();
        } catch (e: any) {
            setError(e.message || 'Доработка не записалась');
        } finally {
            setSending(false);
        }
    };

    const mark = async (id: number, value: boolean) => {
        try {
            const res = await fetch('/api/improvements', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, done: value }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Отметка не поставилась');
            await load();
        } catch (e: any) {
            setError(e.message || 'Отметка не поставилась');
        }
    };

    const card = (row: Improvement, closed: boolean) => (
        <div key={row.id} className={`border border-gray-200 bg-white px-4 py-3 ${closed ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className={`whitespace-pre-wrap text-sm text-gray-900 ${closed ? 'line-through' : ''}`}>
                        {row.text}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span>{row.author}</span>
                        <span>{when(row.createdAt)}</span>
                        {row.section && <span className="text-gray-700">Раздел: {sectionName(row.section)}</span>}
                        {/* Номер заказа всегда ссылка в карточку (ЗАКОН 02.10.2026). */}
                        {row.orderNumber && <span>Заказ <OrderNumberLink number={row.orderNumber} /></span>}
                        {row.screenshotUrl && (
                            <a href={row.screenshotUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                                {row.screenshotName || 'Скриншот'}
                            </a>
                        )}
                        {closed && row.doneAt && (
                            <span className="text-green-700">
                                Выполнено {when(row.doneAt)}{row.doneBy ? ` · ${row.doneBy}` : ''}
                            </span>
                        )}
                    </div>
                </div>

                {canClose && (
                    <button
                        type="button"
                        onClick={() => void mark(row.id, !closed)}
                        className={closed
                            ? 'shrink-0 border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100'
                            : 'shrink-0 border border-green-700 px-3 py-1 text-xs font-semibold text-green-700 hover:bg-green-700 hover:text-white'}
                    >
                        {closed ? 'Вернуть в работу' : 'Выполнено'}
                    </button>
                )}
            </div>
        </div>
    );

    return (
        <div className="p-6">
            <div className="mb-4">
                <h1 className="text-xl font-black uppercase tracking-wide text-gray-900">Доработки</h1>
                <p className="mt-1 text-sm text-gray-600">
                    Что в системе неудобно или чего не хватает. Пишите своими словами — реестр видят все,
                    отметку «выполнено» ставит владелец.
                </p>
            </div>

            {error && (
                <div className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            )}

            <div className="mb-6 border border-gray-300 bg-white p-4">
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onPaste={pasteShot}
                    rows={3}
                    placeholder="Что доработать? Например: в списке звонков не видно, по какому заказу звонили. Скриншот можно вставить сюда же — Cmd+V."
                    className="w-full border border-gray-300 px-3 py-2 text-sm"
                />

                {/* Вставленный скриншот виден сразу: иначе непонятно,
                    прилетела картинка или нет. */}
                {shotPreview && (
                    <div className="mt-2 flex items-center gap-2 border border-gray-200 bg-gray-50 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={shotPreview} alt="Скриншот" className="max-h-24 border border-gray-300" />
                        <div className="text-xs text-gray-600">
                            <div className="font-semibold text-gray-900">{shot?.name}</div>
                            <div>{Math.round((shot?.size ?? 0) / 1024)} КБ</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => { attach(null); if (fileInput.current) fileInput.current.value = ''; }}
                            className="ml-auto border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                        >
                            Убрать
                        </button>
                    </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                        value={section}
                        onChange={(e) => setSection(e.target.value)}
                        className="border border-gray-300 px-2 py-1.5 text-sm"
                    >
                        <option value="">Раздел — не указан</option>
                        {SECTIONS.map((item) => (
                            <option key={item.href} value={item.href}>{item.group} · {item.name}</option>
                        ))}
                    </select>
                    <input
                        value={orderNumber}
                        onChange={(e) => setOrderNumber(e.target.value)}
                        placeholder="Номер заказа"
                        className="w-40 border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/*"
                        onChange={(e) => attach(e.target.files?.[0] ?? null)}
                        className="text-xs text-gray-600 file:mr-2 file:border file:border-gray-300 file:bg-white file:px-2 file:py-1 file:text-xs"
                    />
                    <button
                        type="button"
                        onClick={() => void send()}
                        disabled={!text.trim() || sending}
                        className="ml-auto border border-gray-900 bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:border-gray-300 disabled:bg-gray-300"
                    >
                        {sending ? 'Записываю…' : 'Записать доработку'}
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="text-sm text-gray-500">Читаю реестр…</div>
            ) : (
                <>
                    <div className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500">
                        В работе: {open.length}
                    </div>
                    <div className="flex flex-col gap-2">
                        {open.length === 0
                            ? <div className="border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
                                Невыполненных доработок нет.
                            </div>
                            : open.map((row) => card(row, false))}
                    </div>

                    {done.length > 0 && (
                        <div className="mt-6">
                            <button
                                type="button"
                                onClick={() => setShowDone((value) => !value)}
                                className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-gray-900"
                            >
                                Выполненные: {done.length} {showDone ? '▾' : '▸'}
                            </button>
                            {showDone && (
                                <div className="flex flex-col gap-2">{done.map((row) => card(row, true))}</div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
