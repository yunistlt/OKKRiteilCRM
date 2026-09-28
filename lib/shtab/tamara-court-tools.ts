// Суды глазами Тамары.
//
// Иск к юрлицу группы — это всегда деньги и репутация, и узнавать о нём из
// разговора с приставом поздно. Источник — письма «Электронного стража» самой
// картотеки: она подписана на ИНН наших юрлиц и присылает уведомления сама.
// Сайт kad.arbitr.ru мы не опрашиваем — его защита не пускает автоматику.
//
// Оба инструмента только читают. Тамара не называет дела, которого не вернул
// инструмент: чего нет в таблице — того для разговора не существует.
import { supabase } from '@/utils/supabase';
import { ownInns } from '@/lib/court/own-entities';

type ToolResult = Record<string, unknown>;

export const COURT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'court_cases',
      description:
        'Арбитражные дела юрлиц группы: номер, суд, стороны, наша роль (истец или ответчик), цена иска, последнее движение. Отвечает на «судятся ли с нами», «какие иски к нам», «что нового в судах». Данные приходят письмами картотеки арбитражных дел, а не опросом сайта.',
      parameters: {
        type: 'object',
        properties: {
          inn: { type: 'string', description: 'ИНН нашего юрлица, если интересует одно из них.' },
          role: { type: 'string', description: 'Наша сторона: «истец» или «ответчик».' },
          days: { type: 'integer', description: 'Только дела с движением за последние N дней.' },
          limit: { type: 'integer', description: 'Сколько дел вернуть, по умолчанию 50.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'court_case',
      description:
        'Одно дело целиком: карточка и все движения по датам, как они приходили из картотеки. Вызывай, когда владелец спрашивает про конкретное дело по его номеру.',
      parameters: {
        type: 'object',
        properties: {
          case_number: { type: 'string', description: 'Номер дела, например А55-12345/2026.' },
        },
        required: ['case_number'],
      },
    },
  },
];

export const COURT_TOOL_NAMES: ReadonlySet<string> = new Set<string>(COURT_TOOLS.map((t) => t.function.name));

function money(kopecks: number | null | undefined) {
  if (kopecks === null || kopecks === undefined) return null;
  return Number(kopecks) / 100;
}

export async function executeCourtTool(name: string, args: any): Promise<ToolResult> {
  if (name === 'court_cases') {
    let query = supabase
      .from('court_cases')
      .select('case_number, court_name, case_type, our_inn, our_role, plaintiff, defendant, amount_kopecks, registered_on, last_event_on, last_event, status, kad_url')
      .order('last_event_on', { ascending: false, nullsFirst: false })
      .limit(Math.min(200, Math.max(1, Number(args?.limit) || 50)));

    if (args?.inn) query = query.eq('our_inn', String(args.inn).replace(/\D/g, ''));
    if (args?.role) query = query.eq('our_role', String(args.role));
    if (Number.isFinite(Number(args?.days))) {
      const from = new Date();
      from.setDate(from.getDate() - Number(args.days));
      query = query.gte('last_event_on', from.toISOString().slice(0, 10));
    }

    const { data, error } = await query;
    if (error) return { available: false, reason: error.message };

    const rows = data || [];
    if (rows.length === 0) {
      // Пусто может значить две разные вещи, и их нельзя путать.
      const { count } = await supabase.from('court_cases').select('id', { count: 'exact', head: true });
      return {
        дел: 0,
        примечание:
          (count || 0) === 0
            ? 'В базе нет ни одного дела. Либо картотека ещё не присылала писем, либо подписка «Электронного стража» на наши ИНН не оформлена — это стоит проверить, прежде чем говорить «судов нет».'
            : 'По этому запросу дел нет, хотя в базе дела есть.',
        наши_юрлица_ИНН: ownInns(),
      };
    }

    return {
      дел: rows.length,
      источник: 'письма «Электронного стража» картотеки арбитражных дел',
      дела: rows.map((row: any) => ({
        номер: row.case_number,
        суд: row.court_name,
        вид: row.case_type,
        наша_роль: row.our_role,
        наш_ИНН: row.our_inn,
        истец: row.plaintiff,
        ответчик: row.defendant,
        цена_иска_руб: money(row.amount_kopecks),
        зарегистрировано: row.registered_on,
        последнее_движение: row.last_event_on,
        что_произошло: row.last_event,
        состояние: row.status === 'closed' ? 'закрыто' : 'идёт',
        карточка: row.kad_url,
      })),
    };
  }

  if (name === 'court_case') {
    const caseNumber = String(args?.case_number || '').trim();
    if (!caseNumber) return { available: false, reason: 'нужен номер дела' };

    const { data: caseRow, error } = await supabase
      .from('court_cases')
      .select('*')
      .eq('case_number', caseNumber)
      .maybeSingle();
    if (error) return { available: false, reason: error.message };
    if (!caseRow) return { available: false, reason: `дела ${caseNumber} в базе нет` };

    const { data: events } = await supabase
      .from('court_case_events')
      .select('event_on, event_text, doc_url, raw_excerpt')
      .eq('case_id', caseRow.id)
      .order('event_on', { ascending: false, nullsFirst: false })
      .limit(100);

    return {
      дело: {
        номер: caseRow.case_number,
        суд: caseRow.court_name,
        вид: caseRow.case_type,
        наша_роль: caseRow.our_role,
        истец: caseRow.plaintiff,
        ответчик: caseRow.defendant,
        цена_иска_руб: money(caseRow.amount_kopecks),
        зарегистрировано: caseRow.registered_on,
        состояние: caseRow.status === 'closed' ? 'закрыто' : 'идёт',
        карточка: caseRow.kad_url,
      },
      движения: (events || []).map((event: any) => ({
        дата: event.event_on,
        что_произошло: event.event_text,
        документ: event.doc_url,
        // Фрагмент письма — чтобы любое сказанное число раскладывалось до источника.
        фрагмент_письма: event.raw_excerpt,
      })),
    };
  }

  return { available: false, reason: `неизвестный инструмент ${name}` };
}
