import Link from 'next/link';
import { notFound } from 'next/navigation';
import { entityBySlug, entityFiles } from '@/lib/legal-entity/files';

export const dynamic = 'force-dynamic';

/**
 * Страница уставных документов для клиента: zmksoft.com/docs/zmk.
 *
 * То, что раньше было ссылкой на чужой Яндекс.Диск. Входа не требует — это
 * те же документы, которые и так рассылались по запросу; закрытые файлы
 * (декларации, договор аренды) сюда не попадают, их помечают в карточке
 * юрлица.
 */
const size = (bytes: number | null): string => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

export default async function PublicDocsPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const entity = await entityBySlug(slug);
    if (!entity) notFound();

    const files = await entityFiles(entity.id, true);

    // Папки с Диска сохраняем: «Устав», «Карточка с реквизитами» — клиенту так
    // понятнее, чем свалка из двадцати файлов.
    const folders = new Map<string, typeof files>();
    for (const file of files) {
        const key = file.folder || '';
        const list = folders.get(key);
        if (list) list.push(file);
        else folders.set(key, [file]);
    }

    return (
        <main className="mx-auto max-w-3xl px-4 py-10 text-gray-900">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Документы компании</p>
            <h1 className="mt-1 text-2xl font-bold">{entity.name}</h1>
            {entity.inn && <p className="mt-1 text-sm text-gray-500">ИНН {entity.inn}</p>}

            {files.length > 0 && (
                <p className="mt-4">
                    <Link
                        href={`/api/public/docs/${slug}?zip=1`}
                        className="inline-block border border-gray-900 px-3 py-1.5 text-sm font-bold text-gray-900 hover:bg-gray-900 hover:text-white"
                    >
                        Скачать все {files.length} документов архивом
                    </Link>
                </p>
            )}

            {!files.length && (
                <p className="mt-8 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    Документы ещё не выложены. Напишите менеджеру — пришлём почтой.
                </p>
            )}

            {Array.from(folders.entries()).map(([folder, list]) => (
                <section key={folder || 'root'} className="mt-7">
                    {folder && <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">{folder}</h2>}
                    <ul className="border border-gray-200">
                        {list.map((file) => (
                            <li key={file.id} className="flex items-baseline justify-between gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0">
                                <Link
                                    href={`/api/public/docs/${slug}?file=${file.id}`}
                                    className="text-sm font-semibold text-blue-700 hover:underline"
                                >
                                    {file.fileName}
                                </Link>
                                <span className="shrink-0 text-xs text-gray-400">{size(file.size)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}

            <p className="mt-10 border-t border-gray-200 pt-4 text-xs text-gray-500">
                Нужен документ, которого здесь нет, — напишите на rop@zmktlt.ru, пришлём в тот же день.
            </p>
        </main>
    );
}
