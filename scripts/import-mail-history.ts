/**
 * Старые письма по заказам — из ящика к нам.
 *
 * 12.10.2026 Женя Матвеева показала заказ 40058: в RetailCRM к нему три файла,
 * у нас один. Два недостающих — вложения ПИСЕМ: в RetailCRM они живут в её
 * почтовом модуле, и в её API их нет. Зато они есть в нашем ящике: там 166 213
 * писем с 2019 года.
 *
 * Поэтому историю забираем из ящика. Переносим только то, чего нет в самом
 * письме: заголовок, дату, отправителя, номер заказа из тега темы и ОПИСЬ
 * вложений. Сами файлы остаются в ящике и скачиваются по первому нажатию —
 * как у свежих писем (`/api/orders/<n>/files/download`), иначе мы перетащили
 * бы к себе десятки гигабайт ради файлов, которые никто не откроет.
 *
 * Берём только письма с тегом заказа в теме: «[#2/40058]». Угадывать по
 * пятизначным числам нельзя — в темах полно сумм и артикулов.
 *
 * Запуск:
 *   npx tsx scripts/import-mail-history.ts --from=2024-01-01            # посмотреть
 *   npx tsx scripts/import-mail-history.ts --from=2024-01-01 --apply    # записать
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

const arg = (name: string): string | null =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null;

/** Опись вложений письма из его структуры: имена и размеры, без самих файлов. */
function attachmentsOf(structure: any): Array<{ filename: string; size: number | null; contentType: string | null }> {
    const out: Array<{ filename: string; size: number | null; contentType: string | null }> = [];

    const walk = (node: any) => {
        if (!node) return;
        for (const child of (node.childNodes ?? [])) walk(child);

        const disposition = String(node.disposition ?? '').toLowerCase();
        const filename = node.dispositionParameters?.filename || node.parameters?.name;
        if (disposition === 'attachment' || (filename && disposition !== 'inline')) {
            if (filename) {
                out.push({
                    filename: String(filename),
                    size: Number.isFinite(Number(node.size)) ? Number(node.size) : null,
                    contentType: node.type ? String(node.type) : null,
                });
            }
        }
    };

    walk(structure);
    return out;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const since = arg('from') || '2024-01-01';
    const folder = arg('folder') || 'INBOX';

    const { ImapFlow } = await import('imapflow');
    const { supabase } = await import('../utils/supabase');
    const { orderFromSubject } = await import('../lib/email/order-tag');

    const user = process.env.IMAP_USER || process.env.SMTP_USER;
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
    if (!user || !pass) {
        console.error('Нет доступа к ящику: IMAP_USER/IMAP_PASS в .env.local');
        process.exit(1);
    }

    /**
     * Ящик отвечает не всегда: 12.10.2026 у Яндекса были перебои, и соединение
     * рвалось сразу после TLS. Пробуем несколько раз — перенос истории дело
     * долгое, ронять его из-за одной осечки незачем.
     */
    const connect = async () => {
        let lastError: any = null;

        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                const client = new ImapFlow({ host: 'imap.yandex.ru', port: 993, secure: true, auth: { user, pass }, logger: false });
                await client.connect();
                await client.mailboxOpen(folder, { readOnly: true } as any);
                return client;
            } catch (e: any) {
                lastError = e;
                console.warn(`  ящик не ответил (${e?.code || e?.message}), попытка ${attempt} из 5`);
                await new Promise((r) => setTimeout(r, attempt * 3000));
            }
        }

        throw lastError;
    };

    let seen = 0;
    let tagged = 0;
    let withFiles = 0;
    let written = 0;
    let known = 0;

    // Какие письма у нас уже есть: сверяем по номеру в ящике, он не меняется.
    const { data: existing } = await supabase
        .from('incoming_emails')
        .select('imap_uid')
        .eq('mailbox', user)
        .eq('folder', folder)
        .not('imap_uid', 'is', null)
        .limit(50000);
    const have = new Set(((existing ?? []) as any[]).map((row) => Number(row.imap_uid)));

    /**
     * Сначала спрашиваем номера писем, потом тянем их пачками по двести.
     * Одним запросом на весь ящик Яндекс обрывает соединение: писем 166 тысяч.
     */
    let client = await connect();
    const uids: number[] = await client.search({ since: new Date(since) } as any, { uid: true } as any) as any;
    console.log(`писем с ${since}: ${uids.length}`);

    const CHUNK = 200;
    for (let from = 0; from < uids.length; from += CHUNK) {
        const batch = uids.slice(from, from + CHUNK);

        let messages: any[] = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                messages = [];
                for await (const msg of client.fetch({ uid: batch.join(',') } as any, {
                    uid: true, envelope: true, bodyStructure: true, internalDate: true,
                } as any, { uid: true } as any)) {
                    messages.push(msg);
                }
                break;
            } catch (e: any) {
                console.warn(`  пачка ${from}: ${e?.code || e?.message} — переподключаюсь`);
                await client.logout().catch(() => undefined);
                await new Promise((r) => setTimeout(r, 2000));
                client = await connect();
                if (attempt === 3) messages = [];
            }
        }

        for (const msg of messages) {
            seen += 1;
            const subject = String(msg.envelope?.subject ?? '');
            const order = orderFromSubject(subject).tagged;
            if (!order) continue;
            tagged += 1;

            if (have.has(Number(msg.uid))) { known += 1; continue; }

            const files = attachmentsOf(msg.bodyStructure);
            if (files.length) withFiles += 1;
            if (!apply) continue;

            // Заказ должен существовать: иначе письмо повиснет на номере, которого нет.
            const { data: orderRow } = await supabase
                .from('orders')
                .select('order_id, number')
                .eq('number', order)
                .maybeSingle();
            if (!orderRow) continue;

            const sender = msg.envelope?.from?.[0];
            const receivedAt = msg.internalDate instanceof Date
                ? msg.internalDate.toISOString()
                : new Date(msg.envelope?.date ?? Date.now()).toISOString();

            const { error } = await supabase.from('incoming_emails').insert({
                message_id: msg.envelope?.messageId ?? null,
                mailbox: user,
                folder,
                imap_uid: Number(msg.uid),
                from_email: sender?.address ?? null,
                from_name: sender?.name ?? null,
                to_email: msg.envelope?.to?.[0]?.address ?? user,
                subject,
                received_at: receivedAt,
                has_attachments: files.length > 0,
                attachments_meta: files,
                status: 'imported',
                email_type: 'reply_thread',
                reasoning: 'Перенесено из почтового ящика (история)',
                created_crm_order_number: String((orderRow as any).number),
                created_crm_order_id: Number((orderRow as any).order_id),
                linked_order_id: Number((orderRow as any).order_id),
            });

            if (!error) written += 1;
        }

        console.log(`  просмотрено ${seen} из ${uids.length}, с тегом ${tagged}, с вложениями ${withFiles}, записано ${written}`);
    }

    await client.logout().catch(() => undefined);

    console.log(`\nпросмотрено ${seen}, с тегом заказа ${tagged}, из них с вложениями ${withFiles}`);
    console.log(`уже было у нас ${known}, записано ${written}`);
    if (!apply) console.log('Это пробный прогон. Повторите с --apply.');
}

main();
