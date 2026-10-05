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
});

type Result = { number: string; ok: boolean; to?: string; reason?: string };

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Выберите заказы и напишите письмо' }, { status: 400 });
    }

    const { numbers, templateCode, subject, body, nextContact } = parsed.data;
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

    for (const number of numbers) {
        try {
            const context = await buildOrderContext(number);
            if (!context) {
                results.push({ number, ok: false, reason: 'заказ не найден' });
                continue;
            }

            // Адрес клиента лежит в самом заказе — там же, где его берёт форма
            // ответа по одному заказу.
            const order: any = (context as any).order ?? {};
            const to = String(order.email || order.customer?.email || order.contact?.email || '').trim();
            if (!to) {
                results.push({ number, ok: false, reason: 'у заказа нет почты клиента' });
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
            results.push({ number, ok: false, reason: e?.message?.slice(0, 120) || 'ошибка' });
        }
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
