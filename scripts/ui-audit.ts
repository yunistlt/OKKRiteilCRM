/**
 * Прогон проверок вёрстки по всем экранам (реестр `lib/ui-audit/screens.ts`).
 *
 *   npm run ui:audit                      # все экраны × все окна
 *   npm run ui:audit -- --screen=orders   # один экран (можно несколько через запятую)
 *   npm run ui:audit -- --viewport=mobile # одно окно
 *   BASE_URL=https://okk.zmksoft.com npm run ui:audit   # против готового сервера (нужен AUTH_COOKIE)
 *
 * Без BASE_URL скрипт сам поднимает `next dev` на свободном порту и выпускает
 * локальную сессию администратора (JWT с ключом по умолчанию из lib/auth.ts —
 * работает только когда JWT_SECRET не задан, т.е. локально).
 *
 * Результат: `ui-audit-report/report.json`, `ui-audit-report/report.html`,
 * скриншоты в `ui-audit-report/shots/`. Папка в .gitignore.
 */
import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { SignJWT } from 'jose';
import { runUiChecks, UI_CHECK_TITLES, type UiChecksResult, type UiFinding } from '../lib/ui-audit/checks';
import { UI_AUDIT_SCREENS, UI_AUDIT_VIEWPORTS, type UiAuditScreen } from '../lib/ui-audit/screens';

type ScreenRun = {
    screen: string;
    title: string;
    section: string;
    path: string;
    viewport: string;
    status: 'ok' | 'issues' | 'failed' | 'skipped';
    finalUrl?: string;
    error?: string;
    screenshot?: string;
    /** Находки в контенте экрана. */
    findings: UiFinding[];
    /** Находки в общей оболочке (сайдбар, шапка, консультант, телефон) — считаются один раз на всё приложение. */
    shellFindings: UiFinding[];
    truncated: UiChecksResult['truncated'];
    errors: number;
    warns: number;
    ms: number;
};

const OUT_DIR = path.resolve('ui-audit-report');
const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const [k, v] = a.replace(/^--/, '').split('=');
        return [k, v ?? 'true'];
    }),
);
const onlyScreens = args.screen ? String(args.screen).split(',') : null;
const onlyViewports = args.viewport ? String(args.viewport).split(',') : null;

