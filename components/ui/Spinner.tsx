'use client';

/**
 * Единый индикатор «идёт обработка» для кнопок и плиток.
 * Плоский, без скруглений корпуса — только сам круг (golds/GOLD_DESIGN_UX.md).
 */
export default function Spinner({ className = '' }: { className?: string }) {
    return (
        <span
            role="status"
            aria-label="Загрузка"
            className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent border-b-transparent ${className}`}
        />
    );
}
