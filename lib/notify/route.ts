/**
 * Разрешение адресата: тип сообщения → конкретный чат Telegram и бот.
 *
 * Правило одно: адресат — свойство ТИПА (catalog.ts), а не места в коде. Человек
 * переопределяет адресата в интерфейсе (/settings/notifications) — это строки
 * таблицы notification_routes; пустая таблица = дефолты каталога.
 *
 * Адреса чатов остаются там, где они уже живут (env и настройки бота-РОПа), чтобы
 * не заводить второй источник правды по chat_id.
 */
import { supabase } from '@/utils/supabase';
import { ownerTelegramChatId } from '@/lib/telegram';
import {
  NOTIFY_TYPES,
  notifyType,
  type NotifyBot,
  type NotifyTarget,
  type NotifyTypeDef,
} from './catalog';

export interface RouteOverride {
  code: string;
  target: NotifyTarget | null;
  /** Явный чат вместо адреса роли — когда нужен отдельный чат под один тип. */
  chatId: string | null;
  threadId: string | null;
  enabled: boolean;
}

/** Переопределения из БД. Таблицы ещё нет / БД недоступна — работаем на дефолтах. */
export async function loadRouteOverrides(): Promise<Map<string, RouteOverride>> {
  const { data, error } = await supabase
    .from('notification_routes')
    .select('code, target, chat_id, thread_id, enabled');
  if (error || !data) return new Map();
  return new Map(
    (data as any[]).map((r) => [
      String(r.code),
      {
        code: String(r.code),
        target: (r.target || null) as NotifyTarget | null,
        chatId: r.chat_id ? String(r.chat_id) : null,
        threadId: r.thread_id ? String(r.thread_id) : null,
        enabled: r.enabled !== false,
      },
    ]),
  );
}

/**
 * Адреса чатов остаются там, где уже живут: общий чат отдела — в настройках
 * бота-РОПа, личка владельца — через ownerTelegramChatId (один способ на всю
 * систему, чтобы адрес владельца не разъехался между местами).
 */
async function salesRopChats(): Promise<{ group: string; owner: string }> {
  const { data } = await supabase
    .from('sales_rop_settings')
    .select('key, value')
    .eq('key', 'telegram_chat_id')
    .maybeSingle();
  const owner = await ownerTelegramChatId().catch(() => '');
  return {
    group: String((data as any)?.value ?? '') || process.env.TELEGRAM_PAYMENTS_CHAT_ID || '',
    owner,
  };
}

export interface NotifyContext {
  /** Для manager_dm: чей это личный чат. */
  managerChatId?: string | null;
  /**
   * Нет личного чата — отдать в общий. Человек не должен остаться без работы
   * из-за того, что не написал боту; на личный разбор звонков это не распространяем.
   */
  fallbackToGroup?: boolean;
}

export interface ResolvedRoute {
  def: NotifyTypeDef;
  target: NotifyTarget;
  chatId: string | null;
  threadId: string | null;
  enabled: boolean;
  token: string | null;
}

function botToken(bot: NotifyBot): string | null {
  if (bot === 'igor') return process.env.TELEGRAM_BOT_TOKEN || null;
  if (bot === 'salary') return process.env.TELEGRAM_SALARY_BOT_TOKEN || process.env.TELEGRAM_PAYMENTS_BOT_TOKEN || null;
  return process.env.TELEGRAM_PAYMENTS_BOT_TOKEN || null;
}

/**
 * Куда и чем слать сообщение этого типа. chatId = null означает «адрес не настроен» —
 * вызывающий молча пропускает отправку (как и раньше при пустом env).
 */
export async function resolveRoute(code: string, ctx: NotifyContext = {}): Promise<ResolvedRoute> {
  const def = notifyType(code);
  const overrides = await loadRouteOverrides().catch(() => new Map<string, RouteOverride>());
  const ov = overrides.get(code);

  // Адресат, жёстко заданный природой сообщения (личный план — только этому человеку),
  // в интерфейсе не переопределяется: подменить его — значит разослать чужое личное.
  const target = def.targetFixed ? def.target : ov?.target || def.target;
  const enabled = ov?.enabled !== false;

  const chats = await salesRopChats().catch(() => ({ group: '', owner: '' }));
  let chatId: string | null = ov?.chatId || null;
  let threadId: string | null = ov?.threadId ?? null;

  if (!chatId) {
    if (target === 'group_sales') {
      chatId = chats.group || null;
      // Топик форума есть только у общего чата; в личке топиков нет.
      threadId = threadId ?? process.env.TELEGRAM_PAYMENTS_THREAD_ID ?? null;
    } else if (target === 'owner_dm') {
      chatId = chats.owner || null;
    } else if (target === 'manager_dm') {
      chatId = ctx.managerChatId || null;
      if (!chatId && ctx.fallbackToGroup) chatId = chats.group || null;
    } else if (target === 'project_stolyarka') {
      chatId = process.env.TELEGRAM_PROJECT_STOLYARKA_CHAT || null;
    } else if (target === 'project_consulting') {
      chatId = process.env.TELEGRAM_PROJECT_CONSULTING_CHAT || null;
    } else if (target === 'accounting') {
      // Получатели ведомости — свой список с ролями, живёт в accounting_delivery.
      chatId = null;
    }
  }
  if (target !== 'group_sales') threadId = ov?.threadId ?? null;

  return { def, target, chatId, threadId, enabled, token: botToken(def.bot) };
}

/** Все типы с текущим адресатом — для экрана настроек. */
export async function listRoutes(): Promise<
  Array<{ def: NotifyTypeDef; target: NotifyTarget; chatId: string | null; threadId: string | null; enabled: boolean }>
> {
  const overrides = await loadRouteOverrides().catch(() => new Map<string, RouteOverride>());
  return NOTIFY_TYPES.map((def) => {
    const ov = overrides.get(def.code);
    return {
      def,
      target: def.targetFixed ? def.target : ov?.target || def.target,
      chatId: ov?.chatId ?? null,
      threadId: ov?.threadId ?? null,
      enabled: ov?.enabled !== false,
    };
  });
}
