import { Suspense } from 'react';
import OrdersClient from './OrdersClient';

export const dynamic = 'force-dynamic';

export default function OrdersPage() {
    // Список читает адресную строку (?order=...), поэтому ждём её в Suspense.
    return (
        <Suspense fallback={<p className="px-6 py-8 text-sm text-gray-500">Загружаем заказы…</p>}>
            <OrdersClient />
        </Suspense>
    );
}
