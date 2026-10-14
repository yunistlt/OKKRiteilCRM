'use client';

// Паспорта и инструкции на продукцию. Лежат в базе ЦехУспеха и читаются оттуда
// живьём — своей копии у нас нет намеренно (lib/product-docs/search.ts).
//
// Поэтому экран устроен иначе, чем реестр файлов заказов: не список «всего», а
// поиск. Список целиком здесь был бы запросом всей чужой боевой базы на каждое
// открытие раздела.
import { useCallback, useEffect, useState, type ReactNode } from 'react';

type Doc = {
    source: string;
    sourceTitle: string;
    fileId: number;
    name: string;
    ownerName: string | null;
    at: string | null;
    href: string;
};

type Kind = 'docs' | 'passport' | 'instruction' | 'all';

// Чертежей и DWG в тех же таблицах ЦехУспеха на порядок больше, чем паспортов,
// и в общей выдаче они забивают всё. Поэтому по умолчанию показываем документы
// для людей, а чертежи — отдельной кнопкой, для тех, кому они правда нужны.
const KINDS: { key: Kind; title: string }[] = [
    { key: 'docs', title: 'Паспорта и инструкции' },
    { key: 'passport', title: 'Только паспорта' },
    { key: 'instruction', title: 'Только инструкции' },
    { key: 'all', title: 'Все файлы, включая чертежи' },
];

function formatMoment(value: string | null) {
    if (!value) return '—';
    const date = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('ru-RU');
}

export default function ProductDocs({ tabs }: { tabs?: ReactNode }) {
    const [query, setQuery] = useState('');
    const [applied, setApplied] = useState('');
    const [kind, setKind] = useState<Kind>('docs');
    const [docs, setDocs] = useState<Doc[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const search = useCallback(async (text: string, mode: Kind) => {
        if (text.trim().length < 3) {
            setDocs([]);
            setMessage(text.trim() ? 'Введите хотя бы три буквы' : null);
            return;
        }
        setLoading(true);
        try {
            const res = await fetch(`/api/product-docs?q=${encodeURIComponent(text.trim())}&kind=${mode}`);
            const data = await res.json();
            setDocs(Array.isArray(data.docs) ? data.docs : []);
            setMessage(data.unavailable ?? data.hint ?? null);
        } catch {
            setDocs([]);
            setMessage('Не получилось спросить ЦехУспех. Повторите через минуту');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (applied) void search(applied, kind);
    }, [applied, kind, search]);

    return (
        <div className="flex h-screen flex-col bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex items-baseline gap-3">
                    <h1 className="text-xl font-bold text-gray-900">Файлы</h1>
                    {tabs}
                </div>
                <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => { e.preventDefault(); setApplied(query); }}
                >
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Модель или название: ШСО-22М, Страж, стеллаж"
                        className="w-80 border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button type="submit" className="bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700">
                        Найти
                    </button>
                </form>
            </div>

            <div className="mb-3 flex items-center gap-3">
                {KINDS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => setKind(item.key)}
                        className={`px-2 py-1 text-xs font-semibold ${
                            kind === item.key
                                ? 'bg-gray-900 text-white'
                                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                        }`}
                    >
                        {item.title}
                    </button>
                ))}
                <span className="text-xs text-gray-500">
                    Документы берутся из базы ЦехУспеха напрямую — всегда та же версия, что у завода.
                </span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto border border-gray-200 bg-white">
                <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-gray-100">
                        <tr>
                            <th className="border-b border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700">Файл</th>
                            <th className="border-b border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700">Изделие в ЦехУспехе</th>
                            <th className="border-b border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700">Где лежит</th>
                            <th className="border-b border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700">Изменён</th>
                        </tr>
                    </thead>
                    <tbody>
                        {docs.map((doc) => (
                            <tr key={`${doc.source}-${doc.fileId}`} className="hover:bg-gray-50">
                                <td className="border-b border-gray-100 px-2 py-1.5">
                                    <a
                                        href={doc.href}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-semibold text-blue-700 hover:underline"
                                    >
                                        {doc.name}
                                    </a>
                                </td>
                                <td className="border-b border-gray-100 px-2 py-1.5 text-gray-700">
                                    {doc.ownerName || <span className="text-gray-300">—</span>}
                                </td>
                                <td className="border-b border-gray-100 px-2 py-1.5 text-gray-500">{doc.sourceTitle}</td>
                                <td className="border-b border-gray-100 px-2 py-1.5 text-gray-500">{formatMoment(doc.at)}</td>
                            </tr>
                        ))}
                        {!docs.length && (
                            <tr>
                                <td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-500">
                                    {loading
                                        ? 'Ищем в ЦехУспехе…'
                                        : message
                                          ? message
                                          : applied
                                            ? 'Ничего не нашлось. Попробуйте короче: одно слово модели без габаритов'
                                            : 'Наберите модель или название изделия — например, ШСО-22М или Страж'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Размер файла здесь не показывается осознанно: чтобы его узнать,
                MySQL пришлось бы прочитать все блобы, и поиск из секунды
                превратился бы в минуты. */}
            <div className="mt-2 text-[11px] text-gray-500">
                Размер файла виден после открытия. Нашлось {docs.length}
                {docs.length >= 100 ? ' (показываем первую сотню — уточните запрос)' : ''}.
            </div>
        </div>
    );
}
