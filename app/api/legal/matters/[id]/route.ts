// Карточка дела: чтение вместе с журналом, связями и документами; правка полей.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { writeLegalAudit } from '@/lib/legal-audit';
import { getMatterCard } from '@/lib/legal-matters/repo';
import { matterUpdateSchema } from '@/lib/legal-matters/types';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const card = await getMatterCard(Number(params.id));
    if (!card) return NextResponse.json({ error: 'Дело не найдено' }, { status: 404 });

    return NextResponse.json(card);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось открыть дело' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = matterUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте поля' }, { status: 400 });
    }

    // Закрытие дела фиксируем датой: без неё «закрыто» нельзя посчитать по периодам.
    const patch: Record<string, any> = { ...parsed.data, updated_at: new Date().toISOString() };
    if (patch.status === 'closed' && !patch.closed_on) patch.closed_on = new Date().toISOString().slice(0, 10);

    const { data: updated, error } = await supabase
      .from('legal_matters')
      .update(patch)
      .eq('id', Number(params.id))
      .select('*')
      .single();

    if (error) throw error;

    await writeLegalAudit({
      action: 'legal_matter_updated',
      entity: 'legal_matter',
      entityId: Number(params.id),
      performedBy: String(session.user.id),
      details: parsed.data,
    });

    return NextResponse.json({ matter: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось сохранить дело' }, { status: 500 });
  }
}