async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.listen(0, () => {
            const addr = srv.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

async function waitForServer(url: string, timeoutMs: number) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const res = await fetch(url, { redirect: 'manual' });
            if (res.status < 500) return;
        } catch {
            /* ещё не поднялся */
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Сервер ${url} не поднялся за ${timeoutMs / 1000}с`);
}

async function startDevServer(): Promise<{ baseUrl: string; proc: ChildProcess }> {
    const port = await freePort();
    const proc = spawn('npx', ['next', 'dev', '-p', String(port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    proc.stdout?.on('data', (d) => process.env.UI_AUDIT_VERBOSE && process.stdout.write(`[next] ${d}`));
    proc.stderr?.on('data', (d) => process.env.UI_AUDIT_VERBOSE && process.stderr.write(`[next] ${d}`));
    const baseUrl = `http://localhost:${port}`;
    await waitForServer(`${baseUrl}/login`, 120_000);
    return { baseUrl, proc };
}

/** Локальная сессия администратора — тот же формат, что `login()` в lib/auth.ts. */
async function mintAdminCookie(): Promise<string> {
    if (process.env.AUTH_COOKIE) return process.env.AUTH_COOKIE;
    const secret = process.env.JWT_SECRET || 'okk-super-secret-key-32-chars-long-min';
    const user = {
        id: process.env.UI_AUDIT_USER_ID || '9e79939b-3409-486d-9039-0b31903e2ed4',
        username: 'admin',
        role: 'admin',
        retail_crm_manager_id: null,
        first_name: 'Тестировщик',
        last_name: 'Вёрстки',
    };
    const expires = new Date(Date.now() + 6 * 60 * 60 * 1000);
    return new SignJWT({ user, expires })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('6h')
        .sign(new TextEncoder().encode(secret));
}

/**
 * tsx (esbuild) оборачивает функции в `__name(...)`, которого в браузере нет —
 * поэтому передаём исходник строкой с заглушкой, а не саму функцию.
 */
async function evaluateChecks(page: Page, opts: { mobile: boolean }): Promise<UiChecksResult> {
    const src = `(() => { const __name = (f) => f; return (${runUiChecks.toString()})(${JSON.stringify(opts)}); })()`;
    return (await page.evaluate(src)) as UiChecksResult;
}

async function runSteps(page: Page, screen: UiAuditScreen) {
    for (const step of screen.steps || []) {
        if ('waitFor' in step) {
            await page.waitForSelector(step.waitFor, { timeout: step.timeout ?? 15_000, state: 'visible' });
        } else {
            await page.locator(step.click).first().click({ timeout: 10_000 });
        }
    }
}

async function auditOne(browser: Browser, baseUrl: string, cookie: string, screen: UiAuditScreen, vp: (typeof UI_AUDIT_VIEWPORTS)[number]): Promise<ScreenRun> {
    const t0 = Date.now();
    const base: ScreenRun = {
        screen: screen.key,
        title: screen.title,
        section: screen.section,
        path: screen.path,
        viewport: vp.key,
        status: 'ok',
        findings: [],
        shellFindings: [],
        truncated: {},
        errors: 0,
        warns: 0,
        ms: 0,
    };
    if (screen.skip) return { ...base, status: 'skipped', error: screen.skip, ms: 0 };

    const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        locale: 'ru-RU',
        isMobile: vp.key === 'mobile',
        hasTouch: vp.key === 'mobile',
    });
    if (!screen.public) {
        await context.addCookies([{ name: 'auth_session', value: cookie, url: baseUrl }]);
    }
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    try {
        await page.goto(baseUrl + screen.path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        // networkidle на экранах с поллингом не наступает — ждём недолго и идём дальше.
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
        await page.waitForTimeout(1_200);
        await runSteps(page, screen);
        // Ждём, пока уйдут спиннеры и «Загружаем…» — иначе проверим пустой экран.
        await page
            .waitForFunction(
                () => !Array.from(document.querySelectorAll('.animate-spin, .animate-pulse')).some((el) => (el as HTMLElement).offsetParent !== null) && !/Загружаем|Загрузка/.test(document.body.innerText || ''),
                undefined,
                { timeout: 20_000 },
            )
            .catch(() => undefined);
        await page.waitForTimeout(500);

        const finalUrl = new URL(page.url()).pathname;
        if (!screen.public && finalUrl.startsWith('/login')) {
            throw new Error('редирект на /login — сессия не принята');
        }

        const result = await evaluateChecks(page, { mobile: vp.key === 'mobile' }).catch(async () => {
            // Страница ушла в редирект в момент проверки — дождёмся и повторим один раз.
            await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => undefined);
            await page.waitForTimeout(1_500);
            return evaluateChecks(page, { mobile: vp.key === 'mobile' });
        });
        const shot = path.join('shots', `${screen.key}--${vp.key}.png`);
        await page.screenshot({ path: path.join(OUT_DIR, shot), fullPage: false });

        const pageFindings = result.findings.filter((f) => f.zone === 'page');
        const shellFindings = result.findings.filter((f) => f.zone !== 'page');
        const errors = pageFindings.filter((f) => f.severity === 'error').length;
        const warns = pageFindings.length - errors;
        return {
            ...base,
            status: pageFindings.length ? 'issues' : 'ok',
            finalUrl,
            screenshot: shot,
            findings: pageFindings,
            shellFindings,
            truncated: result.truncated,
            errors,
            warns,
            error: consoleErrors.length ? `Ошибки JS: ${consoleErrors.slice(0, 3).join(' | ')}` : undefined,
            ms: Date.now() - t0,
        };
    } catch (e) {
        const shot = path.join('shots', `${screen.key}--${vp.key}.png`);
        await page.screenshot({ path: path.join(OUT_DIR, shot) }).catch(() => undefined);
        return { ...base, status: 'failed', error: (e as Error).message.split('\n')[0], screenshot: shot, ms: Date.now() - t0 };
    } finally {
        await context.close();
    }
}

