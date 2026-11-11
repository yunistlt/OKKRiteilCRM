/**
 * Проверка коннектора Claude на живых данных: проходит по всем инструментам и
 * печатает, что каждый ответил.
 *
 *   MCP_KEY=okk_… npx tsx --env-file=.env.local scripts/mcp-smoke.ts
 *   MCP_KEY=okk_… MCP_URL=https://okk.zmksoft.com/mcp/okk npx tsx scripts/mcp-smoke.ts
 *
 * Без MCP_URL обработчик вызывается прямо в этом процессе (нужен .env.local),
 * с MCP_URL — по сети, как это делает Claude.
 */
const KEY = process.env.MCP_KEY ?? '';
const URL_ = process.env.MCP_URL ?? '';

let nextId = 1;

async function send(body: unknown, key = KEY): Promise<{ status: number; json: any }> {
    const request = new Request(URL_ || 'http://localhost/mcp/okk', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2025-06-18',
            ...(key ? { 'X-Api-Key': key } : {}),
        },
        body: JSON.stringify(body),
    });
    const response = URL_ ? await fetch(request) : await (await import('../app/mcp/okk/route')).POST(request);
    const text = await response.text();
    let json: any = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = { raw: text.slice(0, 300) };
    }
    return { status: response.status, json };
}

async function call(name: string, args: Record<string, unknown> = {}) {
    const startedAt = Date.now();
    const { status, json } = await send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
    const text = json?.result?.content?.[0]?.text ?? JSON.stringify(json?.error ?? json);
    const failed = status !== 200 || json?.result?.isError || json?.error;
    let parsed: any = null;
    try {
        parsed = JSON.parse(text);
    } catch {
        /* текст ошибки */
    }
    console.log(`${failed ? '✗' : '✓'} ${name} ${JSON.stringify(args).slice(0, 110)} — ${Date.now() - startedAt} мс, ${text.length} зн.`);
    console.log(`    ${String(text).slice(0, 260).replace(/\s+/g, ' ')}`);
    return { failed: Boolean(failed), text, parsed };
}

