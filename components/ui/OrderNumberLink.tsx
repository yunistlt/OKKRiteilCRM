'use client';

// Номер заказа всегда ведёт в карточку заказа — закон владельца 02.10.2026.
// Человек видит номер в любом списке (звонки, письма, планы, отчёты) и должен
// попасть в заказ одним щелчком, а не искать его поиском.
import Link from 'next/link';

type Props = {
    /** Номер заказа как его видит человек: «54932», «1038А». */
    number: string | number | null | undefined;
    className?: string;
    /** Что показать, когда номера нет. */
    fallback?: string;
};

export default function OrderNumberLink({ number, className, fallback = '—' }: Props) {
    const value = number === null || number === undefined ? '' : String(number).trim();
    if (!value) return <span className="text-gray-400">{fallback}</span>;

    return (
        <Link
            href={`/orders?order=${encodeURIComponent(value)}`}
            className={className ?? 'font-semibold text-blue-700 hover:underline'}
        >
            {value}
        </Link>
    );
}
