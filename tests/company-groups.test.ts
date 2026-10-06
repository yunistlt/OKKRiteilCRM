/**
 * Группа компаний: несколько юрлиц одного покупателя — один клиент.
 *
 * Решение владельца 06.10.2026. Повод: «КлинПрофи» (Беларусь) разошлась на
 * четыре карточки с 13 сделками, и заказ 54532 засчитался как вторая покупка
 * вместо тринадцатой — у белорусов нет ИНН, по которому склеиваются карточки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: { members: any[]; groups: any[] } = { members: [], groups: [] };

vi.mock('@/utils/supabase', () => {
    const table = (name: string) => {
        const rows = () => (name === 'company_group_members' ? state.members : name === 'company_groups' ? state.groups : []);
        const q: any = {
            _filters: [] as Array<(r: any) => boolean>,
            select() { return q; },
            eq(col: string, val: any) { q._filters.push((r: any) => String(r[col]) === String(val)); return q; },
            in(col: string, vals: any[]) { q._filters.push((r: any) => vals.map(String).includes(String(r[col]))); return q; },
            ilike() { return q; },
            limit() { return q; },
            is() { return q; },
            maybeSingle() {
                const found = rows().filter((r: any) => q._filters.every((f: any) => f(r)));
                return Promise.resolve({ data: found[0] ?? null, error: null });
            },
            delete() {
                // Фильтры у PostgREST навешиваются ПОСЛЕ delete(), поэтому
                // удаляем только когда их задали.
                return {
                    eq(col: string, val: any) {
                        const keep = rows().filter((r: any) => String(r[col]) !== String(val));
                        if (name === 'company_group_members') state.members = keep; else state.groups = keep;
                        return Promise.resolve({ error: null });
                    },
                };
            },
            upsert(row: any) {
                state.members = state.members.filter((m) => String(m.client_id) !== String(row.client_id));
                state.members.push(row);
                return Promise.resolve({ error: null });
            },
            insert(row: any) {
                const created = { id: state.groups.length + 1, ...row };
                state.groups.push(created);
                return { select: () => ({ maybeSingle: () => Promise.resolve({ data: created, error: null }) }) };
            },
            then(res: any) {
                return res({ data: rows().filter((r: any) => q._filters.every((f: any) => f(r))), error: null });
            },
        };
        return q;
    };
    return { supabase: { from: table } };
});

beforeEach(() => { state.members = []; state.groups = []; });

describe('группа компаний', () => {
    it('карточка состоит максимум в одной группе', async () => {
        const { addToGroup } = await import('../lib/own-crm/company-groups');

        await addToGroup(1, 70310, 'ирина');
        await addToGroup(2, 70310, 'ирина');

        // Иначе «кто покупатель» перестаёт быть однозначным и расчёты разъедутся.
        expect(state.members.filter((m) => String(m.client_id) === '70310')).toHaveLength(1);
        expect(state.members[0].group_id).toBe(2);
    });

    it('выход из группы убирает только свою карточку', async () => {
        const { addToGroup, removeFromGroup } = await import('../lib/own-crm/company-groups');

        await addToGroup(1, 70310, null);
        await addToGroup(1, 47912, null);
        await removeFromGroup(70310);

        expect(state.members.map((m) => m.client_id)).toEqual([47912]);
    });
});
