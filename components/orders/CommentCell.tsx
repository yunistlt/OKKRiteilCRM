'use client';

/**
 * Комментарий менеджера в списке заказов: свежая запись первой, остальное
 * раскрывается по клику.
 *
 * Евгения Матвеева 05.10.2026: «можно тут сделать, чтобы можно было
 * развернуть/свернуть комментарий менеджера, чтобы было видно последний?» До
 * этого ячейка показывала первые пять строк — а свежая запись могла лежать
 * внизу полотна на семь тысяч знаков.
 */
import { useState } from 'react';
import { parseComment } from '@/lib/own-crm/comment-entries';

export default function CommentCell({ value }: { value: string | null }) {
    const [open, setOpen] = useState(false);
    const entries = parseComment(value);

    if (!entries.length) return <span className="text-gray-400">—</span>;

    const shown = open ? entries : entries.slice(0, 1);

    return (
        <div className="space-y-1">
            {shown.map((entry, i) => (
                <div key={i}>
                    {entry.at && (
                        <div className="text-[11px] text-gray-500">
                            {new Date(entry.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                    )}
                    <div className={`whitespace-pre-line text-gray-800 ${open ? '' : 'line-clamp-3'}`}>
                        {entry.text}
                    </div>
                </div>
            ))}
            {entries.length > 1 && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                    className="text-[11px] font-semibold text-blue-700 hover:underline"
                >
                    {open ? 'свернуть' : `ещё ${entries.length - 1}`}
                </button>
            )}
        </div>
    );
}
