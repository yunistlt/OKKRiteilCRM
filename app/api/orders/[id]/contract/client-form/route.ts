/**
 * Отправить юристу форму договора, присланную клиентом.
 *
 * Файл к заказу уже приложен обычным способом (`files/upload`) — здесь мы
 * только ставим его в очередь на согласование юристу. Копии файла не делаем.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { submitClientContractForm } from '@/lib/legal/client-contract-form';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BodySchema = z.object({
    /**
     * Файл заказа — форма договора от клиента. Текст ошибки свой: стандартный
     * от проверки приходит по-английски, а его видит человек.
     */
    fileId: z.coerce.number({ error: 'Выберите файл договора' }).int().positive(),
    orderId: z.coerce.number().int().positive().optional().nullable(),
    /** Что проверить, словами менеджера. */
    question: z.string().trim().max(2000).optional().nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id));

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Выберите файл договора' }, { status: 400 });
    }

    const result = await submitClientContractForm({
        orderNumber,
        orderId: parsed.data.orderId ?? null,
        fileId: parsed.data.fileId,
        question: parsed.data.question ?? null,
        author: session.user.email || session.user.role,
    });

    if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    return NextResponse.json({
        ok: true,
        id: result.id,
        review: result.review,
        note: result.textFound
            ? 'Договор клиента отправлен юристу на проверку. Файл остался в «Файлах» заказа.'
            : 'Договор клиента отправлен юристу. Текст из файла прочитать не удалось — юрист посмотрит сам файл.',
    });
}
