// Управление подпиской на вебхуки Точки через её API (UI у Точки для этого нет).
// Работает на сервере (Vercel), где есть TOCHKA_JWT_TOKEN и доступ к enter.tochka.com.

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

export function getTochkaWebhookConfig() {
  const token = process.env.TOCHKA_JWT_TOKEN;
  if (!token) throw new Error('TOCHKA_JWT_TOKEN не задан в окружении');
  const clientId = process.env.TOCHKA_CLIENT_ID || decodeIssFromToken(token);
  if (!clientId) throw new Error('Не удалось определить Client_ID (задайте TOCHKA_CLIENT_ID)');
  const base = (process.env.TOCHKA_API_BASE || 'https://enter.tochka.com/uapi').replace(/\/+$/, '');
  return { token, clientId, base, url: `${base}/webhook/${API_VERSION}/${clientId}` };
}

/** Наш адрес приёма вебхука (на который Точка будет слать платежи). */
export function getOurWebhookUrl(requestOrigin?: string | null): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || requestOrigin || 'https://okk.zmksoft.com';
  return `${base.replace(/\/+$/, '')}/api/payments/tochka`;
}

async function callTochka(method: string, path = '', body?: unknown) {
  const { url, token } = getTochkaWebhookConfig();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* оставляем как текст */
  }
  return { ok: res.ok, status: res.status, data };
}

/** Текущее состояние подписки на вебхуки. */
export async function getTochkaWebhooks() {
  return callTochka('GET');
}

/** Подписать наш URL на входящие платежи. */
export async function subscribeTochkaWebhook(webhookUrl: string) {
  return callTochka('PUT', '', { webhooksList: WEBHOOK_TYPES, url: webhookUrl });
}

/** Тестовая отправка вебхука самой Точкой (для проверки доставки). */
export async function testSendTochkaWebhook() {
  return callTochka('POST', '/test_send', { webhookType: 'incomingPayment' });
}
