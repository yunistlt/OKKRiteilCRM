'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Вложения письма: список файлов, просмотр без ухода из ОКК.
 *
 * Ирина Гордеева 05.10.2026 просила видеть ТЗ прямо в письме. Решение владельца
 * того же дня: PDF и картинки открываются всплывающим окном, остальное
 * скачивается по клику.
 *
 * Почему так: Word и Excel браузер показывать не умеет. Показать их можно
 * только через внешний просмотрщик — то есть отправив документ клиента наружу,
 * — или переводя его в PDF у себя. Ни того, ни другого без отдельного решения
 * мы не делаем, поэтому такие файлы просто скачиваются.
 */
export type Attachment = { name: string; size: number | null };

/** Что браузер покажет сам. */
function viewableKind(name: string): 'pdf' | 'image' | null {
    const ext = name.toLowerCase().split('.').pop() ?? '';
    if (ext === 'pdf') return 'pdf';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
    return null;
}

const sizeLabel = (size: number | null) =>
    size ? `${Math.max(1, Math.round(size / 1024))} КБ` : null;

export default function AttachmentList({
    files,
    href,
}: {
    files: Attachment[];
    /**
     * Адрес файла по его имени. Null — письмо не привязано к заказу, и открывать
     * файл нельзя: доступ проверяется по заказу.
     */
    href: ((name: string) => string) | null;
}) {
    const [open, setOpen] = useState<{ name: string; url: string; kind: 'pdf' | 'image' } | null>(null);

    if (!files.length) return null;

    return (
        <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Прикреплённые файлы</p>
            <ul className="mt-1 space-y-0.5">
                {files.map((file) => {
                    const url = href ? href(file.name) : null;
                    const kind = viewableKind(file.name);

                    return (
                        <li key={file.name} className="flex items-baseline gap-2">
                            {url && kind ? (
                                <button
                                    type="button"
                                    onClick={() => setOpen({ name: file.name, url, kind })}
                                    className="text-left text-xs text-blue-700 hover:underline"
                                    title="Открыть в окне"
                                >
                                    📎 {file.name}
                                </button>
                            ) : url ? (
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-blue-700 hover:underline"
                                    title="Скачать: такой файл браузер показать не умеет"
                                >
                                    📎 {file.name}
                                </a>
                            ) : (
                                <span
                                    className="text-xs text-gray-600"
                                    title="Письмо не привязано к заказу — файл открывается из карточки заказа"
                                >
                                    📎 {file.name}
                                </span>
                            )}
                            {sizeLabel(file.size) && (
                                <span className="text-[11px] text-gray-400">{sizeLabel(file.size)}</span>
                            )}
                        </li>
                    );
                })}
            </ul>

            {open && createPortal(
                <div
                    className="fixed inset-0 z-[500] flex flex-col bg-black/70 p-4"
                    onClick={() => setOpen(null)}
                >
                    <div
                        className="mx-auto flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
                            <span className="truncate text-sm font-semibold text-gray-900" title={open.name}>
                                {open.name}
                            </span>
                            <div className="flex items-center gap-3">
                                <a
                                    href={open.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-semibold text-blue-700 hover:underline"
                                >
                                    Открыть отдельно
                                </a>
                                <button
                                    type="button"
                                    onClick={() => setOpen(null)}
                                    className="px-1 text-xl leading-none text-gray-400 hover:text-gray-900"
                                    title="Закрыть"
                                >
                                    ×
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto bg-gray-100">
                            {open.kind === 'image' ? (
                                <img src={open.url} alt={open.name} className="mx-auto max-h-full object-contain" />
                            ) : (
                                <iframe src={open.url} title={open.name} className="h-full w-full border-0" />
                            )}
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
