// Журнал дела: одно действие человека = одна запись.
// Здесь же двигается стадия и «следующее действие» — чтобы юрист не заполнял
// одно и то же в двух местах и журнал не расходился с карточкой.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { writeLegalAudit } from '@/lib/legal-audit';
import { addMatterEvent } from '@/lib/legal-matters/repo';
import { matterEventSchema } from '@/lib/legal-matters/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = matterEventSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте поля' }, { status: 400 });
    }

    const event = await addMatterEvent({
      ...parsed.data,
      actor: String(session.user.id),
      source: 'human',
    });

    await writeLegalAudit({
      action: 'legal_matter_event_added',
      entity: 'legal_matter',
      entityId: parsed.data.matter_id,
      performedBy: String(session.user.id),
      details: { kind: parsed.data.kind, title: parsed.data.title, stage_after: parsed.data.stage_after ?? null },
    });

    return NextResponse.json({ event });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось записать событие' }, { status: 500 });
  }
}
