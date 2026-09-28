// Слой доступа к делам: номер дела, чтение с последним действием, запись событий.
//
// Главное правило раздела: «последнее действие» нигде не хранится — оно всегда
// берётся из журнала. Поэтому список дел собирается вместе с последним событием,
// а не читает колонку, которая могла отстать от истории.
import { supabase } from '@/utils/supabase';
import { calcFinancialRisk, type RiskBreakdown } from './money';
import { evaluateDeadlines, type DeadlineState } from './deadlines';
import type { LegalMatter, LegalMatterEvent, LegalMatterLink, MatterStage } from './types';

export type MatterRow = LegalMatter & {
  last_event: LegalMatterEvent | null;
  risk: RiskBreakdown;
  deadlines: DeadlineState;
};

/**
 * Следующий номер дела в формате ГОД-ПОРЯДКОВЫЙ (2026-047).
 *
 * Нумерация сквозная внутри года и не переиспользует номера закрытых дел:
 * номер живёт в переписке и в судебных документах, повторно выдать его нельзя.
 */
export async function nextMatterNo(today = new Date()): Promise<string> {
  const year = today.getFullYear();
  const { data, error } = await supabase
    .from('legal_matters')
    .select('matter_no')
    .like('matter_no', `${year}-%`)
    .order('matter_no', { ascending: false })
    .limit(1);

  if (error) throw error;

  const last = data?.[0]?.matter_no as string | undefined;
  const lastSeq = last ? Number(String(last).split('-')[1]) : 0;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;

  return `${year}-${String(next).padStart(3, '0')}`;
}

/** Последнее событие по каждому делу — одним запросом на весь список. */
async function loadLastEvents(matterIds: number[]): Promise<Map<number, LegalMatterEvent>> {
  const result = new Map<number, LegalMatterEvent>();
  if (matterIds.length === 0) return result;

  const { data, error } = await supabase
    .from('legal_matter_events')
    .select('*')
    .in('matter_id', matterIds)
    .order('event_on', { ascending: false })
    .order('id', { ascending: false });

  if (error) throw error;

  for (const event of (data || []) as LegalMatterEvent[]) {
    const key = Number(event.matter_id);
    if (!result.has(key)) result.set(key, event);
  }

  return result;
}

function decorate(matter: LegalMatter, lastEvent: LegalMatterEvent | null): MatterRow {
  return {
    ...matter,
    last_event: lastEvent,
    risk: calcFinancialRisk(matter),
    deadlines: evaluateDeadlines(matter),
  };
}

export type MatterFilters = {
  stage?: string | null;
  status?: string | null;
  responsible?: string | null;
  side?: string | null;
  /** true — только незакрытые. По умолчанию показываем все. */
  openOnly?: boolean;
  search?: string | null;
};

export async function listMatters(filters: MatterFilters = {}): Promise<MatterRow[]> {
  let query = supabase.from('legal_matters').select('*').order('opened_on', { ascending: false }).limit(500);

  if (filters.stage) query = query.eq('stage', filters.stage);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.responsible) query = query.eq('responsible_user_id', filters.responsible);
  if (filters.side) query = query.eq('matter_side', filters.side);
  if (filters.openOnly) query = query.is('closed_on', null);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(`matter_no.ilike.${term},counterparty_name.ilike.${term},subject.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const matters = (data || []) as LegalMatter[];
  const lastEvents = await loadLastEvents(matters.map((row) => Number(row.id)));

  return matters.map((row) => decorate(row, lastEvents.get(Number(row.id)) || null));
}

export type MatterCard = {
  matter: MatterRow;
  events: LegalMatterEvent[];
  links: LegalMatterLink[];
  documents: any[];
  facts: any[];
};

export async function getMatterCard(id: number): Promise<MatterCard | null> {
  const { data: matter, error } = await supabase.from('legal_matters').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!matter) return null;

  const [{ data: events }, { data: links }, { data: documents }, { data: facts }] = await Promise.all([
    supabase.from('legal_matter_events').select('*').eq('matter_id', id).order('event_on', { ascending: false }).order('id', { ascending: false }),
    supabase.from('legal_matter_links').select('*').eq('matter_id', id),
    supabase.from('legal_matter_documents').select('*').eq('matter_id', id).order('created_at', { ascending: false }),
    supabase.from('legal_matter_field_facts').select('*').eq('matter_id', id).order('created_at', { ascending: false }),
  ]);

  const list = (events || []) as LegalMatterEvent[];

  return {
    matter: decorate(matter as LegalMatter, list[0] || null),
    events: list,
    links: (links || []) as LegalMatterLink[],
    documents: documents || [],
    facts: facts || [],
  };
}

/**
 * Записать событие в журнал.
 *
 * Событие может двигать дело: если пришла новая стадия или новое «следующее
 * действие», они применяются к делу здесь же — одним действием человека, а не
 * двумя. Смена стадии фиксируется в самом событии (stage_before/stage_after),
 * чтобы по журналу было видно, когда и почему дело перешло дальше.
 */
export async function addMatterEvent(input: {
  matter_id: number;
  event_on?: string;
  kind: string;
  title: string;
  description?: string | null;
  result?: string | null;
  document_id?: number | null;
  stage_after?: MatterStage | null;
  next_action?: string | null;
  next_action_due?: string | null;
  actor: string;
  source?: 'human' | 'bot' | 'import';
}) {
  const { data: matter, error: readError } = await supabase
    .from('legal_matters')
    .select('id, stage, status')
    .eq('id', input.matter_id)
    .maybeSingle();

  if (readError) throw readError;
  if (!matter) throw new Error('Дело не найдено');

  const stageBefore = String(matter.stage);
  const stageAfter = input.stage_after && input.stage_after !== stageBefore ? input.stage_after : null;

  const { data: event, error } = await supabase
    .from('legal_matter_events')
    .insert({
      matter_id: input.matter_id,
      event_on: input.event_on || new Date().toISOString().slice(0, 10),
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      result: input.result ?? null,
      document_id: input.document_id ?? null,
      stage_before: stageAfter ? stageBefore : null,
      stage_after: stageAfter,
      actor: input.actor,
      source: input.source || 'human',
    })
    .select('*')
    .single();

  if (error) throw error;

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (stageAfter) patch.stage = stageAfter;
  if (input.next_action !== undefined) patch.next_action = input.next_action;
  if (input.next_action_due !== undefined) patch.next_action_due = input.next_action_due;

  if (Object.keys(patch).length > 1) {
    const { error: updateError } = await supabase.from('legal_matters').update(patch).eq('id', input.matter_id);
    if (updateError) throw updateError;
  }

  return event as LegalMatterEvent;
}
