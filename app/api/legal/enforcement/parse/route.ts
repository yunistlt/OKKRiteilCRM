// «Разобрать документы» — ставит карточку в очередь разбора. Сам разбор в кроне.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { enforcementParseSchema } from '@/lib/legal-enforcement/types';
import { enqueueLegalEnforcementParseJob } from '@/lib/system-jobs';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = enforcementParseSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Нужен case_id' }, { status: 400 });
    }

    const caseId = parsed.data.case_id;

    const { count } = await supabase
      .from('legal_enforcement_documents')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .eq('upload_status', 'uploaded');

    if ((count || 0) === 0) {
      return NextResponse.json({ error: 'Нет загруженных документов — разбирать нечего' }, { status: 400 });
    }

    await supabase
      .from('legal_enforcement_cases')
      .update({ parse_status: 'queued', parse_error: null, updated_at: new Date().toISOString() })
      .eq('id', caseId);

    await enqueueLegalEnforcementParseJob(caseId);

    return NextResponse.json({ ok: true, status: 'queued' });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось поставить разбор' }, { status: 500 });
  }
}
