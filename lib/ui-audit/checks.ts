/**
 * Проверки вёрстки, которые выполняются В БРАУЗЕРЕ на живом DOM.
 *
 * Функция `runUiChecks` самодостаточна (никаких импортов и замыканий):
 * её одинаково гоняют Playwright (`page.evaluate(runUiChecks, opts)`) и
 * оверлей режима тестировщика внутри приложения. Все тексты — по-русски,
 * правила — из `golds/GOLD_DESIGN_UX.md`.
 */

export type UiFindingSeverity = 'error' | 'warn';

export type UiFinding = {
    /** Технический код правила. */
    code: UiCheckCode;
    severity: UiFindingSeverity;
    /** Человеческое описание проблемы. */
    message: string;
    /** Короткая подпись элемента (тег, класс, текст). */
    element: string;
    /** CSS-путь до элемента — чтобы найти в DOM. */
    selector: string;
    /** Прямоугольник элемента в координатах окна. */
    rect: { x: number; y: number; w: number; h: number };
    /** Зона оболочки (сайдбар, шапка, консультант, телефон) или `page` — контент экрана. */
    zone: string;
};

export type UiCheckCode =
    | 'page-h-overflow' // страница прокручивается по горизонтали
    | 'clipped' // элемент вылез за окно и его нельзя доскроллить
    | 'covered' // элемент перекрыт другим слоем (сайдбар над модалкой и т.п.)
    | 'nested-scroll' // вложенные вертикальные прокрутки
    | 'scroll-dead' // контент обрезан overflow:hidden без прокрутки
    | 'radius' // скругление углов вне разрешённых зон
    | 'shadow' // тень
    | 'transition' // переход дольше 100 мс
    | 'number-input' // input[type=number] вместо NumberInput
    | 'touch-target' // мелкая зона касания на телефоне
    | 'code-in-ui'; // технический код/слаг вместо русского названия

export const UI_CHECK_TITLES: Record<UiCheckCode, string> = {
    'page-h-overflow': 'Горизонтальная прокрутка страницы',
    clipped: 'Элемент вылезает за окно',
    covered: 'Элемент перекрыт другим слоем',
    'nested-scroll': 'Вложенные прокрутки',
    'scroll-dead': 'Контент обрезан без прокрутки',
    radius: 'Скругление углов',
    shadow: 'Тень',
    transition: 'Медленная анимация',
    'number-input': 'Числовое поле без разделителей',
    'touch-target': 'Мелкая зона касания',
    'code-in-ui': 'Код вместо названия',
};

export type UiChecksOptions = {
    /** Ширина окна считается «мобильной» (проверка зон касания). */
    mobile?: boolean;
    /** Максимум находок на одно правило (чтобы отчёт не разбухал). */
    perRuleLimit?: number;
};

export type UiChecksResult = {
    findings: UiFinding[];
    /** Сколько находок отброшено из-за лимита, по кодам. */
    truncated: Partial<Record<UiCheckCode, number>>;
    viewport: { width: number; height: number };
    url: string;
};

