import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import {
    loadProductionNote,
    saveProductionComment,
    setFileForProduction,
} from '@/lib/own-crm/tseh-production-notes';

export const dynamic = 'force-dynamic';

/**
 * Вкладка «Для производства» в карточке заказа.
 *
 * Менеджер пишет здесь то, что нужно цеху, и отмечает файлы, которые уходят
 * вместе с заказом. Комментарий менеджера в производство не передаётся: в нём
 * договорённости по цене и заметки про конкурентов (решение владельца
 * 04.10.2026).
 *
 * Со схемой маршрут не работает — за хранение отвечает
 * `lib/own-crm/tseh-production-notes.ts`.
 */

/** Всё содержимое вкладки одним запросом. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    try {
        return NextResponse.json(await loadProductionNote(decodeURIComponent(String(id))));
    } catch (e: any) {
        console.error('[production] не прочиталось:', e?.message || e);
        return NextResponse.json({ error: 'Не удалось прочитать данные для производства' }, { status: 500 });
    }
}

const CommentSchema = z.object({
    // Пустую строку сохраняем как есть: менеджер стёр текст — это его решение.
    comment: z.string().max(5000),
});

/** Сохранить комментарий для цеха. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const parsed = CommentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Комментарий слишком длинный' }, { status: 400 });
    }

    const author = [session.user.first_name, session.user.last_name].filter(Boolean).join(' ')
        || session.user.email
        || session.user.role;

    try {
        await saveProductionComment(decodeURIComponent(String(id)), parsed.data.comment, author);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error('[production] не сохранилось:', e?.message || e);
        return NextResponse.json({ error: 'Не удалось сохранить комментарий' }, { status: 500 });
    }
}

const FileSchema = z.object({
    fileId: z.number().int().positive(),
    forProduction: z.boolean(),
});

/** Отметить или снять файл для передачи в цех. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const parsed = FileSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Проверьте файл' }, { status: 400 });
    }

    const orderNumber = decodeURIComponent(String(id));

    try {
        /**
         * Файл должен принадлежать этому заказу.
         *
         * Хранение и так не отметит чужой файл — номер заказа стоит в условии
         * запроса. Но «ничего не обновилось» там неотличимо от успеха, и
         * интерфейс оставил бы галочку стоять впустую. Поэтому проверяем здесь
         * и говорим человеку прямо.
         */
        const note = await loadProductionNote(orderNumber);
        if (!note.files.some((file) => file.id === parsed.data.fileId)) {
            return NextResponse.json({ error: 'Этот файл относится к другому заказу' }, { status: 409 });
        }

        await setFileForProduction(parsed.data.fileId, orderNumber, parsed.data.forProduction);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error('[production] отметка файла не сохранилась:', e?.message || e);
        return NextResponse.json({ error: 'Отметка не сохранилась' }, { status: 500 });
    }
}
