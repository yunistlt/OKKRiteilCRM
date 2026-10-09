/**
 * Каталог продукции — для клиента, по ссылке из письма.
 *
 * Лежит там же, где уставные документы: в файлах нашего юрлица
 * (`legal_entity_files`), папка «Каталог продукции», с галочкой «публичный».
 * Отдельной таблицы и отдельной загрузки нет намеренно — файл заменяется той
 * же вкладкой «Файлы» в карточке юрлица, что и остальные документы.
 *
 * Ссылка в письмах постоянная — `/katalog`: при замене каталога письма,
 * ушедшие раньше, продолжают вести на свежий файл.
 */
import { supabase } from '@/utils/supabase';
import { BUCKET } from '@/lib/legal-entity/files';

export const CATALOG_FOLDER = 'Каталог продукции';
export const CATALOG_PATH = '/katalog';

export type CatalogFile = {
    id: number;
    fileName: string;
    contentType: string | null;
    size: number | null;
    storagePath: string;
};

/** Текущий каталог: самый свежий публичный файл в папке «Каталог продукции». */
export async function catalogFile(): Promise<CatalogFile | null> {
    const { data, error } = await supabase
        .from('legal_entity_files')
        .select('id, file_name, content_type, size_bytes, storage_path, created_at')
        .eq('folder', CATALOG_FOLDER)
        .eq('is_public', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error('[каталог] не прочитался список:', error.message);
        return null;
    }

    const row = ((data ?? []) as any[])[0];
    if (!row) return null;

    return {
        id: Number(row.id),
        fileName: String(row.file_name),
        contentType: row.content_type ?? null,
        size: row.size_bytes ?? null,
        storagePath: String(row.storage_path),
    };
}

/** Сам файл каталога. */
export async function catalogBytes(): Promise<{ file: CatalogFile; bytes: ArrayBuffer } | null> {
    const file = await catalogFile();
    if (!file) return null;

    const stored = await supabase.storage.from(BUCKET).download(file.storagePath);
    if (stored.error || !stored.data) {
        console.error('[каталог] файл не скачался:', stored.error?.message);
        return null;
    }

    return { file, bytes: await stored.data.arrayBuffer() };
}