function esc(s: string) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function renderHtml(runs: ScreenRun[], meta: { baseUrl: string; startedAt: string; ms: number }) {
    const byScreen = new Map<string, ScreenRun[]>();
    for (const r of runs) byScreen.set(r.screen, [...(byScreen.get(r.screen) || []), r]);
    const totals = {
        errors: runs.reduce((s, r) => s + r.errors, 0),
        warns: runs.reduce((s, r) => s + r.warns, 0),
        failed: runs.filter((r) => r.status === 'failed').length,
        screens: byScreen.size,
    };
    const byCode = new Map<string, number>();
    for (const r of runs) for (const f of r.findings) byCode.set(f.code, (byCode.get(f.code) || 0) + 1);

    // Оболочка одна на всё приложение — сводим по (зона, правило, селектор) и запоминаем, где встретилось.
    const shell = new Map<string, { f: UiFinding; where: Set<string> }>();
    for (const r of runs) {
        for (const f of r.shellFindings) {
            const k = `${f.zone}|${f.code}|${f.selector}`;
            const cur = shell.get(k) || { f, where: new Set<string>() };
            cur.where.add(r.viewport);
            shell.set(k, cur);
        }
    }
    const zoneTitle: Record<string, string> = { sidebar: 'Сайдбар', header: 'Шапка', consultant: 'Консультант (Семён)', phone: 'Телефон' };
    const shellByZone = new Map<string, Array<{ f: UiFinding; where: Set<string> }>>();
    for (const v of shell.values()) shellByZone.set(v.f.zone, [...(shellByZone.get(v.f.zone) || []), v]);
    const shellErrors = Array.from(shell.values()).filter((v) => v.f.severity === 'error').length;
    const shellHtml = Array.from(shellByZone.entries())
        .map(
            ([zone, list]) => `<section id="shell-${zone}"><h2>Оболочка: ${esc(zoneTitle[zone] || zone)}</h2><ul>${list
                .map(
                    ({ f, where }) =>
                        `<li class="${f.severity}"><b>${esc(UI_CHECK_TITLES[f.code])}</b> — ${esc(f.message)}<br><small>${esc(f.element)} · <code>${esc(f.selector)}</code> · окна: ${Array.from(where).join(', ')}</small></li>`,
                )
                .join('\n')}</ul></section>`,
        )
        .join('\n');

    const rows = Array.from(byScreen.entries())
        .map(([, list]) => {
            const first = list[0];
            const cells = list
                .map((r) => {
                    const cls = r.status === 'failed' ? 'fail' : r.errors ? 'err' : r.warns ? 'warn' : r.status === 'skipped' ? 'skip' : 'ok';
                    const label = r.status === 'failed' ? 'сбой' : r.status === 'skipped' ? 'пропуск' : `${r.errors} / ${r.warns}`;
                    return `<td class="${cls}"><a href="#${r.screen}--${r.viewport}">${label}</a></td>`;
                })
                .join('');
            return `<tr><td class="sec">${esc(first.section)}</td><td><b>${esc(first.title)}</b><br><code>${esc(first.path)}</code></td>${cells}</tr>`;
        })
        .join('\n');

    const details = runs
        .filter((r) => r.status !== 'ok' && r.status !== 'skipped')
        .map((r) => {
            const items = r.findings
                .map(
                    (f) =>
                        `<li class="${f.severity}"><b>${esc(UI_CHECK_TITLES[f.code])}</b> — ${esc(f.message)}<br><small>${esc(f.element)} · <code>${esc(f.selector)}</code> · ${f.rect.x},${f.rect.y} ${f.rect.w}×${f.rect.h}</small></li>`,
                )
                .join('\n');
            const trunc = Object.entries(r.truncated)
                .map(([c, n]) => `${UI_CHECK_TITLES[c as keyof typeof UI_CHECK_TITLES]}: ещё ${n}`)
                .join(', ');
            return `<section id="${r.screen}--${r.viewport}">
<h2>${esc(r.title)} — ${esc(UI_AUDIT_VIEWPORTS.find((v) => v.key === r.viewport)?.title || r.viewport)}</h2>
<p><code>${esc(r.path)}</code> · ошибок ${r.errors}, замечаний ${r.warns} · ${r.ms} мс${r.error ? ` · <span class="fail">${esc(r.error)}</span>` : ''}${trunc ? ` · срезано: ${esc(trunc)}` : ''}</p>
${r.screenshot ? `<img src="${r.screenshot}" loading="lazy" alt="">` : ''}
<ul>${items}</ul>
</section>`;
        })
        .join('\n');

    return `<!doctype html><meta charset="utf-8"><title>Проверка вёрстки</title>
<style>
body{font:13px/1.4 -apple-system,system-ui,sans-serif;margin:0;padding:16px;color:#0f172a;background:#fff}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5e1;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f1f5f9}.sec{color:#64748b;white-space:nowrap}
td.ok{background:#dcfce7}td.warn{background:#fef9c3}td.err{background:#fee2e2}td.fail{background:#0f172a;color:#fff}td.skip{color:#94a3b8}
td a{color:inherit;text-decoration:none;display:block}
section{border-top:2px solid #0f172a;margin-top:24px;padding-top:8px}h2{font-size:16px;margin:0 0 4px}
img{max-width:100%;border:1px solid #cbd5e1;margin:8px 0}
ul{padding-left:18px}li{margin:4px 0}li.error b{color:#dc2626}li.warn b{color:#a16207}
code{font-size:11px;color:#475569}.fail{color:#dc2626}
.kpi{display:flex;gap:16px;margin:8px 0 16px}.kpi div{border:1px solid #cbd5e1;padding:6px 12px}.kpi b{font-size:20px;display:block}
</style>
<h1 style="margin:0 0 4px;font-size:20px">Проверка вёрстки по голдам</h1>
<p>${esc(meta.baseUrl)} · ${esc(new Date(meta.startedAt).toLocaleString('ru-RU'))} · ${Math.round(meta.ms / 1000)} с · в ячейках «ошибки / замечания»</p>
<div class="kpi"><div><b>${totals.screens}</b>экранов</div><div><b style="color:#dc2626">${totals.errors}</b>ошибок в экранах</div><div><b style="color:#a16207">${totals.warns}</b>замечаний в экранах</div><div><b>${totals.failed}</b>сбоев загрузки</div><div><b style="color:#dc2626">${shellErrors}</b>ошибок в оболочке</div><div><b style="color:#a16207">${shell.size - shellErrors}</b>замечаний в оболочке</div></div>
<p>${Array.from(byCode.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${esc(UI_CHECK_TITLES[c as keyof typeof UI_CHECK_TITLES])}: <b>${n}</b>`)
        .join(' · ')}</p>
