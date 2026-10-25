/**
 * Положить файл с компьютера в заказ — одним путём из всех мест.
 *
 * Приложить файл можно из четырёх мест: письмо по заказу, карточка заказа
 * (два списка) и боковая панель.
 *
 * Дорог к хранилищу две, и каждая умеет не всё:
 *
 *  1. ЧЕРЕЗ НАШ СЕРВЕР — обычный путь. Работает везде, где работает сам ОКК:
 *     файл идёт на наш домен, через наш обратный прокси. Потолок — около
 *     4,5 МБ: столько весит максимальное тело запроса на Vercel.
 *
 *  2. НАПРЯМУЮ В ХРАНИЛИЩЕ по подписанной ссылке — для файлов тяжелее.
 *     Потолка нет, но браузер идёт на чужой домен, а до него у менеджеров
 *     достаёт сетевая фильтрация: «Failed to fetch» (жалоба Евгении
 *     Матвеевой 20.10.2026 — после перевода ВСЕХ файлов на этот путь перестал
 *     отправляться даже файл на 160 КБ).
 *
 * Поэтому: мелочь — через сервер, крупное — напрямую. Если прямой путь не
 * прошёл, честно говорим, что файл слишком тяжёлый для обычной дороги, а не
 * прячем сетевую ошибку.
 */
import { uploadFileToSignedStorageUrl } from '@/lib/supabase-browser';

export type UploadedOrderFile = { id: number; file_name: string };

/**
 * Где проходит граница. Четыре мегабайта с запасом: на Vercel лимит тела
 * запроса 4,5 МБ, и в него входит не только сам файл.
 */
const VIA_SERVER_LIMIT = 4 * 1024 * 1024;

export async function uploadOrderFile(
    orderNumber: string,
    file: File,
    note?: string,
): Promise<UploadedOrderFile> {
    const base = `/api/orders/${encodeURIComponent(orderNumber)}/files/upload`;

    if (file.size <= VIA_SERVER_LIMIT) {
        const form = new FormData();
        form.append('file', file);
        if (note) form.append('note', note);

        const res = await fetch(base, { method: 'POST', body: form });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.file?.id) {
            throw new Error(payload?.error || `Файл «${file.name}» не загрузился — попробуйте ещё раз`);
        }
        return payload.file as UploadedOrderFile;
    }

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

    // 2. Сам файл — мимо нашего сервера: иначе он не пройдёт по размеру.
    try {
        await uploadFileToSignedStorageUrl({
            bucket: signed.bucket,
            filePath: signed.path,
            token: signed.token,
            file,
            upsert: true,
        });
    } catch (e: any) {
        throw new Error(
            `Файл «${file.name}» (${(file.size / 1024 / 1024).toFixed(1)} МБ) загрузить не удалось: `
            + 'такие файлы идут в хранилище напрямую, и до него не достучался браузер. '
            + 'Пришлите файл ссылкой или разбейте на части.',
        );
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