export function runUiChecks(options: UiChecksOptions): UiChecksResult {
    const perRuleLimit = options.perRuleLimit ?? 25;
    const isMobile = Boolean(options.mobile);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const findings: UiFinding[] = [];
    const counts: Record<string, number> = {};
    const truncated: Partial<Record<UiCheckCode, number>> = {};

    // ── Утилиты ─────────────────────────────────────────────────────────
    const cssPath = (el: Element): string => {
        const parts: string[] = [];
        let cur: Element | null = el;
        while (cur && cur !== document.body && parts.length < 6) {
            let part = cur.tagName.toLowerCase();
            if (cur.id) {
                part += '#' + cur.id;
                parts.unshift(part);
                break;
            }
            const audit = cur.getAttribute('data-ui-audit');
            if (audit) part += `[data-ui-audit="${audit}"]`;
            const parent: Element | null = cur.parentElement;
            if (parent) {
                const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
                if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
            }
            parts.unshift(part);
            cur = parent;
        }
        return parts.join(' > ');
    };

    const describe = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        const audit = el.getAttribute('data-ui-audit');
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const cls = (typeof el.className === 'string' ? el.className : '')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 3)
            .join('.');
        return [tag, audit ? `[${audit}]` : '', cls ? '.' + cls : '', text ? `«${text}»` : ''].filter(Boolean).join(' ');
    };

    const rectOf = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };

    const add = (code: UiCheckCode, severity: UiFindingSeverity, el: Element, message: string) => {
        counts[code] = (counts[code] || 0) + 1;
        if (counts[code] > perRuleLimit) {
            truncated[code] = (truncated[code] || 0) + 1;
            return;
        }
        const zone = el.closest('[data-ui-audit-zone]')?.getAttribute('data-ui-audit-zone') || 'page';
        findings.push({ code, severity, message, element: describe(el), selector: cssPath(el), rect: rectOf(el), zone });
    };

    const isVisible = (el: Element): boolean => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        // Целиком за левым/правым краем — это выдвижная панель (off-canvas), а не обрезанный элемент.
        if (r.right <= 0 || r.left >= vw) return false;
        return true;
    };

    // Оверлей режима тестировщика и всё, что помечено как исключение, пропускаем.
    const isExempt = (el: Element, rule: 'style' | 'any'): boolean => {
        if (el.closest('[data-ui-audit-overlay]')) return true;
        if (rule === 'style' && el.closest('[data-ui-exception="whatsapp"]')) return true;
        return false;
    };

    const isScrollable = (el: Element, axis: 'x' | 'y'): boolean => {
        const cs = getComputedStyle(el);
        const ov = axis === 'y' ? cs.overflowY : cs.overflowX;
        if (!(ov === 'auto' || ov === 'scroll')) return false;
        return axis === 'y' ? el.scrollHeight > el.clientHeight + 2 : el.scrollWidth > el.clientWidth + 2;
    };

    const hasScrollableAncestor = (el: Element, axis: 'x' | 'y'): boolean => {
        let cur = el.parentElement;
        while (cur && cur !== document.body) {
            if (isScrollable(cur, axis)) return true;
            cur = cur.parentElement;
        }
        return false;
    };

    const all = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter(
        (el) => !isExempt(el, 'any') && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE',
    );
    const visible = all.filter(isVisible);

    // ── 1. Горизонтальная прокрутка страницы ─────────────────────────────
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller.scrollWidth > scroller.clientWidth + 2) {
        add('page-h-overflow', 'error', document.body, `Страница шире окна на ${scroller.scrollWidth - scroller.clientWidth}px — появляется горизонтальная прокрутка всего экрана.`);
    }

    // Рабочая область экрана (между сайдбаром и консультантом) шире, чем ей дали места.
    const pageScroller = document.querySelector<HTMLElement>('[data-ui-audit="page-scroller"]');
    if (pageScroller && pageScroller.scrollWidth > pageScroller.clientWidth + 2) {
        const pr = pageScroller.getBoundingClientRect();
        const scrollsInside = (el: Element): boolean => {
            let cur = el.parentElement;
            while (cur && cur !== pageScroller) {
                if (isScrollable(cur, 'x')) return true;
                cur = cur.parentElement;
            }
            return false;
        };
        const wide = Array.from(pageScroller.querySelectorAll<HTMLElement>('*')).find((el) => {
            const r = el.getBoundingClientRect();
            return isVisible(el) && r.right > pr.right + 2 && r.width > 40 && !scrollsInside(el) && !el.closest('[data-ui-audit-overlay]');
        });
        add('page-h-overflow', 'error', wide || pageScroller, `Экран шире рабочей области на ${pageScroller.scrollWidth - pageScroller.clientWidth}px — правая часть съедается, появляется прокрутка всей страницы вбок.`);
    }

    // ── 2. Вылез за окно без возможности доскроллить ─────────────────────
    const importantSel = 'button, a[href], input, select, textarea, table, h1, h2, h3, [role="dialog"], [data-ui-audit]';
    for (const el of visible) {
        if (!el.matches(importantSel)) continue;
        const r = el.getBoundingClientRect();
        const outRight = r.right - vw;
        const outLeft = -r.left;
        const outBottom = r.bottom - vh;
        const outX = Math.max(outRight, outLeft);
        if (outX > 4 && !hasScrollableAncestor(el, 'x') && scroller.scrollWidth <= scroller.clientWidth + 2) {
            add('clipped', 'error', el, `Элемент выходит за ${outRight > outLeft ? 'правый' : 'левый'} край окна на ${Math.round(outX)}px, и доскроллить до него нельзя.`);
            continue;
        }
        const cs = getComputedStyle(el);
        if (outBottom > 4 && cs.position === 'fixed') {
            add('clipped', 'error', el, `Закреплённый элемент уходит за нижний край окна на ${Math.round(outBottom)}px.`);
        }
    }

    // ── 3. Перекрытие: модалка под сайдбаром, кнопка под другой панелью ──
    const interactive = visible.filter((el) => el.matches('button, a[href], input, select, textarea, [role="button"], [role="tab"]'));
    const dialogs = visible.filter((el) => {
        if (el.matches('[role="dialog"], dialog, [data-ui-audit$="modal"]')) return true;
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        return r.width >= vw * 0.6 && r.height >= vh * 0.6;
    });
    const coveredBy = (el: Element, x: number, y: number): Element | null => {
        if (x < 0 || y < 0 || x >= vw || y >= vh) return null;
        const top = document.elementFromPoint(x, y);
        if (!top) return null;
        if (top === el || el.contains(top) || top.contains(el)) return null;
        if (top.closest('[data-ui-audit-overlay]')) return null;
        return top;
    };
    for (const dlg of dialogs) {
        const r = dlg.getBoundingClientRect();
        const samples: Array<[number, number]> = [
            [r.left + 6, r.top + r.height / 2],
            [r.right - 6, r.top + r.height / 2],
            [r.left + r.width / 2, r.top + 6],
            [r.left + r.width / 2, r.bottom - 6],
        ];
        const seen = new Set<Element>();
        for (const [x, y] of samples) {
            const top = coveredBy(dlg, x, y);
            if (top && !seen.has(top)) {
                seen.add(top);
                const side = x < r.left + 10 ? 'слева' : x > r.right - 10 ? 'справа' : y < r.top + 10 ? 'сверху' : 'снизу';
                add('covered', 'error', dlg, `Окно перекрыто ${side}: поверх него лежит ${describe(top)}.`);
            }
        }
    }
    const inLayer = (el: Element): 'fixed' | 'sticky' | 'absolute' | null => {
        let cur: Element | null = el;
        while (cur && cur !== document.body) {
            const pos = getComputedStyle(cur).position;
            if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') return pos;
            cur = cur.parentElement;
        }
        return null;
    };
    let sampled = 0;
    for (const el of interactive) {
        if (sampled++ > 400) break;
        if (dialogs.some((d) => d.contains(el))) continue; // модалки проверили выше
        if (dialogs.length) continue; // при открытом окне всё под ним и должно быть закрыто
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) continue;
        const top = coveredBy(el, cx, cy);
        if (!top) continue;
        // Перекрытие в потоке (соседний контент) — не наш случай; ловим только слои.
        const layer = inLayer(top);
        if (!layer) continue;
        // Липкая панель поверх контента, который можно доскроллить, — норма; ловим только fixed-слои.
        if (layer !== 'fixed' && hasScrollableAncestor(el, 'y')) continue;
        // Маленькая плавающая кнопка над прокручиваемым контентом — замечание (нужен отступ снизу), не ошибка.
        const tr = top.getBoundingClientRect();
        const small = tr.width * tr.height < vw * vh * 0.05;
        if (small && hasScrollableAncestor(el, 'y')) {
            add('covered', 'warn', el, `Плавающая кнопка ${describe(top)} ложится на элемент — добавьте отступ снизу у контента.`);
            continue;
        }
        add('covered', 'error', el, `Элемент перекрыт: по центру кликается ${describe(top)}.`);
    }

    // ── 4. Вложенные прокрутки / контент без прокрутки ───────────────────
    const yScrollers = visible.filter((el) => isScrollable(el, 'y') && !el.matches('textarea, select, pre, code'));
    const pageScrolls = scroller.scrollHeight > scroller.clientHeight + 2;
    for (const el of yScrollers) {
        let depth = 0;
        let cur = el.parentElement;
        while (cur && cur !== document.body) {
            if (isScrollable(cur, 'y')) depth++;
            cur = cur.parentElement;
        }
        if (pageScrolls) depth++;
        if (depth >= 1 && el.getAttribute('data-ui-audit-scroll') !== 'nested-ok') {
            add('nested-scroll', 'warn', el, `Прокрутка внутри прокрутки (уровень ${depth + 1}): колесо мыши «залипает» между ними. Одна прокрутка на экран.`);
        }
    }
    for (const el of visible) {
        const cs = getComputedStyle(el);
        if (cs.overflowY !== 'hidden' && cs.overflow !== 'hidden') continue;
        if (el.scrollHeight <= el.clientHeight + 8) continue;
        // Внутри есть свой скроллер — значит контент доступен.
        if (Array.from(el.querySelectorAll<HTMLElement>('*')).some((c) => isScrollable(c, 'y'))) continue;
        if (el.matches('[data-ui-audit-clip="ok"]')) continue;
        // Однострочные обрезки текста (ellipsis) — не ошибка.
        if (cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') continue;
        if (el.clientHeight < 40) continue;
        add('scroll-dead', 'error', el, `Контент выше блока на ${el.scrollHeight - el.clientHeight}px, но блок с overflow:hidden и без прокрутки — низ недоступен.`);
    }

    // ── 5. Голд: плоско, без радиусов, без теней, без медленных анимаций ─
    const realShadowSegment = (shadow: string): string => {
        const segs = shadow.split(/\),\s*/).map((x, i, a) => (i < a.length - 1 ? x + ')' : x));
        return (segs.find((x) => hasRealShadow(x)) || shadow).slice(0, 48);
    };
    // Tailwind ставит прозрачные тени (ring-заглушки) — это не тень.
    const hasRealShadow = (shadow: string): boolean => {
        if (!shadow || shadow === 'none') return false;
        const colors = shadow.match(/rgba?\([^)]*\)/g) || [];
        if (!colors.length) return true;
        return colors.some((c) => {
            const parts = c.replace(/rgba?\(|\)/g, '').split(',').map((x) => parseFloat(x));
            return parts.length < 4 || parts[3] > 0;
        });
    };
    for (const el of visible) {
        if (isExempt(el, 'style')) continue;
        const cs = getComputedStyle(el);
        const radius = parseFloat(cs.borderTopLeftRadius) || parseFloat(cs.borderBottomRightRadius) || 0;
        if (radius > 0 && !el.matches('input[type="checkbox"], input[type="radio"], img, video, canvas, svg, svg *, [data-ui-audit-round="ok"]')) {
            add('radius', 'warn', el, `border-radius ${Math.round(radius)}px — по голду углы 0px.`);
        }
        if (hasRealShadow(cs.boxShadow) && !el.matches('[data-ui-audit-shadow="ok"]')) {
            add('shadow', 'warn', el, `Тень (${realShadowSegment(cs.boxShadow)}) — по голду плоско, без теней.`);
        }
        const dur = cs.transitionDuration
            .split(',')
            .map((s) => parseFloat(s) * (s.trim().endsWith('ms') ? 1 : 1000))
            .filter((n) => !Number.isNaN(n));
        const maxDur = dur.length ? Math.max(...dur) : 0;
        const props = cs.transitionProperty;
        if (maxDur > 100 && props !== 'none' && !el.matches('[data-ui-audit-motion="ok"]')) {
            add('transition', 'warn', el, `Переход ${Math.round(maxDur)}мс (${props.slice(0, 30)}) — по голду ≤100мс.`);
        }
    }

    // ── 6. Числовые поля ─────────────────────────────────────────────────
    for (const el of visible) {
        if (el.matches('input[type="number"]') && !el.matches('[data-ui-audit-number="ok"]')) {
            add('number-input', 'warn', el, 'input[type=number] — суммы ≥1000 вводятся через NumberInput с разделителями разрядов.');
        }
    }

    // ── 7. Зоны касания на телефоне ──────────────────────────────────────
    if (isMobile) {
        for (const el of interactive) {
            const r = el.getBoundingClientRect();
            if (r.height < 36 && r.width < 36) {
                add('touch-target', 'warn', el, `Зона касания ${Math.round(r.width)}×${Math.round(r.height)}px — на телефоне нужно ≥44px по высоте.`);
            }
        }
    }

    // ── 8. Код/слаг вместо русского названия ─────────────────────────────
    const slugRe = /^(?=.*[a-z])[a-z0-9]+(?:[-_][a-z0-9]+)+$/;
    const allowedSlugs = /^(utm|api|url|id|json|csv|xlsx|pdf|sip|smtp|imap)/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let scanned = 0;
    while ((node = walker.nextNode()) && scanned++ < 20000) {
        const text = (node.textContent || '').trim();
        if (text.length < 5 || text.length > 60 || !slugRe.test(text) || allowedSlugs.test(text)) continue;
        const el = node.parentElement;
        if (!el || !isVisible(el) || isExempt(el, 'any')) continue;
        if (el.closest('code, pre, kbd, input, textarea, [data-ui-audit-code="ok"]')) continue;
        add('code-in-ui', 'error', el, `Показан технический код «${text}» — нужно русское название из справочника.`);
    }

    for (const el of visible) {
        if (isExempt(el, 'any') || el.matches('[data-ui-audit-code="ok"]')) continue;
        let shown = '';
        if (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search' || !el.type)) shown = el.value;
        else if (el instanceof HTMLSelectElement) shown = el.selectedOptions[0]?.textContent || '';
        else continue;
        shown = shown.trim();
        if (shown.length < 5 || shown.length > 60 || !slugRe.test(shown) || allowedSlugs.test(shown)) continue;
        add('code-in-ui', 'error', el, `В поле показан технический код «${shown}» — нужно русское название из справочника.`);
    }

    return { findings, truncated, viewport: { width: vw, height: vh }, url: location.pathname + location.search };
}
