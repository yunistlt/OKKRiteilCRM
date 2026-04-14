import { AppRole } from '@/lib/auth';
import { canAccessPathWithRules, DEFAULT_ROUTE_RULES, normalizeAllowedRoles, RouteRule } from '@/lib/rbac';

const RULES_CACHE_TTL_MS = 1000 * 30;

let cachedRules: RouteRule[] | null = null;
let cachedAt = 0;

function getSupabaseRestConfig() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    if (!url || !key) {
        throw new Error('RBAC route loader requires NEXT_PUBLIC_SUPABASE_URL and a Supabase key.');
    }

    return { url, key };
}

function isMissingTableError(error: any) {
    return Boolean(
        error?.code === '42P01' ||
        error?.message?.includes('relation') ||
        error?.message?.includes('access_route_rules')
    );
}

export async function getEffectiveRouteRules(): Promise<RouteRule[]> {
    if (cachedRules && Date.now() - cachedAt < RULES_CACHE_TTL_MS) {
        return cachedRules;
    }

    try {
        const { url, key } = getSupabaseRestConfig();
        const response = await fetch(
            `${url}/rest/v1/access_route_rules?select=prefix,label,description,category,allowed_roles&order=prefix.asc`,
            {
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                next: { revalidate: 30 },
            }
        );

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => null);
            const error = {
                code: errorPayload?.code,
                message: errorPayload?.message || `Failed to load access route rules (${response.status})`,
            };

            if (isMissingTableError(error)) {
                cachedRules = DEFAULT_ROUTE_RULES;
                cachedAt = Date.now();
                return DEFAULT_ROUTE_RULES;
            }

            throw error;
        }

        const data = await response.json();

        const overrides = new Map<string, RouteRule>(
            (data || []).map((item: any) => [
                item.prefix,
                {
                    prefix: item.prefix,
                    label: item.label || item.prefix,
                    description: item.description || '',
                    category: item.category || 'Доступ',
                    allowed: normalizeAllowedRoles(item.allowed_roles),
                } satisfies RouteRule,
            ])
        );

        const merged = DEFAULT_ROUTE_RULES.map((rule) => overrides.get(rule.prefix) || rule);
        const extraRules = Array.from(overrides.values()).filter((rule) => !DEFAULT_ROUTE_RULES.some((defaultRule) => defaultRule.prefix === rule.prefix));

        cachedRules = [...merged, ...extraRules];
        cachedAt = Date.now();
        return cachedRules;
    } catch (error) {
        console.error('[RBAC] Failed to load route rules:', error);
        cachedRules = DEFAULT_ROUTE_RULES;
        cachedAt = Date.now();
        return DEFAULT_ROUTE_RULES;
    }
}

export async function canAccessPathServer(role: AppRole | null | undefined, pathname: string): Promise<boolean> {
    const rules = await getEffectiveRouteRules();
    return canAccessPathWithRules(role, pathname, rules);
}

export function clearRouteRulesCache() {
    cachedRules = null;
    cachedAt = 0;
}