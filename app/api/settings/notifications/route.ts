import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/utils/supabase';
import { listRoutes } from '@/lib/notify/route';
import { NOTIFY_TYPE_BY_CODE, TARGET_NAMES } from '@/lib/notify/catalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  const routes = await listRoutes();
  return NextResponse.json({
    routes: routes.map((r) => ({
      code: r.def.code,
      name: r.def.name,
      description: r.def.description,
      group: r.def.group,
      bot: r.def.bot,
      target: r.target,
      targetFixed: Boolean(r.def.targetFixed),
      chatId: r.chatId,
      threadId: r.threadId,
      enabled: r.enabled,
    })),
  });
}

const PatchSchema = z.object({
  code: z.string().min(1),
  target: z.enum(Object.keys(TARGET_NAMES) as [string, ...string[]]).optional(),
  chatId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Неверные данные' }, { status: 400 });
  }
  const { code, target, chatId, threadId, enabled } = parsed.data;
  const def = NOTIFY_TYPE_BY_CODE.get(code);
  if (!def) return NextResponse.json({ error: 'Неизвестный тип сообщения' }, { status: 400 });
  // Личное сообщение нельзя перенаправить в общий чат: это разослало бы чужое личное.
  if (def.targetFixed && target && target !== def.target) {
    return NextResponse.json({ error: 'У этого типа адресат не меняется' }, { status: 400 });
  }

  const { error } = await supabase.from('notification_routes').upsert(
    {
      code,
      target: target ?? def.target,
      chat_id: chatId ?? null,
      thread_id: threadId ?? null,
      enabled: enabled ?? true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'code' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
