/**
 * Единственная точка отправки уведомлений в Telegram.
 *
 * Отправитель называет ТИП сообщения, а не чат: «оплата поступила», «сбой конвейера».
 * Куда это уедет, решает маршрут (route.ts) — поэтому правка адресата одного типа
 * не может увести куда-то ещё сообщения другого типа.
 */
import { resolveRoute, type NotifyContext } from './route';
import { deliverToConsultantChat } from './consultant-chat';

/** Телеграм не принимает больше 4096 символов — длинный план режем по строкам. */
export function splitForTelegram(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if (buf.length + line.length + 1 > limit && buf) {
      parts.push(buf);
      buf = '';
    }
    buf = buf ? `${buf}\n${line}` : line;
  }
  if (buf) parts.push(buf);
  return parts;
}

export interface SendResult {
  /** Куда ушло: чат с Семёном в CRM или Telegram. */
  channel?: 'consultant_chat' | 'telegram';
  sent: boolean;
  /** Почему не отправлено: выключено человеком, нет адреса, нет токена бота. */
  skipped?: 'disabled' | 'no_chat' | 'no_token';
  chatId?: string;
  messageId?: number;
}

export async function sendNotification(
  code: string,
  text: string,
  ctx: NotifyContext = {},
): Promise<SendResult> {
  // Личные сообщения менеджеру — в чат с Семёном: советы нужны там, где человек
  // работает, а не в соседнем мессенджере (требование владельца 01.10.2026).
  // Telegram остаётся запасным путём: не нашли учётку — письмо уходит как раньше.
  if (ctx.managerId) {
    const delivered = await deliverToConsultantChat({
      managerId: ctx.managerId,
      text,
      kind: code,
    }).catch(() => false);

    if (delivered) return { sent: true, channel: 'consultant_chat' };
  }

  const route = await resolveRoute(code, ctx);
  if (!route.enabled) return { sent: false, skipped: 'disabled' };
  if (!route.token) return { sent: false, skipped: 'no_token' };
  if (!route.chatId) return { sent: false, skipped: 'no_chat' };

  let messageId: number | undefined;
  // Длинный текст уходит несколькими сообщениями подряд: обрезать список задач
  // нельзя — пропавшая строка это несделанная работа.
  for (const chunk of splitForTelegram(text)) {
    const body: Record<string, unknown> = {
      chat_id: route.chatId,
      text: chunk,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (route.threadId) body.message_thread_id = Number(route.threadId);

    const res = await fetch(`https://api.telegram.org/bot${route.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Telegram ${code} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    messageId = await res
      .json()
      .then((j: any) => Number(j?.result?.message_id) || messageId)
      .catch(() => messageId);
  }
  return { sent: true, chatId: route.chatId, messageId };
}
