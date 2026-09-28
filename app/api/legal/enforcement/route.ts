// Список исполнительных производств и создание карточки.
// Человек заводит карточку минимумом полей — остальное достаёт бот из документов.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { enforcementCaseCreateSchema } from '@/lib/legal-enforcement/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = supabase
      .from('legal_enforcement_cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (status) query = query.eq('status', status);

    const { data: cases, error } = await query;
    if (error) throw error;

    const ids = (cases || []).map((row: any) => row.id);
    const pending = new Map<number, number>();
    const documents = new Map<number, number>();

    if (ids.length > 0) {
      const [{ data: facts }, { data: docs }] = await Promise.all([
        supabase
          .from('legal_enforcement_field_facts')
          .select('case_id')
          .eq('state', 'suggested')
          .in('case_id', ids),
        supabase.from('legal_enforcement_documents').select('case_id').in('case_id', ids),
      ]);

      for (const fact of facts || []) {
        pending.set(Number(fact.case_id), (pending.get(Number(fact.case_id)) || 0) + 1);
      }
      for (const doc of docs || []) {
        documents.set(Number(doc.case_id), (documents.get(Number(doc.case_id)) || 0) + 1);
      }
    }

    return NextResponse.json({
      cases: (cases || []).map((row: any) => ({
        ...row,
        pending_facts: pending.get(Number(row.id)) || 0,
        documents_count: documents.get(Number(row.id)) || 0,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось получить список' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = enforcementCaseCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте поля' }, { status: 400 });
    }

    const { data: created, error } = await supabase
      .from('legal_enforcement_cases')
      .insert({ ...parsed.data, status: 'docs_uploaded', created_by: session.user.id })
      .select('*')
      .single();
    if (error) throw error;

    await supabase.from('legal_audit_log').insert({
      action: 'legal_enforcement_case_created',
      entity: 'legal_enforcement_case',
      entity_id: created.id,
      performed_by: session.user.id,
      details: parsed.data,
    });

    return NextResponse.json({ case: created });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось создать карточку' }, { status: 500 });
  }
}
