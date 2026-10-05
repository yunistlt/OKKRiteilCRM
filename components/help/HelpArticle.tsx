'use client';

/**
 * Инструкция на экране: шаги, выделенное важное, предупреждения.
 *
 * Решение владельца 05.10.2026: «сделай инструкцию красивую по дизайну, с
 * выделением важного, как сделано в ЦУ». Простыня текста не читается — человек
 * ищет глазами шаг, на котором остановился.
 *
 * Разметка простая, её пишут люди прямо в тексте инструкции:
 *   ## Заголовок раздела
 *   1. Шаг — строка, начинающаяся с цифры и точки
 *   !! Важно: текст — янтарная плашка
 *   ?? Подсказка: текст — синяя плашка
 *   - пункт списка
 *   **жирным** внутри строки
 */
import { Fragment, ReactNode } from 'react';

/** Жирный текст внутри строки. */
function inline(text: string): ReactNode {
    return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
            ? <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
            : <Fragment key={i}>{part}</Fragment>);
}

export default function HelpArticle({ content }: { content: string }) {
    const blocks = String(content ?? '').split(/\n{2,}/);

    return (
        <div className="max-w-3xl space-y-3">
            {blocks.map((block, index) => {
                const text = block.trim();
                if (!text) return null;

                if (text.startsWith('## ')) {
                    return (
                        <h2 key={index} className="pt-3 text-base font-bold text-gray-900">
                            {text.slice(3)}
                        </h2>
                    );
                }

                // Важно — то, из-за чего чаще всего ошибаются.
                if (text.startsWith('!! ')) {
                    return (
                        <div key={index} className="border border-amber-200 bg-amber-50 p-3 text-amber-900">
                            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-amber-600">Важно</div>
                            <div className="text-sm leading-relaxed">{inline(text.slice(3))}</div>
                        </div>
                    );
                }

                // Подсказка — то, что ускоряет работу.
                if (text.startsWith('?? ')) {
                    return (
                        <div key={index} className="border border-blue-200 bg-blue-50 p-3 text-blue-900">
                            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-600">Подсказка</div>
                            <div className="text-sm leading-relaxed">{inline(text.slice(3))}</div>
                        </div>
                    );
                }

                const step = /^(\d+)\.\s+([\s\S]+)$/.exec(text);
                if (step) {
                    const [, number, body] = step;
                    const [title, ...rest] = body.split('\n');
                    return (
                        <div key={index} className="flex gap-3 border border-gray-200 bg-white p-3">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-gray-900 text-sm font-bold text-white">
                                {number}
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-gray-900">{inline(title)}</div>
                                {rest.length > 0 && (
                                    <div className="mt-1 whitespace-pre-line text-sm leading-relaxed text-gray-700">
                                        {inline(rest.join('\n'))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }

                if (text.startsWith('- ')) {
                    return (
                        <ul key={index} className="space-y-1 pl-1">
                            {text.split('\n').map((line, i) => (
                                <li key={i} className="flex gap-2 text-sm leading-relaxed text-gray-700">
                                    <span className="text-gray-400">•</span>
                                    <span>{inline(line.replace(/^-\s*/, ''))}</span>
                                </li>
                            ))}
                        </ul>
                    );
                }

                return (
                    <p key={index} className="whitespace-pre-line text-sm leading-relaxed text-gray-700">
                        {inline(text)}
                    </p>
                );
            })}
        </div>
    );
}