<table><thead><tr><th>Раздел</th><th>Экран</th>${UI_AUDIT_VIEWPORTS.map((v) => `<th>${esc(v.title)}</th>`).join('')}</tr></thead><tbody>
${rows}
</tbody></table>
${shellHtml}
${details}`;
}

async function main() {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(path.join(OUT_DIR, 'shots'), { recursive: true });

    let proc: ChildProcess | null = null;
    let baseUrl = process.env.BASE_URL || '';
    if (!baseUrl) {
        console.log('Поднимаю next dev…');
        const started = await startDevServer();
        baseUrl = started.baseUrl;
        proc = started.proc;
    }
    console.log(`Сервер: ${baseUrl}`);

    const cookie = await mintAdminCookie();
    const screens = UI_AUDIT_SCREENS.filter((s) => !onlyScreens || onlyScreens.includes(s.key));
    const viewports = UI_AUDIT_VIEWPORTS.filter((v) => !onlyViewports || onlyViewports.includes(v.key));
    const browser = await chromium.launch();
    const runs: ScreenRun[] = [];

    try {
        for (const screen of screens) {
            // Все окна одного экрана — параллельно: сервер уже скомпилировал страницу, узкое место — ожидание сети.
            const batch = await Promise.all(viewports.map((vp) => auditOne(browser, baseUrl, cookie, screen, vp)));
            for (const run of batch) {
                runs.push(run);
                const tag = run.status === 'failed' ? `СБОЙ ${run.error}` : run.status === 'skipped' ? 'пропуск' : `ошибок ${run.errors}, замечаний ${run.warns}`;
                console.log(`${screen.key.padEnd(24)} ${run.viewport.padEnd(8)} ${tag} (${run.ms} мс)`);
            }
        }
    } finally {
        await browser.close();
        if (proc) proc.kill('SIGTERM');
    }

    const meta = { baseUrl, startedAt, ms: Date.now() - t0 };
    writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify({ meta, runs }, null, 2));
    writeFileSync(path.join(OUT_DIR, 'report.html'), renderHtml(runs, meta));
    const errors = runs.reduce((s, r) => s + r.errors, 0);
    const warns = runs.reduce((s, r) => s + r.warns, 0);
    const failed = runs.filter((r) => r.status === 'failed').length;
    console.log(`\nИтого: ошибок ${errors}, замечаний ${warns}, сбоев ${failed}. Отчёт: ${path.join(OUT_DIR, 'report.html')}`);
    if (existsSync(path.join(OUT_DIR, 'report.html')) && (errors || failed)) process.exitCode = 1;
}

main().catch((e) => {
    console.error(e);
    process.exit(2);
});
