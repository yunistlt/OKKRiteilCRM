// Запись дел и движений в базу. Письмо стража идемпотентно: повторный разбор
// того же письма не плодит движения (уникальный индекс дело+письмо+текст).
import { supabase } from '@/utils/supabase';
import { isOurInn, ownInns } from './own-entities';
import type { StrajCase } from './straj-parser';

export type StoreOutcome = {
  case_number: string;
  created: boolean;
  event_added: boolean;
};

/** Чьё это дело и на какой мы стороне — по ИНН, упомянутым в письме. */
function resolveOurSide(item: StrajCase): { our_inn: string | null; our_role: string } {
  const ourInn = item.mentioned_inns.find((inn) => isOurInn(inn)) || null;

  const plaintiff = String(item.plaintiff || '');
  const defendant = String(item.defendant || '');
  const ourNumbers = ownInns();

  if (ourNumbers.some((inn) => plaintiff.includes(inn))) return { our_inn: ourInn, our_role: 'истец' };
  if (ourNumbers.some((inn) => defendant.includes(inn))) return { our_inn: ourInn, our_role: 'ответчик' };

  return { our_inn: ourInn, our_role: 'не определено' };
}

export async function storeStrajCases(params: {
  cases: StrajCase[];
  emailId?: number | null;
}): Promise<StoreOutcome[]> {
  const outcomes: StoreOutcome[] = [];

  for (const item of params.cases) {
    const side = resolveOurSide(item);

    const { data: existing } = await supabase
      .from('court_cases')
      .select('id, our_inn, our_role, kad_url, court_name, plaintiff, defendant, registered_on')
      .eq('case_number', item.case_number)
      .maybeSingle();

    let caseId: number;
    let created = false;

    if (existing) {
      caseId = Number(existing.id);
      // Дополняем пустые поля, уже известное не перетираем: письмо о заседании
      // короче письма о возбуждении, и затирать им стороны нельзя.
      const patch: Record<string, any> = {
        last_event_on: item.event_on,
        last_event: item.event_text,
        updated_at: new Date().toISOString(),
      };
      if (!existing.kad_url && item.kad_url) patch.kad_url = item.kad_url;
      if (!existing.court_name && item.court_name) patch.court_name = item.court_name;
      if (!existing.plaintiff && item.plaintiff) patch.plaintiff = item.plaintiff;
      if (!existing.defendant && item.defendant) patch.defendant = item.defendant;
      if (!existing.registered_on && item.registered_on) patch.registered_on = item.registered_on;
      if (!existing.our_inn && side.our_inn) patch.our_inn = side.our_inn;
      if ((!existing.our_role || existing.our_role === 'не определено') && side.our_role !== 'не определено') {
        patch.our_role = side.our_role;
      }

      await supabase.from('court_cases').update(patch).eq('id', caseId);
    } else {
      const { data: inserted, error } = await supabase
        .from('court_cases')
        .insert({
          case_number: item.case_number,
          kad_url: item.kad_url,
          court_name: item.court_name,
          case_type: item.case_type,
          our_inn: side.our_inn,
          our_role: side.our_role,
          plaintiff: item.plaintiff,
          defendant: item.defendant,
          amount_kopecks: item.amount_kopecks,
          registered_on: item.registered_on,
          last_event_on: item.event_on,
          last_event: item.event_text,
        })
        .select('id')
        .single();
      if (error) throw error;
      caseId = Number(inserted.id);
      created = true;
    }

    const { error: eventError } = await supabase.from('court_case_events').insert({
      case_id: caseId,
      event_on: item.event_on,
      event_text: item.event_text,
      doc_url: item.doc_url,
      email_id: params.emailId ?? null,
      raw_excerpt: item.raw_excerpt,
    });

    // 23505 — тот же факт из того же письма уже записан, это норма при повторе.
    const duplicate = eventError && String((eventError as any).code) === '23505';
    if (eventError && !duplicate) throw eventError;

    outcomes.push({ case_number: item.case_number, created, event_added: !duplicate });
  }

  return outcomes;
}
