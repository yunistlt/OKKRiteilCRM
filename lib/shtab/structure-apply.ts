import { supabase } from '@/utils/supabase';
import { POST_COLUMNS, makesCycle } from '@/lib/shtab/structure';
import type { StructurePost } from '@/lib/shtab/structure';

// Сборка структуры по словам владельца: Тамара применяет операции пачкой.
//
// Почему ей вообще разрешено писать сюда, хотя минусы и проекты она не трогает.
// Реестр минусов — счётчик: по числу открытых минусов считается приоритетная
// область, и агент, который сам их заводит и закрывает, за месяц сделает этот
// счёт бессмысленным. Структура ничего не считает, она целиком описание —
// и продиктовать её быстрее, чем накликать. Ошибку видно на схеме сразу, и
// правится она там же.

export type StructureOp =
    | { op: 'create_post'; title: string; parent?: string | number | null; holder_person_id?: string; vkp?: string; duties?: string; statistic?: string }
    | { op: 'update_post'; post: string | number; title?: string; vkp?: string; duties?: string; statistic?: string }
    | { op: 'set_parent'; post: string | number; parent: string | number | null }
    | { op: 'set_holder'; post: string | number; holder_person_id: string | null; holder_name?: string };

export type ApplyOutcome = { op: string; ok: boolean; what: string };

const BLOCK_W = 270;
const BLOCK_H = 156;

/**
 * Место для нового блока: сетка по восемь в ряд.
 *
 * Раскладывать красиво тут не нужно и вредно — владелец всё равно растащит
 * схему под себя, а любая «умная» раскладка сдвинет и то, что он уже расставил.
 */
function nextSpot(existing: Array<{ pos_x: number; pos_y: number }>, addedCount: number): { x: number; y: number } {
    const n = existing.length + addedCount;
    return { x: 40 + (n % 8) * BLOCK_W, y: 40 + Math.floor(n / 8) * BLOCK_H };
}

/** Пост по номеру или по названию. Название — потому что Тамара говорит словами. */
function findPost(posts: StructurePost[], ref: string | number | null | undefined): StructurePost | null {
    if (ref === null || ref === undefined || ref === '') return null;
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
        return posts.find((p) => p.id === Number(ref)) ?? null;
    }
    const needle = String(ref).trim().toLowerCase();
    return (
        posts.find((p) => p.title.trim().toLowerCase() === needle) ??
        posts.find((p) => p.title.trim().toLowerCase().includes(needle)) ??
        null
    );
}

