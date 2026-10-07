/**
 * Разбор банковской выписки в формате «1CClientBankExchange».
 *
 * Решение владельца 07.10.2026: «давай сделаем загрузку руками в Платежи
 * выписок из банка ВТБ, чтобы разнеслись поступления уже системой».
 *
 * Повод: счёт ООО «ЗМК» в Банке ВТБ (40702810300810084912) к обмену не
 * подключён, и поступления на него в ОКК не попадают вовсе. За сентябрь так
 * прошло 5 платежей, из них 887 234,78 ₽ по заказам 54789 и 54863 пришлось
 * разносить руками, а три остальных до сих пор не разнесены. Автоматического
 * обмена с ВТБ у нас нет.
 *
 * Формат «1CClientBankExchange» отдают все банки России — он задуман для
 * обмена с 1С. Поэтому разбор написан не под ВТБ, а под сам формат: той же
 * кнопкой можно будет загрузить выписку любого банка, с которым обмена нет.
 *
 * Дальше платежи идут обычным путём (`ingestPointPayment`): сопоставление с
 * заказом по номеру счёта в назначении, разноска, оповещение. Ничего
 * отдельного для загруженных руками не делаем.
 */
import { NormalizedPointPayment, parseAmountToKopecks } from './types';

/** Одна строка выписки, как её прочитали из файла. */
export interface StatementDoc {
    number: string | null;
    date: string | null;
    amount: string | null;
    payerName: string | null;
    payerInn: string | null;
    payerKpp: string | null;
    payerAccount: string | null;
    payerBankBic: string | null;
    payerBankName: string | null;
    recipientName: string | null;
    recipientInn: string | null;
    recipientAccount: string | null;
    purpose: string | null;
    /** Дата зачисления, если банк её указал. */
    creditedAt: string | null;
}

export interface ParsedStatement {
    /** Счёт, по которому выписка. */
    account: string | null;
    /** Период выписки, как указан в файле. */
    dateFrom: string | null;
    dateTo: string | null;
    docs: StatementDoc[];
    /** Что не поняли — показываем человеку, молча не глотаем. */
    problems: string[];
}

/** «25.09.2026» → «2026-09-25». Чужой формат не угадываем. */
function toIsoDate(value: string | null): string | null {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value ?? '').trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Разбирает текст выписки.
 *
 * Файл приходит в Windows-1251 — перекодировать должен вызывающий: здесь
 * работаем уже с текстом.
 */
export function parseStatement1C(text: string): ParsedStatement {
    const lines = String(text ?? '').split(/\r?\n/);
    const result: ParsedStatement = {
        account: null, dateFrom: null, dateTo: null, docs: [], problems: [],
    };

    if (!lines.some((l) => l.trim() === '1CClientBankExchange')) {
        result.problems.push(
            'Это не выписка в формате 1С. Выгрузите из клиент-банка файл обмена с 1С '
            + '(«1CClientBankExchange») и загрузите его.',
        );
        return result;
    }

    let current: Record<string, string> | null = null;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (line.startsWith('СекцияДокумент')) { current = {}; continue; }
        if (line.startsWith('КонецДокумента')) {
            if (current) result.docs.push(toDoc(current));
            current = null;
            continue;
        }

        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();

        if (current) {
            // Назначение платежа банк переносит на несколько строк.
            current[key] = current[key] ? `${current[key]} ${value}` : value;
            continue;
        }

        if (key === 'РасчСчет') result.account = value;
        if (key === 'ДатаНачала') result.dateFrom = toIsoDate(value);
        if (key === 'ДатаКонца') result.dateTo = toIsoDate(value);
    }

    if (!result.docs.length) {
        result.problems.push('В файле нет ни одного платёжного документа.');
    }
    return result;
}

function toDoc(f: Record<string, string>): StatementDoc {
    return {
        number: f['Номер'] ?? null,
        date: toIsoDate(f['Дата'] ?? null),
        amount: f['Сумма'] ?? null,
        payerName: f['Плательщик1'] || f['Плательщик'] || null,
        payerInn: f['ПлательщикИНН'] ?? null,
        payerKpp: f['ПлательщикКПП'] ?? null,
        payerAccount: f['ПлательщикСчет'] ?? null,
        payerBankBic: f['ПлательщикБИК'] ?? null,
        payerBankName: f['ПлательщикБанк1'] ?? null,
        recipientName: f['Получатель1'] || f['Получатель'] || null,
        recipientInn: f['ПолучательИНН'] ?? null,
        recipientAccount: f['ПолучательСчет'] ?? null,
        purpose: f['НазначениеПлатежа'] ?? null,
        creditedAt: toIsoDate(f['ДатаПоступило'] ?? null),
    };
}

/**
 * Только поступления НА наш счёт: списания и переводы между своими счетами
 * разносить по заказам нечего.
 */
export function incomingOnly(parsed: ParsedStatement, ourAccount: string | null): StatementDoc[] {
    const account = String(ourAccount ?? parsed.account ?? '').trim();
    if (!account) return parsed.docs;
    return parsed.docs.filter((d) => String(d.recipientAccount ?? '').trim() === account);
}

/**
 * Строка выписки → платёж в том же виде, в каком приходят Точка и Т-Банк.
 *
 * `externalPaymentId` собираем из счёта, номера и даты документа: повторная
 * загрузка той же выписки не создаст дублей — приём платежей идемпотентен по
 * этому полю.
 */
export function toPayment(doc: StatementDoc, params: {
    source: string;
    account: string | null;
}): NormalizedPointPayment | null {
    const amount = parseAmountToKopecks(doc.amount ?? '');
    if (!amount || amount <= 0) return null;

    const account = String(params.account ?? doc.recipientAccount ?? '').trim();
    const id = ['stmt', account, doc.number ?? 'б-н', doc.date ?? ''].join('-');

    return {
        source: params.source,
        externalPaymentId: id,
        webhookType: 'statement-upload',
        amountKopecks: amount,
        currency: 'RUB',
        paymentDate: doc.creditedAt || doc.date,
        paymentDatetime: null,
        purpose: doc.purpose,
        documentNumber: doc.number,
        payerName: doc.payerName,
        payerInn: doc.payerInn,
        payerKpp: doc.payerKpp,
        payerAccount: doc.payerAccount,
        payerBankBic: doc.payerBankBic,
        payerBankName: doc.payerBankName,
        accountId: account || null,
        recipientName: doc.recipientName,
        recipientInn: doc.recipientInn,
        // Подписи у файла нет: его принёс человек, и это видно в журнале.
        signatureVerified: false,
        rawPayload: { ...doc, loadedFrom: 'выписка 1С', loadedAt: new Date().toISOString() },
    };
}
