'use client';

import { createPortal } from 'react-dom';

/**
 * Окно «заказ в производстве, а файлов для цеха нет».
 *
 * Доработка №85, решение владельца 23.11.2026: напомнить менеджеру приложить
 * файлы, важные для производства. Цех забирает файлы заказа с отметкой «для
 * производства» в любой момент, поэтому приложить их после передачи не поздно.
 * Когда показывать — решает сервер (`lib/own-crm/production-files-reminder.ts`).
 */
export default function ProductionFilesReminder({
    orderNumber,
    onAttach,
    onLater,
}: {
    orderNumber: string;
    /** Перейти во вкладку «Для производства». */
    onAttach: () => void;
    onLater: () => void;
}) {
    return createPortal(
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4" onClick={onLater}>
            <div
                role="alertdialog"
                aria-labelledby="production-files-reminder-title"
                className="w-full max-w-md border border-gray-300 bg-white"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
                    <h3 id="production-files-reminder-title" className="text-sm font-semibold text-gray-900">
                        Заказ №{orderNumber} передан в производство без файлов
                    </h3>
                </div>
                <div className="space-y-2 px-4 py-3 text-sm text-gray-800">
                    <p>В цех не отправлено ни одного файла.</p>
                    <p>
                        Приложите файлы, важные для производства: ТЗ заказчика, чертежи,
                        спецификацию, паспорт. Цех заберёт их и после передачи заказа.
                    </p>
                </div>
                <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
                    <button
                        type="button"
                        onClick={onLater}
                        className="border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                    >
                        Позже
                    </button>
                    <button
                        type="button"
                        onClick={onAttach}
                        className="bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
                    >
                        Приложить файлы
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
