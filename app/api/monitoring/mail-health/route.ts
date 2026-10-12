/**
 * Доходит ли почта: проверка связи с почтовым сервером прямо с прода.
 *
 * 12.10.2026 письма перестали уходить с ошибкой `ETIMEDOUT 77.88.21.158:465` —
 * сервер не достучался до SMTP Яндекса. Понять «это у них или у нас» можно
 * только с той машины, откуда уходит письмо: локально SMTP всё равно закрыт
 * провайдером.
 *
 * Отдаёт только времена и коды ошибок — ни пароля, ни писем здесь нет.
 */
import net from 'net';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Простое соединение: отвечает ли порт вообще. */
function probe(host: string, port: number, timeoutMs = 8000): Promise<string> {
    return new Promise((resolve) => {
        const started = Date.now();
        const socket = net.createConnection({ host, port });
        socket.setTimeout(timeoutMs);

        socket.once('connect', () => {
            socket.destroy();
            resolve(`соединение за ${Date.now() - started} мс`);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(`таймаут ${timeoutMs} мс`);
        });
        socket.once('error', (e: any) => {
            socket.destroy();
            resolve(`ошибка: ${e?.code || e?.message || 'неизвестно'}`);
        });
    });
}

export async function GET() {
    const checks: Record<string, string> = {};

    /**
     * Чужие почтовые серверы — чтобы отличить «Яндекс нас не пускает» от
     * «нашему серверу вообще закрыли отправку почты». Без этого спорить не о
     * чем: симптом одинаковый.
     */
    for (const [host, port] of [
        ['smtp.yandex.ru', 465],
        ['smtp.yandex.ru', 587],
        ['imap.yandex.ru', 993],
        ['smtp.gmail.com', 465],
        ['smtp.mail.ru', 465],
        ['smtp.yandex.ru', 443],
    ] as Array<[string, number]>) {
        checks[`${host}:${port}`] = await probe(host, port);
    }

    return NextResponse.json({
        ok: true,
        проверено: new Date().toISOString(),
        связь: checks,
        подсказка: 'Таймаут на 465 и 587 при живом 993 — почтовый сервер не пускает именно отправку.',
    });
}
