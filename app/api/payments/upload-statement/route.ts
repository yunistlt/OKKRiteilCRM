/**
 * Загрузка банковской выписки файлом.
 *
 * Решение владельца 07.10.2026: «давай сделаем загрузку руками в Платежи
 * выписок из банка ВТБ, чтобы разнеслись поступления уже системой».
 *
 * Счёт ООО «ЗМК» в ВТБ к обмену не подключён, и поступления на него в ОКК не
 * приходят. Пока обмена нет, выписку приносит человек — а дальше всё как
 * обычно: платежи сопоставляются с заказами и разносятся тем же механизмом,
 * что и поступления из Точки.
 *
 * Формат «1CClientBankExchange» отдают все банки, так что загрузить можно
 * выписку любого банка, с которым обмена нет.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { parseStatement1C, incomingOnly, toPayment } from '@/lib/payments/statement-1c';
import { ingestPointPayment } from '@/lib/payments/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Выписку из клиент-банка выгружают в Windows-1251 — читаем с учётом этого. */
function decode(buffer: ArrayBuffer): string {
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    // Признак неверной кодировки — символ замены: перечитываем как 1251.
    if (!utf8.includes('�')) return utf8;
    return new TextDecoder('windows-1251').decode(buffer);
}

export async function POST(req: Request) {
    const session = await getSession();
    // Деньги — дело бухгалтерии и руководителя, не каждого менеджера.
    if (!hasAnyRole(session, ['admin', 'rop', 'okk'])) {
        return NextResponse.json({ error: 'Нет доступа' }, { status: 403 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Выберите файл выписки' }, { status: 400 });
    }

    const source = String(form?.get('source') ?? 'statement').trim() || 'statement';
    const parsed = parseStatement1C(decode(await file.arrayBuffer()));

    if (parsed.problems.length) {
        return NextResponse.json({ error: parsed.problems.join(' ') }, { status: 400 });
    }

    const docs = incomingOnly(parsed, parsed.account);
    let added = 0;
    let already = 0;
    const skipped: string[] = [];

    for (const doc of docs) {
        const payment = toPayment(doc, { source, account: parsed.account });
        if (!payment) {
            skipped.push(`№${doc.number ?? 'б-н'}: не разобрали сумму`);
            continue;
        }
        try {
            const { isNew } = await ingestPointPayment(payment);
            if (isNew) added += 1;
            else already += 1;
        } catch (e: any) {
            skipped.push(`№${doc.number ?? 'б-н'}: ${e?.message ?? 'не загрузился'}`);
        }
    }

    return NextResponse.json({
        ok: true,
        account: parsed.account,
        period: parsed.dateFrom && parsed.dateTo ? `${parsed.dateFrom} — ${parsed.dateTo}` : null,
        всегоДокументов: parsed.docs.length,
        поступлений: docs.length,
        добавлено: added,
        ужеБыли: already,
        пропущено: skipped,
        note: added
            ? `Загружено поступлений: ${added}. Они встанут в очередь на разнос по заказам.`
            : already
                ? 'Все платежи из этой выписки уже загружены — повторно не добавлены.'
                : 'В выписке нет поступлений на наш счёт.',
    });
}
