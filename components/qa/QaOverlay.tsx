'use client';

/**
 * Режим тестировщика: плавающая панель, которая гоняет проверки вёрстки
 * (`lib/ui-audit/checks.ts`) прямо на открытом экране, обводит проблемные
 * элементы и водит по реестру экранов.
 *
 * Включается: `?qa=1` в адресе, либо со страницы /settings/qa (запоминается в
 * localStorage). Выключается кнопкой в панели. Никакой логики приложения не
 * трогает — только читает DOM.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { runUiChecks, UI_CHECK_TITLES, type UiCheckCode, type UiFinding } from '@/lib/ui-audit/checks';
import { UI_AUDIT_SCREENS } from '@/lib/ui-audit/screens';

const STORAGE_KEY = 'okk_qa_mode';
const MOBILE_WIDTH = 768;

export function isQaModeEnabled(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function setQaModeEnabled(on: boolean) {
    try {
        if (on) localStorage.setItem(STORAGE_KEY, '1');
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* приватный режим — просто не запомним */
    }
}

type Group = { code: UiCheckCode; items: UiFinding[]; errors: number };

export default function QaOverlay() {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [enabled, setEnabled] = useState(false);
    const [findings, setFindings] = useState<UiFinding[]>([]);
    const [truncated, setTruncated] = useState<Record<string, number>>({});
    const [ranAt, setRanAt] = useState<string | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [showShell, setShowShell] = useState(false);
    const [openCode, setOpenCode] = useState<UiCheckCode | null>(null);
    const [outlined, setOutlined] = useState<UiFinding[]>([]);
    const [collapsed, setCollapsed] = useState(false);
    const timer = useRef<number | null>(null);

    // Включение по ?qa=1 или по запомненному флагу.
    useEffect(() => {
        const fromQuery = searchParams?.get('qa') === '1';
        if (fromQuery) setQaModeEnabled(true);
        setEnabled(fromQuery || isQaModeEnabled());
    }, [searchParams]);

    const run = useCallback(() => {
        const mobile = window.innerWidth < MOBILE_WIDTH;
        const result = runUiChecks({ mobile, perRuleLimit: 40 });
        setFindings(result.findings);
        setTruncated(result.truncated as Record<string, number>);
        setSize({ w: window.innerWidth, h: window.innerHeight });
        setRanAt(new Date().toLocaleTimeString('ru-RU'));
        setOutlined([]);
    }, []);

    // Перепроверка при смене экрана и после того, как данные догрузились.
    useEffect(() => {
        if (!enabled) return;
        const t1 = window.setTimeout(run, 600);
        const t2 = window.setTimeout(run, 2500);
        return () => {
            window.clearTimeout(t1);
            window.clearTimeout(t2);
        };
    }, [enabled, pathname, run]);

    useEffect(() => {
        if (!enabled) return;
        const onResize = () => {
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(run, 400);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [enabled, run]);

    const visibleFindings = useMemo(() => findings.filter((f) => showShell || f.zone === 'page'), [findings, showShell]);
    const shellCount = useMemo(() => findings.filter((f) => f.zone !== 'page').length, [findings]);

    const groups = useMemo<Group[]>(() => {
        const map = new Map<UiCheckCode, UiFinding[]>();
        for (const f of visibleFindings) map.set(f.code, [...(map.get(f.code) || []), f]);
        return Array.from(map.entries())
            .map(([code, items]) => ({ code, items, errors: items.filter((i) => i.severity === 'error').length }))
            .sort((a, b) => b.errors - a.errors || b.items.length - a.items.length);
    }, [visibleFindings]);

    const errors = visibleFindings.filter((f) => f.severity === 'error').length;
    const warns = visibleFindings.length - errors;

    const screenIndex = UI_AUDIT_SCREENS.findIndex((s) => s.path === pathname && !s.skip);
    const nextScreen = UI_AUDIT_SCREENS.slice(screenIndex + 1).find((s) => !s.skip && !s.public && !s.steps);
    const prevScreen = UI_AUDIT_SCREENS.slice(0, Math.max(screenIndex, 0)).reverse().find((s) => !s.skip && !s.public && !s.steps);

    const focusFinding = (f: UiFinding) => {
        const el = document.querySelector(f.selector);
        if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
        window.setTimeout(() => {
            const r = el?.getBoundingClientRect();
            setOutlined([r ? { ...f, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } } : f]);
        }, 50);
    };

    const disable = () => {
        setQaModeEnabled(false);
        setEnabled(false);
        setOutlined([]);
        if (searchParams?.get('qa') === '1') router.replace(pathname);
    };

    if (!enabled) return null;

    const colorFor = (s: UiFinding['severity']) => (s === 'error' ? '#dc2626' : '#a16207');

    return (
        <div data-ui-audit-overlay="1">
            {/* Обводки проблемных элементов */}
            {outlined.map((f, i) => (
                <div
                    key={i}
                    style={{
                        position: 'fixed',
                        left: f.rect.x,
                        top: f.rect.y,
                        width: f.rect.w,
                        height: f.rect.h,
                        outline: `3px solid ${colorFor(f.severity)}`,
                        outlineOffset: -1,
                        pointerEvents: 'none',
                        zIndex: 9998,
                    }}
                >
                    <span
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: -18,
                            background: colorFor(f.severity),
                            color: '#fff',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 4px',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {UI_CHECK_TITLES[f.code]}
                    </span>
                </div>
            ))}

            {/* Панель */}
            <div
                style={{
                    position: 'fixed',
                    left: 8,
                    bottom: 8,
                    zIndex: 9999,
                    width: collapsed ? 'auto' : 380,
                    maxWidth: 'calc(100vw - 16px)',
                    maxHeight: collapsed ? 'auto' : 'min(70vh, 640px)',
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#0f172a',
                    color: '#f1f5f9',
                    border: '1px solid #334155',
                    font: '12px/1.4 -apple-system, system-ui, sans-serif',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: collapsed ? 'none' : '1px solid #334155' }}>
                    <b style={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: 11 }}>Тестировщик</b>
                    <span style={{ color: errors ? '#f87171' : '#4ade80', fontWeight: 700 }}>{errors} ош.</span>
                    <span style={{ color: '#fbbf24', fontWeight: 700 }}>{warns} зам.</span>
                    <span style={{ color: '#94a3b8', marginLeft: 'auto' }}>
                        {size.w}×{size.h}
                    </span>
                    <button type="button" onClick={() => setCollapsed((v) => !v)} style={btn} title={collapsed ? 'Развернуть' : 'Свернуть'}>
                        {collapsed ? '▲' : '▼'}
                    </button>
                    <button type="button" onClick={disable} style={btn} title="Выключить режим тестировщика">
                        ✕
                    </button>
                </div>

                {!collapsed && (
                    <>
                        <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid #334155', flexWrap: 'wrap' }}>
                            <button type="button" onClick={run} style={btnPrimary}>
                                Проверить снова
                            </button>
                            <button type="button" onClick={() => setOutlined(visibleFindings)} style={btn}>
                                Обвести все
                            </button>
                            <button type="button" onClick={() => setOutlined([])} style={btn}>
                                Снять обводку
                            </button>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8', marginLeft: 'auto' }}>
                                <input type="checkbox" checked={showShell} onChange={(e) => setShowShell(e.target.checked)} />
                                оболочка ({shellCount})
                            </label>
                        </div>

                        <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
                            {groups.length === 0 && (
                                <div style={{ padding: 12, color: '#4ade80' }}>Замечаний нет{ranAt ? ` · ${ranAt}` : ''}</div>
                            )}
                            {groups.map((g) => (
                                <div key={g.code} style={{ borderBottom: '1px solid #1e293b' }}>
                                    <button
                                        type="button"
                                        onClick={() => setOpenCode((c) => (c === g.code ? null : g.code))}
                                        style={{ ...rowBtn, color: g.errors ? '#f87171' : '#fbbf24' }}
                                    >
                                        <span>{UI_CHECK_TITLES[g.code]}</span>
                                        <span style={{ marginLeft: 'auto', color: '#94a3b8' }}>
                                            {g.items.length}
                                            {truncated[g.code] ? `+${truncated[g.code]}` : ''}
                                        </span>
                                    </button>
                                    {openCode === g.code && (
                                        <div style={{ background: '#111827' }}>
                                            {g.items.map((f, i) => (
                                                <button key={i} type="button" onClick={() => focusFinding(f)} style={{ ...rowBtn, display: 'block', textAlign: 'left', padding: '4px 8px 4px 16px' }}>
                                                    <div style={{ color: '#e2e8f0' }}>{f.message}</div>
                                                    <div style={{ color: '#64748b', fontSize: 11 }}>
                                                        {f.element}
                                                        {f.zone !== 'page' ? ` · ${f.zone}` : ''}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderTop: '1px solid #334155', alignItems: 'center' }}>
                            <button type="button" disabled={!prevScreen} onClick={() => prevScreen && router.push(prevScreen.path)} style={btn}>
                                ← Пред.
                            </button>
                            <span style={{ color: '#94a3b8', flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {screenIndex >= 0 ? `${screenIndex + 1}/${UI_AUDIT_SCREENS.length} · ${UI_AUDIT_SCREENS[screenIndex].title}` : 'экран вне реестра'}
                            </span>
                            <button type="button" disabled={!nextScreen} onClick={() => nextScreen && router.push(nextScreen.path)} style={btn}>
                                След. →
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

const btn: React.CSSProperties = {
    background: 'transparent',
    color: '#e2e8f0',
    border: '1px solid #475569',
    padding: '3px 8px',
    font: 'inherit',
    cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = { ...btn, background: '#2563eb', borderColor: '#2563eb', color: '#fff', fontWeight: 700 };
const rowBtn: React.CSSProperties = {
    display: 'flex',
    width: '100%',
    gap: 8,
    alignItems: 'center',
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    padding: '6px 8px',
    font: 'inherit',
    cursor: 'pointer',
};