export async function applyStructureOps(
    ops: StructureOp[],
    people: Array<{ id: string; fio: string }>,
): Promise<{ results: ApplyOutcome[]; posts: StructurePost[] }> {
    const { data, error } = await supabase.from('shtab_post').select(POST_COLUMNS).order('ordinal').order('id');
    if (error) throw new Error(error.message);
    let posts = (data ?? []) as StructurePost[];

    const results: ApplyOutcome[] = [];
    let added = 0;

    const personName = (id: string | null | undefined): string =>
        people.find((p) => String(p.id) === String(id))?.fio ?? '';

    for (const op of ops) {
        try {
            if (op.op === 'create_post') {
                const title = (op.title ?? '').trim();
                if (!title) throw new Error('пустое название');
                // Пост с таким же названием не заводится повторно: диктовка
                // редко идёт с первого раза, и повтор команды не должен
                // удваивать схему.
                const already = posts.find((p) => p.title.trim().toLowerCase() === title.toLowerCase());
                if (already) {
                    results.push({ op: op.op, ok: false, what: `«${title}» уже есть — не заводила` });
                    continue;
                }
                const parent = findPost(posts, op.parent ?? null);
                const spot = nextSpot(posts, added);
                const holderName = op.holder_person_id ? personName(op.holder_person_id) : '';
                const { data: created, error: insError } = await supabase
                    .from('shtab_post')
                    .insert({
                        title,
                        parent_id: parent?.id ?? null,
                        holder_name: holderName,
                        external_uid: op.holder_person_id ? String(op.holder_person_id) : null,
                        vkp: op.vkp ?? '',
                        duties: op.duties ?? '',
                        statistic: op.statistic ?? '',
                        pos_x: spot.x,
                        pos_y: spot.y,
                        ordinal: posts.length + added,
                    })
                    .select(POST_COLUMNS)
                    .single();
                if (insError) throw new Error(insError.message);
                posts = [...posts, created as StructurePost];
                added += 1;
                results.push({
                    op: op.op,
                    ok: true,
                    what: `завела пост «${title}»${parent ? `, под «${parent.title}»` : ''}${holderName ? `, держит ${holderName}` : ''}`,
                });
                continue;
            }

            const target = findPost(posts, (op as any).post);
            if (!target) {
                results.push({ op: op.op, ok: false, what: `поста «${(op as any).post}» не нашла` });
                continue;
            }

            if (op.op === 'update_post') {
                const fields: Record<string, unknown> = {};
                if (op.title !== undefined) fields.title = op.title.trim();
                if (op.vkp !== undefined) fields.vkp = op.vkp;
                if (op.duties !== undefined) fields.duties = op.duties;
                if (op.statistic !== undefined) fields.statistic = op.statistic;
                if (Object.keys(fields).length === 0) {
                    results.push({ op: op.op, ok: false, what: 'нечего менять' });
                    continue;
                }
                const { error: updError } = await supabase.from('shtab_post').update(fields).eq('id', target.id);
                if (updError) throw new Error(updError.message);
                posts = posts.map((p) => (p.id === target.id ? ({ ...p, ...fields } as StructurePost) : p));
                results.push({ op: op.op, ok: true, what: `поправила «${target.title}»: ${Object.keys(fields).join(', ')}` });
                continue;
            }

            if (op.op === 'set_parent') {
                const parent = findPost(posts, op.parent);
                if (op.parent && !parent) {
                    results.push({ op: op.op, ok: false, what: `начальника «${op.parent}» не нашла` });
                    continue;
                }
                if (makesCycle(posts, target.id, parent?.id ?? null)) {
                    results.push({ op: op.op, ok: false, what: `«${target.title}» под «${parent?.title}» — получается кольцо` });
                    continue;
                }
                const { error: updError } = await supabase
                    .from('shtab_post')
                    .update({ parent_id: parent?.id ?? null })
                    .eq('id', target.id);
                if (updError) throw new Error(updError.message);
                posts = posts.map((p) => (p.id === target.id ? { ...p, parent_id: parent?.id ?? null } : p));
                results.push({
                    op: op.op,
                    ok: true,
                    what: parent ? `«${target.title}» теперь под «${parent.title}»` : `«${target.title}» вывела на верхний уровень`,
                });
                continue;
            }

            if (op.op === 'set_holder') {
                const id = op.holder_person_id ? String(op.holder_person_id) : null;
                // Фамилию берём из списка ЦехУспеха, а не из слов модели: имена
                // с источником в чужой системе не выдумываются.
                const name = id ? personName(id) : '';
                if (id && !name) {
                    results.push({ op: op.op, ok: false, what: `человека ${id} нет среди работающих` });
                    continue;
                }
                const { error: updError } = await supabase
                    .from('shtab_post')
                    .update({ external_uid: id, holder_name: name })
                    .eq('id', target.id);
                if (updError) throw new Error(updError.message);
                posts = posts.map((p) => (p.id === target.id ? { ...p, external_uid: id, holder_name: name } : p));
                results.push({ op: op.op, ok: true, what: id ? `на «${target.title}» посадила ${name}` : `«${target.title}» — вакансия` });
                continue;
            }

            results.push({ op: (op as any).op, ok: false, what: 'неизвестная операция' });
        } catch (e: any) {
            results.push({ op: (op as any).op ?? '?', ok: false, what: `не вышло: ${e.message}` });
        }
    }

    return { results, posts };
}
