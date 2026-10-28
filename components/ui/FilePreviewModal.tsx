'use client';

/**
 * Просмотр файла заказа во всплывающем окне.
 *
 * Раньше файл открывался в соседней вкладке: человек уходил из карточки заказа,
 * а вернувшись, искал её заново среди десятка открытых (требование владельца
 * 28.10.2026 — «надо открыть всплывающим окном»). Теперь счёт или чертёж видно
 * поверх карточки, и закрытие возвращает ровно туда, откуда пришёл.
 *
 * Что показываем: картинку — как картинку, PDF и текст — встроенным окном
 * браузера. Остальное (таблицы, документы Word) браузер показать не умеет —
 * честно говорим об этом и даём скачать.
 */
import { useEffect } from 'react';
import { isViewableInBrowser } from '@/lib/file-type';

export type PreviewFile = {
    /** Адрес, по которому файл отдаётся. */
    href: string;
    name: string;
    contentType?: string | null;
    /** Чем подписан источник — показываем в шапке окна. */
    origin?: string | null;
};

export default function FilePreviewModal({ file, onClose }: { file: PreviewFile | null; onClose: () => void }) {
    useEffect(() => {
        if (!file) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [file, onClose]);

    if (!file) return null;

    const type = String(file.contentType ?? '').toLowerCase();
    const isImage = type.startsWith('image/');
    // SVG показываем ссылкой на скачивание: чужой SVG — это исполняемая
    // разметка, и встраивать её в нашу страницу нельзя.
    const canShow = isViewableInBrowser(type) && type !== 'image/svg+xml';

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
            onClick={onClose}
        >
            <div
                className="flex h-full w-full max-w-5xl flex-col border border-gray-300 bg-white"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-900" title={file.name}>{file.name}</p>
                        {file.origin && <p className="truncate text-[11px] text-gray-500">{file.origin}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <a
                            href={file.href}
                            download={file.name}
                            className="border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                        >
                            Скачать
                        </a>
                        {/* Соседняя вкладка остаётся под рукой: крупный чертёж
                            удобнее смотреть на весь экран. */}
                        <a
                            href={file.href}
                            target="_blank"
                            rel="noreferrer"
                            className="border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                        >
                            В новой вкладке
                        </a>
                        <button
                            onClick={onClose}
                            className="border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                        >
                            Закрыть
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-auto bg-gray-100">
                    {canShow ? (
                        isImage ? (
                            <div className="flex h-full items-center justify-center p-4">
                                {/* Обычный img: размеры чужого файла заранее неизвестны. */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={file.href} alt={file.name} className="max-h-full max-w-full object-contain" />
                            </div>
                        ) : (
                            <iframe src={file.href} title={file.name} className="h-full w-full border-0 bg-white" />
                        )
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                            <p className="text-sm text-gray-700">Такой файл браузер показать не умеет.</p>
                            <a
                                href={file.href}
                                download={file.name}
                                className="border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-gray-100"
                            >
                                Скачать и открыть у себя
                            </a>
                            <p className="text-[11px] text-gray-500">Описание файла и источник — в шапке окна.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
