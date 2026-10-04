/**
 * Вкладка «Для производства» в карточке заказа: что именно уходит в цех.
 *
 * Решение владельца 04.10.2026. Раньше в ЦехУспех уезжал комментарий менеджера целиком, а там
 * бывает внутренняя кухня — договорённости по цене, переписка про согласование. Теперь менеджер
 * сам пишет, что сказать производству, и отмечает файлы (ТЗ заказчика), которые уедут с заказом.
 *
 * Файлы не дублируются: они уже лежат в `order_files`, здесь только отметка `for_production`.
 * Схема — migrations/20261004_tseh_production_notes.sql.
 *
 * Эти функции зовёт вкладка в карточке заказа, чтобы не знать про схему и не ходить в базу сама.
 */
import { supabase } from '@/utils/supabase';

export type ProductionFile = {
    id: number;
    fileName: string;
    contentType: string | null;
    sizeBytes: number | null;
    forProduction: boolean;
};

export type ProductionNote = {
    orderNumber: string;
    comment: string;
    updatedBy: string | null;
    updatedAt: string | null;
    files: ProductionFile[];
};

/** Всё содержимое вкладки по номеру заказа: комментарий для цеха и файлы заказа с отметками. */
export async function loadProductionNote(orderNumber: string): Promise<ProductionNote> {
    const [{ data: note }, { data: files }] = await Promise.all([
        supabase.from('tseh_production_notes').select('comment, updated_by, updated_at').eq('order_number', orderNumber).maybeSingle(),
        supabase
            .from('order_files')
            .select('id, file_name, content_type, size_bytes, for_production')
            .eq('order_number', orderNumber)
            .is('deleted_at', null)
            .order('created_at', { ascending: true }),
    ]);

    return {
        orderNumber,
        comment: String((note as any)?.comment ?? ''),
        updatedBy: (note as any)?.updated_by ?? null,
        updatedAt: (note as any)?.updated_at ?? null,
        files: ((files as any[]) || []).map((f) => ({
            id: Number(f.id),
            fileName: String(f.file_name ?? ''),
            contentType: f.content_type ?? null,
            sizeBytes: f.size_bytes ?? null,
            forProduction: Boolean(f.for_production),
        })),
    };
}

/** Сохраняет комментарий для цеха. Пустой текст — это тоже решение менеджера, строку оставляем. */
export async function saveProductionComment(orderNumber: string, comment: string, author: string | null): Promise<void> {
    const { error } = await supabase.from('tseh_production_notes').upsert(
        { order_number: orderNumber, comment, updated_by: author, updated_at: new Date().toISOString() },
        { onConflict: 'order_number' },
    );
    if (error) throw new Error(error.message);
}

/** Отмечает или снимает отметку «передать в производство» с файла заказа. */
export async function setFileForProduction(fileId: number, orderNumber: string, on: boolean): Promise<void> {
    // Номер заказа в условии — чтобы отметка не могла уйти файлу чужого заказа.
    const { error } = await supabase
        .from('order_files')
        .update({ for_production: on })
        .eq('id', fileId)
        .eq('order_number', orderNumber);
    if (error) throw new Error(error.message);
}

/** Файлы, отмеченные для производства. По ним ЦехУспех забирает вложения заказа. */
export async function productionFiles(orderNumber: string): Promise<ProductionFile[]> {
    const { data } = await supabase
        .from('order_files')
        .select('id, file_name, content_type, size_bytes, for_production')
        .eq('order_number', orderNumber)
        .eq('for_production', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

    return ((data as any[]) || []).map((f) => ({
        id: Number(f.id),
        fileName: String(f.file_name ?? ''),
        contentType: f.content_type ?? null,
        sizeBytes: f.size_bytes ?? null,
        forProduction: true,
    }));
}

/** Комментарий для цеха — он уходит в заказ ЦехУспеха вместо переписки менеджера. */
export async function productionComment(orderNumber: string): Promise<string | null> {
    const { data } = await supabase.from('tseh_production_notes').select('comment').eq('order_number', orderNumber).maybeSingle();
    const text = String((data as any)?.comment ?? '').trim();
    return text.length > 0 ? text : null;
}
