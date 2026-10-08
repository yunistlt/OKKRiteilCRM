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
    /**
     * Открыть карточку прямо здесь, не уходя со страницы.
     *
     * Нужен в самом списке заказов: переход по ссылке перемонтирует страницу и
     * стирает фильтры — менеджер находил заказ по номеру, открывал его, а после
     * закрытия видел полный список без своего поиска (Ирина Гордеева
     * 08.10.2026: «появляется заказ и тут же сбивается весь поиск»).
     *
     * Ссылкой номер при этом остаётся: адрес виден, копируется и открывается в
     * новой вкладке — закон «номер заказа всегда ссылка» не нарушен.
     */
    onOpen?: (number: string) => void;
};

export default function OrderNumberLink({ number, className, fallback = '—', onOpen }: Props) {
    const value = number === null || number === undefined ? '' : String(number).trim();
    if (!value) return <span className="text-gray-400">{fallback}</span>;

    return (
        <Link
            href={`/orders?order=${encodeURIComponent(value)}`}
            className={className ?? 'font-semibold text-blue-700 hover:underline'}
            onClick={(event) => {
                // Щелчок с Ctrl/Cmd или колесом — человек хочет новую вкладку,
                // не мешаем.
                if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                onOpen(value);
            }}
        >
            {value}
        </Link>
    );
}
