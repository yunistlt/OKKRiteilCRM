'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Фото товара в составе заказа с увеличением по наведению.
 *
 * Просьба Ирины Гордеевой 05.10.2026: «а можно при наведении курсора на картинку
 * увеличить её? В прошлом СРМ было так и было удобно — понятно, что за шкаф или
 * стеллаж». Маленькая клетка 48×48 не отличает шкаф от стеллажа, а открывать
 * карточку товара ради этого — лишний шаг.
 *
 * Увеличенное рисуем поверх страницы: строка таблицы обрезает всё, что выходит
 * за её пределы, и картинка внутри ячейки была бы срезана.
 */
export default function ItemPhoto({ src, alt }: { src: string; alt?: string }) {
    const [box, setBox] = useState<{ top: number; left: number } | null>(null);
    const ref = useRef<HTMLImageElement | null>(null);

    /** Большое фото рядом с клеткой, но не за краем окна. */
    const show = () => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;

        const size = 320;
        const gap = 12;
        // Справа, если там есть место; иначе слева от клетки.
        const left = rect.right + gap + size < window.innerWidth
            ? rect.right + gap
            : Math.max(gap, rect.left - gap - size);
        const top = Math.min(
            Math.max(gap, rect.top + rect.height / 2 - size / 2),
            window.innerHeight - size - gap,
        );
        setBox({ top, left });
    };

    return (
        <>
            <img
                ref={ref}
                src={src}
                alt={alt ?? ''}
                onMouseEnter={show}
                onMouseLeave={() => setBox(null)}
                className="h-12 w-12 cursor-zoom-in border border-gray-200 object-contain"
            />

            {box && createPortal(
                <div
                    className="pointer-events-none fixed z-[400] border border-gray-300 bg-white p-2 shadow-2xl"
                    style={{ top: box.top, left: box.left }}
                >
                    <img src={src} alt={alt ?? ''} className="h-[304px] w-[304px] object-contain" />
                </div>,
                document.body,
            )}
        </>
    );
}
