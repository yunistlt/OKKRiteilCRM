import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import type { GoalKind, ShtabProject, ShtabRazbor, ShtabResource, ShtabState } from '@/lib/shtab/types';
import { GOAL_KINDS } from '@/lib/shtab/types';

export const dynamic = 'force-dynamic';

// GET /api/shtab/state — всё состояние Штаба одним запросом.
// Страница грузится целиком: реестр минусов — это десятки строк, разборы —
// единицы, дробить на отдельные вызовы нечего.
// Доступ: RBAC /api/shtab → только admin.

type ResourceRow = { razbor_id: number; ordinal: number; missing: string; available: string[] | null };
type LinkRow = { razbor_id: number; minus_id: number };
type ProjectRow = ShtabProject;

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const [areasRes, minusesRes, razboryRes, goalsRes, postsRes] = await Promise.all([
            supabase.from('shtab_area').select('code, title, ordinal').order('ordinal'),
            supabase
                .from('shtab_minus')
                .select('id, text, area_code, source, occurred_on, done')
                .order('done')
                .order('id'),
            supabase
                .from('shtab_razbor')
                .select(
                    'id, area_code, status, minus_id, situation, why, check_inside, check_res, check_relief, goal_fix, goal_grow, strategy, created_at',
                )
                .order('created_at', { ascending: false }),
            supabase.from('shtab_goal').select('kind, text'),
            supabase
                .from('shtab_post')
                .select('id, title, area_code, ideal_scene, statistic, holder_name, ordinal')
                .order('ordinal')
                .order('id'),
        ]);

        const failed = [areasRes, minusesRes, razboryRes, goalsRes, postsRes].find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);

        const razborRows = razboryRes.data ?? [];

        // Ресурсы забираются одним запросом на все разборы, а не по одному на разбор:
        // разборов немного, но N+1 на ровном месте заводить незачем.
        let resources: ResourceRow[] = [];
        let links: LinkRow[] = [];
        let projects: ProjectRow[] = [];
        if (razborRows.length > 0) {
            const ids = razborRows.map((r: { id: number }) => r.id);
            const [resRes, linkRes, projRes] = await Promise.all([
                supabase
                    .from('shtab_resource')
                    .select('razbor_id, ordinal, missing, available')
                    .in('razbor_id', ids)
                    .order('ordinal'),
                supabase.from('shtab_razbor_minus').select('razbor_id, minus_id').in('razbor_id', ids),
                supabase
                    .from('shtab_project')
                    .select('id, razbor_id, ordinal, title, owner_name, due_on, status, note')
                    .in('razbor_id', ids)
                    .order('ordinal')
                    .order('id'),
            ]);
            const bad = [resRes, linkRes, projRes].find((r) => r.error);
            if (bad?.error) throw new Error(bad.error.message);
            resources = (resRes.data ?? []) as ResourceRow[];
            links = (linkRes.data ?? []) as LinkRow[];
            projects = (projRes.data ?? []) as ProjectRow[];
        }

        const linksByRazbor = new Map<number, number[]>();
        for (const row of links) {
            const list = linksByRazbor.get(row.razbor_id) ?? [];
            list.push(row.minus_id);
            linksByRazbor.set(row.razbor_id, list);
        }

        const projectsByRazbor = new Map<number, ProjectRow[]>();
        for (const row of projects) {
            const list = projectsByRazbor.get(row.razbor_id) ?? [];
            list.push(row);
            projectsByRazbor.set(row.razbor_id, list);
        }

        const byRazbor = new Map<number, ShtabResource[]>();
        for (const row of resources) {
            const list = byRazbor.get(row.razbor_id) ?? [];
            list.push({ ordinal: row.ordinal, missing: row.missing, available: row.available ?? [] });
            byRazbor.set(row.razbor_id, list);
        }

        const goals = Object.fromEntries(GOAL_KINDS.map((k) => [k, ''])) as Record<GoalKind, string>;
        for (const row of goalsRes.data ?? []) {
            if (GOAL_KINDS.includes(row.kind as GoalKind)) goals[row.kind as GoalKind] = row.text ?? '';
        }

        const state: ShtabState = {
            areas: areasRes.data ?? [],
            minuses: (minusesRes.data ?? []) as ShtabState['minuses'],
            razbory: razborRows.map((r: { id: number }) => ({
                ...r,
                resources: byRazbor.get(r.id) ?? [],
                closes_minus_ids: linksByRazbor.get(r.id) ?? [],
                projects: projectsByRazbor.get(r.id) ?? [],
            })) as ShtabRazbor[],
            posts: (postsRes.data ?? []) as ShtabState['posts'],
            goals,
        };

        return NextResponse.json(state);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
