/**
 * Подписанные ссылки на просмотр заказа из ЦехУспеха.
 *
 * Зачем: цеху иногда нужно посмотреть подробности заказа у нас, а заводить учётки всем
 * сотрудникам завода — лишние доступы (решение владельца 04.10.2026). Поэтому доступа как
 * такового нет: ЦехУспех по клику выдаёт ссылку, подписанную общим ключом, и она открывает
 * РОВНО ОДИН заказ и только на просмотр.
 *
 * Подпись считается от номера заказа и срока годности, поэтому подменить номер в адресе и
 * попасть в чужой заказ нельзя. Срок короткий (ссылку выдаёт ЦехУспех на 15 минут), так что
 * пересланная ссылка быстро перестаёт работать.
 *
 * Ключ — тот же TSEH_API_KEY, что у приёма заказов: отдельный секрет на одно и то же доверие
 * плодить незачем.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export type LinkCheck = { ok: true } | { ok: false; reason: 'no-key' | 'bad-signature' | 'expired' };

/** Подпись ссылки — должна совпадать с OkkLinkEndpoints.Sign на стороне ЦехУспеха. */
export function signView(number: string, exp: number, key: string): string {
    return createHmac('sha256', key).update(`${number}.${exp}`).digest('hex');
}

export function checkViewLink(number: string, exp: string | null, sig: string | null): LinkCheck {
    const key = process.env.TSEH_API_KEY;
    // Ключа нет — проверять нечем, и «пускаем всех» тут недопустимо.
    if (!key) return { ok: false, reason: 'no-key' };
    if (!exp || !sig) return { ok: false, reason: 'bad-signature' };

    const expNum = Number(exp);
    if (!Number.isFinite(expNum)) return { ok: false, reason: 'bad-signature' };

    const expected = signView(number, expNum, key);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(sig, 'utf8');
    // Сравнение за постоянное время: иначе подпись можно подобрать по времени ответа.
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };

    // Срок проверяем ПОСЛЕ подписи, чтобы «протухла» не подсказывало, что подпись верна.
    if (expNum * 1000 < Date.now()) return { ok: false, reason: 'expired' };

    return { ok: true };
}
