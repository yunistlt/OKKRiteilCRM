/**
 * Положить файл с компьютера в заказ — одним путём из всех мест.
 *
 * Приложить файл можно из четырёх мест: письмо по заказу, карточка заказа
 * (два списка) и боковая панель. Все они отправляли файл через наш сервер, а
 * там потолок ~4,5 МБ — максимальное тело запроса на Vercel. Поэтому за всё
 * время в заказы не доехал ни один файл тяжелее 4,11 МБ, хотя интерфейс
 * обещает 25 МБ: менеджер видел, что вложение «не отправляется» (жалоба
 * Евгении Матвеевой 19.10.2026).
 *
 * Теперь браузер кладёт файл прямо в хранилище по подписанной ссылке — наш
 * сервер в передаче не участвует и его потолок ни при чём. Тем же приёмом
 * работают вложения мессенджера и документы юротдела.
 */
import { uploadFileToSignedStorageUrl } from '@/lib/supabase-browser';

export type UploadedOrderFile = { id: number; file_name: string };

export async function uploadOrderFile(
    orderNumber: string,
    file: File,
    note?: string,
): Promise<UploadedOrderFile> {
    const base = `/api/orders/${encodeURIComponent(orderNumber)}/files/upload`;

    // 1. Подписанная ссылка в хранилище.
    const signRes = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, size: file.size, contentType: file.type || null }),
    });
    const signed = await signRes.json().catch(() => null);
    if (!signRes.ok || !signed?.token) {
        throw new Error(signed?.error || `Файл «${file.name}» не загрузился — попробуйте ещё раз`);
    }

    // 2. Сам файл — мимо нашего сервера.
    try {
        await uploadFileToSignedStorageUrl({
            bucket: signed.bucket,
            filePath: signed.path,
            token: signed.token,
            file,
            upsert: true,
        });
    } catch (e: any) {
        throw new Error(`Файл «${file.name}» не загрузился: ${e?.message || 'хранилище не приняло'}`);
    }

    // 3. Запись в заказ — теперь файл виден в разделе «Файлы».
    const regRes = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            register: {
                path: signed.path,
                fileName: file.name,
                size: file.size,
                contentType: file.type || null,
                note: note ?? null,
            },
        }),
    });
    const registered = await regRes.json().catch(() => null);
    if (!regRes.ok || !registered?.file?.id) {
        throw new Error(registered?.error || `Файл «${file.name}» загрузился, но не записался в заказ`);
    }

    return registered.file as UploadedOrderFile;
}