async function main() {
    if (!KEY) throw new Error('Нужен ключ: MCP_KEY=okk_…');
    let bad = 0;
    const expectOk = (r: { failed: boolean }) => { if (r.failed) bad += 1; };
    const expectRefused = (r: { failed: boolean }, what: string) => {
        if (!r.failed) { bad += 1; console.log(`    !! ДОЛЖЕН БЫЛ ОТКАЗАТЬ: ${what}`); }
    };

    const noKey = await send({ jsonrpc: '2.0', id: nextId++, method: 'tools/list' }, '');
    console.log(`${noKey.status === 401 ? '✓' : '✗'} без ключа → ${noKey.status}`);
    if (noKey.status !== 401) bad += 1;
    const wrongKey = await send({ jsonrpc: '2.0', id: nextId++, method: 'tools/list' }, 'okk_wrong');
    console.log(`${wrongKey.status === 401 ? '✓' : '✗'} чужой ключ → ${wrongKey.status}`);
    if (wrongKey.status !== 401) bad += 1;

    const init = await send({
        jsonrpc: '2.0', id: nextId++, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-smoke', version: '1' } },
    });
    console.log(`${init.status === 200 ? '✓' : '✗'} initialize → ${init.status} ${JSON.stringify(init.json?.result?.serverInfo ?? init.json).slice(0, 120)}`);
    if (init.status !== 200) bad += 1;

    const tools = await send({ jsonrpc: '2.0', id: nextId++, method: 'tools/list' });
    const names: string[] = (tools.json?.result?.tools ?? []).map((t: any) => t.name);
    console.log(`${names.length === 13 ? '✓' : '✗'} tools/list → ${names.length}: ${names.join(', ')}`);
    if (names.length !== 13) bad += 1;

    expectOk(await call('list_sections'));
    expectOk(await call('describe_section', { section: 'orders' }));
    expectOk(await call('schema_lookup', { query: 'orders' }));
    expectOk(await call('schema_lookup', { query: 'оплат' }));

    const orders = await call('list_entities', { type: 'orders', limit: 3 });
    expectOk(orders);
    const order = orders.parsed?.items?.[0];
    if (order) {
        const card = await call('get_entity', { type: 'orders', id: order.id });
        expectOk(card);
        const files = card.parsed?.related?.find((r: any) => r.type === 'order_files');
        if (files) expectOk(await call('list_entities', { type: 'order_files', filters: files.filters, limit: 3 }));
        expectOk(await call('search', { query: String(order.number) }));
    }
    expectOk(await call('list_entities', {
        type: 'orders',
        filters: [{ field: 'totalsumm', op: 'gt', value: 100000 }],
        period: { field: 'created_at', from: '2026-10-01' },
        sort: { field: 'totalsumm', dir: 'desc' },
        fields: ['number', 'totalsumm', 'status', 'created_at'],
        limit: 5,
    }));

    const anyFile = await call('list_entities', { type: 'order_files', filters: [{ field: 'deleted_at', op: 'is_null' }], limit: 1 });
    expectOk(anyFile);
    const fileId = anyFile.parsed?.items?.[0]?.id;
    if (fileId) {
        const file = await call('get_file', { file: `order_files:${fileId}` });
        expectOk(file);
        const link = file.parsed?.download_url;
        if (link) {
            const got = await fetch(link, { method: 'GET', headers: { Range: 'bytes=0-15' } });
            console.log(`${got.ok ? '✓' : '✗'} ссылка на скачивание отвечает → ${got.status}`);
            if (!got.ok) bad += 1;
        }
    }

    expectOk(await call('list_knowledge_bases'));
    const found = await call('search_knowledge', { query: 'заказ', limit: 2 });
    expectOk(found);
    const article = found.parsed?.articles?.[0]?.id;
    if (article) expectOk(await call('get_article', { id: article }));

    const functions = await call('list_functions');
    expectOk(functions);
    for (const f of functions.parsed?.functions ?? []) {
        // Без параметров часть функций честно попросит их указать — это не сбой.
        // Сбой — когда функция упала сама: ошибка базы или таймаут.
        const r = await call('run_function', { name: f.name, params: {} });
        if (r.failed && /syntax|не выполнился|таймаут|timeout|exception/i.test(r.text)) {
            bad += 1;
            console.log('    !! ФУНКЦИЯ УПАЛА');
        }
    }

    expectOk(await call('run_query', { sql: 'select 1 as t, 2 as q' }));
    expectOk(await call('run_query', { sql: "select status, count(*) from orders where created_at >= now() - interval '30 days' group by 1 order by 2 desc limit 5" }));

    expectRefused(await call('run_query', { sql: "insert into mcp_section(key,title) values ('x','x')" }), 'INSERT');
    expectRefused(await call('run_query', { sql: "update orders set status = status where id = -1" }), 'UPDATE');
    expectRefused(await call('run_query', { sql: 'delete from mcp_call_log' }), 'DELETE');
    expectRefused(await call('run_query', { sql: 'drop table mcp_section' }), 'DDL');
    expectRefused(await call('run_query', { sql: 'select 1; select 2' }), 'цепочка через ;');
    expectRefused(await call('run_query', { sql: 'select * from pg_shadow' }), 'служебная таблица');
    expectRefused(await call('run_query', { sql: 'select * from auth.users' }), 'чужая схема');
    expectRefused(await call('run_query', { sql: "with x as (insert into mcp_section(key,title) values ('x','x') returning key) select * from x" }), 'запись внутри WITH');
    expectRefused(await call('run_function', { name: 'telegram_owner', params: { text: 'x' } }), 'функция с отправкой сообщения');
    expectRefused(await call('list_entities', { type: 'orders; drop table x' }), 'мусор вместо имени таблицы');

    console.log(bad === 0 ? '\nВсё в порядке.' : `\nНе в порядке: ${bad}.`);
    process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
