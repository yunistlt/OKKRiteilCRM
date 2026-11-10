/**
 * Коннектор Claude к ОКК — MCP-сервер, только чтение.
 *
 * Подключается в Claude как свой коннектор: адрес https://okk.zmksoft.com/mcp/okk,
 * вход «Без входа», в заголовках запроса — X-Api-Key с личным ключом сотрудника.
 * Сессии у Claude нет, поэтому маршрут открыт в middleware и закрыт ключом здесь.
 *
 * Транспорт — Streamable HTTP без состояния: каждый запрос самодостаточен,
 * сервер собирается под него заново. Как устроено и как выдать ключ —
 * docs/mcp/OVERVIEW.md.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticate } from '@/lib/mcp/keys';
import { buildServer } from '@/lib/mcp/server';
import { getRateLimiter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Не больше 60 запросов в минуту на ключ. */
const limiter = () => getRateLimiter('mcp-okk', { limit: 60, windowMs: 60_000 });

/** Ошибка в формате протокола: клиент Claude показывает текст message как есть. */
function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

export async function POST(request: Request): Promise<Response> {
    const key = await authenticate(request);
    if (!key) {
        return rpcError(401, 'Доступ к ОКК не открыт. Проверьте заголовок X-Api-Key в настройках подключения — ключ неверный или отозван.');
    }

    const limit = limiter().check(String(key.id));
    if (!limit.ok) {
        const retryAfter = Math.max(1, Math.ceil(limit.resetMs / 1000));
        return rpcError(429, `Слишком много запросов: не больше 60 в минуту на ключ. Повторите через ${retryAfter} с.`, {
            'Retry-After': String(retryAfter),
        });
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    const server = buildServer(key);
    await server.connect(transport);
    return transport.handleRequest(request);
}

// Потока событий от сервера нет: состояния не держим, все ответы приходят на POST.
export async function GET(): Promise<Response> {
    return rpcError(405, 'Коннектор отвечает только на POST.', { Allow: 'POST' });
}

export async function DELETE(): Promise<Response> {
    return rpcError(405, 'Сессий у коннектора нет — закрывать нечего.', { Allow: 'POST' });
}
