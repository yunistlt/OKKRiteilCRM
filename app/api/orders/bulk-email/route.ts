/**
 * Письмо сразу по нескольким заказам и перенос даты следующего контакта.
 *
 * Владелец 05.10.2026: «нужна функция выделения нескольких заказов и
 * возможность отправить все сразу письма-шаблоны, перенос даты после отправки
 * писем». Менеджер обходит два десятка тендеров по одному — открыть карточку,
 * написать, поменять дату — и на это уходит час.
 *
 * Письмо на каждый заказ собирается отдельно: шаблон с заданием ИИ пишет текст
 * под этот заказ, обычный шаблон подставляет его данные. Общий текст на всех
 * тоже можно — тогда он уходит как есть.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { buildOrderContext, renderTemplate } from '@/lib/templates/render';
import { writeLetter } from '@/lib/templates/ai-letter';
import { sendOrderEmail, stripOrderThreadTag } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
    /** Номера заказов, по которым пишем. */
    numbers: z.array(z.string().trim().min(1).max(20)).min(1).max(50),
    /** Код шаблона письма; пусто — берём свой текст. */
    templateCode: z.string().trim().max(100).optional().nullable(),
    subject: z.string().trim().max(300).optional().nullable(),
    body: z.string().max(20000).optional().nullable(),
    /** Дата следующего контакта, на которую двигаем заказы. */
    nextContact: z.string().trim().max(10).optional().nullable(),
    /**
     * Только собрать письма и показать, ничего не отправляя. Массовая отправка
     * уходит сразу и вслепую, поэтому человек должен иметь возможность сперва
     * прочитать, что именно уйдёт (решение владельца 05.10.2026).
     */
    preview: z.boolean().optional(),
});

type Result = { number: string; ok: boolean; to?: string; reason?: string };
type Preview = { number: string; to: string | null; client: string | null; subject: string; text: string; reason?: string };

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Выберите заказы и напишите письмо' }, { status: 400 });
    }

    const { numbers, templateCode, subject, body, nextContact, preview } = parsed.data;
    if (!templateCode && !(subject && body)) {
        return NextResponse.json({ error: 'Либо выберите шаблон, либо напишите тему и текст' }, { status: 400 });
    }

    const template = templateCode
        ? (await supabase
            .from('email_templates')
            .select('name, subject, body, mode, prompt')
            .eq('code', templateCode)
            .maybeSingle()).data as any
        : null;

    if (templateCode && !template) {
        return NextResponse.json({ error: 'Такого шаблона нет' }, { status: 404 });
    }

    const results: Result[] = [];
    const previews: Preview[] = [];

    for (const number of numbers) {
        try {
            const context = await buildOrderContext(number);
            if (!context) {
                const reason = 'заказ не найден';
                if (preview) previews.push({ number, to: null, client: null, subject: '', text: '', reason });
                else results.push({ number, ok: false, reason });
                continue;
            }

            // Адрес клиента лежит в самом заказе — там же, где его берёт форма
            // ответа по одному заказу.
            const order: any = (context as any).order ?? {};
            const to = String(order.email || order.customer?.email || order.contact?.email || '').trim();
            if (!to) {
                const reason = 'у заказа нет почты клиента';
                if (preview) previews.push({ number, to: null, client: null, subject: '', text: '', reason });
                else results.push({ number, ok: false, reason });
                continue;
            }

            let letterSubject = subject ?? '';
            let letterHtml = body ?? '';

            if (template) {
                if (template.mode === 'ai' && template.prompt) {
                    const letter = await writeLetter(String(template.prompt), context);
                    letterSubject = letter.subject;
                    // ИИ пишет обычным текстом — переводим в абзацы письма.
                    letterHtml = letter.text
                        .split(/\n{2,}/)
                        .map((part) => `<p>${part.replace(/\n/g, '<br>')}</p>`)
                        .join('');
                } else {
                    const subjectRender = renderTemplate(String(template.subject ?? ''), context);
                    const bodyRender = renderTemplate(String(template.body ?? ''), context);
                    if (!subjectRender.ok || !bodyRender.ok) {
                        results.push({ number, ok: false, reason: subjectRender.error || bodyRender.error || 'шаблон не собрался' });
                        continue;
                    }
                    letterSubject = subjectRender.output ?? '';
                    letterHtml = bodyRender.output ?? '';
                }
            }

            if (!letterSubject || !letterHtml) {
                results.push({ number, ok: false, reason: 'письмо не собралось' });
                continue;
            }

            if (preview) {
                previews.push({
                    number,
                    to,
                    client: order.contragent?.legalName || order.customer?.nickName || null,
                    subject: stripOrderThreadTag(letterSubject),
                    // Показываем текстом: читать вёрстку письма человеку незачем.
                    // Абзацы письма — пустой строкой: иначе текст слипается
                    // в одну простыню и прочитать его нельзя.
                    text: letterHtml
                        .replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<\/(p|div)>/gi, '\n\n')
                        .replace(/<[^>]+>/g, '')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim(),
                });
                continue;
            }

            // Номер заказа в тему ставит отправка — здесь только человеческая часть.
            const sent = await sendOrderEmail({
                to,
                orderNumber: number,
                subjectText: stripOrderThreadTag(letterSubject),
                html: letterHtml,
                fromName: 'ЗМК',
            });

            results.push(sent.sent
                ? { number, ok: true, to }
                : { number, ok: false, reason: sent.error || 'почта не приняла письмо' });
        } catch (e: any) {
            const reason = e?.message?.slice(0, 120) || 'ошибка';
            if (preview) previews.push({ number, to: null, client: null, subject: '', text: '', reason });
            else results.push({ number, ok: false, reason });
        }
    }

    // Предпросмотр: ничего не отправляли и дату не двигали.
    if (preview) {
        return NextResponse.json({ ok: true, preview: true, letters: previews });
    }

    /**
     * Дату двигаем только у тех, кому письмо ушло: иначе заказ пропадёт из
     * плана дня, а клиент письма так и не получил.
     */
    let moved = 0;
    const sentNumbers = results.filter((r) => r.ok).map((r) => r.number);
    if (nextContact && sentNumbers.length) {
        for (const number of sentNumbers) {
            const { data: order } = await supabase
                .from('orders')
                .select('id, raw_payload')
                .eq('number', number)
                .maybeSingle();
            if (!order) continue;

            const payload = { ...((order as any).raw_payload ?? {}) };
            payload.customFields = { ...(payload.customFields ?? {}), data_kontakta: nextContact };

            const { error } = await supabase
                .from('orders')
                .update({ raw_payload: payload })
                .eq('id', (order as any).id);
            if (!error) moved += 1;
        }
    }

    return NextResponse.json({
        ok: true,
        sent: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok),
        moved,
    });
}
