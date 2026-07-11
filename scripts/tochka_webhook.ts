/**
 * Управление вебхуком банка Точка через API (у Точки нет UI для вебхуков —
 * только API-метод по адресу webhook/{version}/{clientId}).
 *
 * У Точки вебхук подключается запросом к их API тем же JWT-токеном, что и остальной API.
 *
 * ENV:
 *   TOCHKA_JWT_TOKEN   — токен доступа (Bearer). Обязателен.
 *   TOCHKA_CLIENT_ID   — Client_ID приложения (из кабинета). Если не задан —
 *                        берётся из поля `iss` внутри токена.
 *   TOCHKA_API_BASE    — базовый URL (по умолчанию https://enter.tochka.com/uapi).
 *   TOCHKA_WEBHOOK_URL — наш адрес приёма (для команды set).
 *
 * Использование:
 *   npx tsx scripts/tochka_webhook.ts get
 *   npx tsx scripts/tochka_webhook.ts set https://okk.zmksoft.com/api/payments/tochka
 *   npx tsx scripts/tochka_webhook.ts test
 *   npx tsx scripts/tochka_webhook.ts delete
 *
 * ⚠️ Точный путь/имена полей сверьте с «Документация API» в кабинете Точки —
 * структура ниже основана на публичном описании их webhook-API.
 */

const API_VERSION = '1.0';
const WEBHOOK_TYPES = ['incomingPayment', 'incomingSbpPayment', 'incomingSbpB2BPayment'];

function decodeIssFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return json.iss || null;
  } catch {
    return null;
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const token = process.env.TOCHKA_JWT_TOKEN;
  if (!token) {
    console.error('❌ Нет TOCHKA_JWT_TOKEN в окружении.');
    process.exit(1);
  }

  const clientId = process.env.TOCHKA_CLIENT_ID || decodeIssFromToken(token);
  if (!clientId) {
    console.error('❌ Не удалось определить Client_ID (задайте TOCHKA_CLIENT_ID).');
    process.exit(1);
  }

  const base = (process.env.TOCHKA_API_BASE || 'https://enter.tochka.com/uapi').replace(/\/+$/, '');
  const url = `${base}/webhook/${API_VERSION}/${clientId}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const request = async (method: string, path = '', body?: unknown) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    console.log(`\n${method} ${url}${path} → ${res.status}`);
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      console.log(text);
    }
    return res.ok;
  };

  switch (cmd) {
    case 'get':
      await request('GET');
      break;
    case 'set': {
      const hookUrl = arg || process.env.TOCHKA_WEBHOOK_URL;
      if (!hookUrl) {
        console.error('❌ Укажите URL: npx tsx scripts/tochka_webhook.ts set https://<домен>/api/payments/tochka');
        process.exit(1);
      }
      console.log(`Подключаю вебхук ${hookUrl} на события: ${WEBHOOK_TYPES.join(', ')}`);
      await request('PUT', '', { webhooksList: WEBHOOK_TYPES, url: hookUrl });
      break;
    }
    case 'test':
      await request('POST', '/test_send', { webhookType: 'incomingPayment' });
      break;
    case 'delete':
      await request('DELETE');
      break;
    default:
      console.log('Команды: get | set <url> | test | delete');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
