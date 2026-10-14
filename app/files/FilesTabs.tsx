'use client';

// Два разных источника в одном разделе, и это сделано нарочно.
//
// Файлы заказов лежат у нас, документы на продукцию — в ЦехУспехе, и копии их
// у нас нет. Человеку же нужен «файл», а не рассказ о том, где какая база,
// поэтому он остаётся в разделе «Файлы» и просто переключает, что ищет.
import { useState } from 'react';
import FilesRegistry from './FilesRegistry';
import ProductDocs from './ProductDocs';

type Tab = 'orders' | 'product';

export default function FilesTabs() {
    const [tab, setTab] = useState<Tab>('orders');

    const tabs = (
        <div className="flex items-center gap-1">
            {([
                { key: 'orders' as const, title: 'Файлы заказов' },
                { key: 'product' as const, title: 'Паспорта и инструкции' },
            ]).map((item) => (
                <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    className={`px-2 py-1 text-xs font-semibold ${
                        tab === item.key
                            ? 'bg-gray-900 text-white'
                            : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                >
                    {item.title}
                </button>
            ))}
        </div>
    );

    return tab === 'orders' ? <FilesRegistry tabs={tabs} /> : <ProductDocs tabs={tabs} />;
}
