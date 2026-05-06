import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const DEFAULTS = {
    enabled: true,
    agent_name: 'Елена (ЗМК)',
    agent_title: 'В сети • Продуктолог',
    agent_avatar_url: 'https://okk.zmksoft.com/images/agents/elena.png',
    primary_color: '#10b981',
    position_bottom: 260,
    position_right: 20,
    auto_expand_delay_ms: 30000,
    greeting_delay1_ms: 10000,
    greeting_delay2_ms: 20000,
    quick_buttons_delay_ms: 25000,
    exit_intent_enabled: true,
    email_capture_enabled: true,
    quick_buttons_enabled: true,
};

export async function GET() {
    // Читаем конфиг из Supabase
    const { data } = await supabase
        .from('widget_settings')
        .select('config')
        .limit(1)
        .single();

    const cfg = { ...DEFAULTS, ...(data?.config ?? {}) };

    // Если виджет отключён — пустой JS
    if (!cfg.enabled) {
        return new NextResponse('/* OKK widget disabled */', {
            headers: {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'public, max-age=60',
            },
        });
    }

    const previewBottom = cfg.position_bottom + 80;
    const agentNameEsc = JSON.stringify(cfg.agent_name);
    const agentTitleEsc = JSON.stringify(cfg.agent_title);
    const avatarUrlEsc = JSON.stringify(cfg.agent_avatar_url);
    const primaryColor = cfg.primary_color;

    const js = `
(function() {
'use strict';
if (window.__OKK_LEAD_CATCHER_BOOTSTRAPPED__) return;
window.__OKK_LEAD_CATCHER_BOOTSTRAPPED__ = true;

// ── Inject HTML ──────────────────────────────────────────────────────────────
(function injectHTML() {
    var style = document.createElement('style');
    style.textContent = ${JSON.stringify(buildCSS(primaryColor, cfg.position_bottom, cfg.position_right, previewBottom))};
    document.head.appendChild(style);

    var div = document.createElement('div');
    div.innerHTML = ${JSON.stringify(buildHTML(cfg.agent_name, cfg.agent_title, cfg.agent_avatar_url, primaryColor))};
    document.body.appendChild(div.firstElementChild);
    document.body.appendChild(div.lastElementChild);
})();

// ── Config ───────────────────────────────────────────────────────────────────
window.OKK_LEAD_CATCHER_CALLBACKS = window.OKK_LEAD_CATCHER_CALLBACKS || {
    onMessage: function() {},
    onLeadCaptured: function() {},
    onWidgetToggle: function() {}
};

var WIDGET_CONFIG = {
    apiEndpoint: 'https://okk.zmksoft.com/api/widget/chat',
    wishlistEndpoint: 'https://okk.zmksoft.com/api/widget/wishlist-email',
    agentName: ${agentNameEsc},
    primaryColor: ${JSON.stringify(primaryColor)},
    exitIntentEnabled: ${cfg.exit_intent_enabled},
    emailCaptureEnabled: ${cfg.email_capture_enabled},
    quickButtonsEnabled: ${cfg.quick_buttons_enabled},
    storageKeys: {
        visitorId: 'okk_lc_visitor_id',
        utm: 'okk_lc_utm',
        history: 'okk_lc_pages',
        landing: 'okk_lc_landing',
        cart: 'okk_lc_cart',
        widgetOpen: 'okk_lc_widget_open',
        chatCache: 'okk_lc_chat_cache',
        hasInteracted: 'okk_lc_has_interacted',
        exitIntentFired: 'okk_lc_exit_intent_fired',
        exitIntentPath: 'okk_lc_exit_intent_path',
        greetingShown: 'okk_lc_greeting_shown'
    },
    maxHistory: 20,
    pollingInterval: 3000,
    autoExpandDelay: ${cfg.auto_expand_delay_ms},
    greetingDelay1: ${cfg.greeting_delay1_ms},
    greetingDelay2: ${cfg.greeting_delay2_ms},
    quickButtonsDelay: ${cfg.quick_buttons_delay_ms},
    typingSpeed: 25,
    lazyLoadMs: 500
};

// ── Widget Logic ─────────────────────────────────────────────────────────────
async function initWidget() {
    var lastMessageTimestamp = localStorage.getItem('okk_lc_last_msg_time') || new Date().toISOString();
    var autoExpandTimer = null;
    var scenario = { listenersBound: false, pageExitPromptShown: false, exitIntentPending: false };

    function wasGreetingShown() { return sessionStorage.getItem(WIDGET_CONFIG.storageKeys.greetingShown) === '1'; }
    function markGreetingShown() { sessionStorage.setItem(WIDGET_CONFIG.storageKeys.greetingShown, '1'); }

    function getStoredCart() {
        try {
            var raw = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.cart) || '[]');
            if (!Array.isArray(raw)) return [];
            return raw.filter(function(i) { return i && typeof i === 'object' && !!i.name && !!i.url; });
        } catch(e) { return []; }
    }
    function setStoredCart(cart) {
        localStorage.setItem(WIDGET_CONFIG.storageKeys.cart, JSON.stringify(cart.slice(-WIDGET_CONFIG.maxHistory)));
    }

    var tracking = {
        init: function() {
            this.ensureVisitorId(); this.trackUTM();
            this.trackLandingPage(); this.trackPageView(); this.setupProductTracking();
        },
        ensureVisitorId: function() {
            var id = localStorage.getItem(WIDGET_CONFIG.storageKeys.visitorId);
            if (!id) { id = 'v_lc_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now(); localStorage.setItem(WIDGET_CONFIG.storageKeys.visitorId, id); }
            return id;
        },
        trackUTM: function() {
            var params = new URLSearchParams(window.location.search);
            var utm = {};
            ['source','medium','campaign','content','term'].forEach(function(k) { if (params.get('utm_'+k)) utm[k] = params.get('utm_'+k); });
            if (Object.keys(utm).length) localStorage.setItem(WIDGET_CONFIG.storageKeys.utm, JSON.stringify(utm));
        },
        trackLandingPage: function() {
            if (!localStorage.getItem(WIDGET_CONFIG.storageKeys.landing)) localStorage.setItem(WIDGET_CONFIG.storageKeys.landing, window.location.href);
        },
        trackPageView: function() {
            var currentPath = window.location.pathname;
            var lastExitPath = localStorage.getItem(WIDGET_CONFIG.storageKeys.exitIntentPath);
            if (lastExitPath !== currentPath) { localStorage.removeItem(WIDGET_CONFIG.storageKeys.exitIntentFired); localStorage.setItem(WIDGET_CONFIG.storageKeys.exitIntentPath, currentPath); }
            var hist = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]');
            hist.push({ url: window.location.pathname, title: document.title });
            localStorage.setItem(WIDGET_CONFIG.storageKeys.history, JSON.stringify(hist.slice(-WIDGET_CONFIG.maxHistory)));
        },
        setupProductTracking: function() {
            var h1 = document.querySelector('h1');
            if (!h1) return;
            var ogTypeMeta = document.querySelector('meta[property="og:type"]');
            var ogType = ogTypeMeta ? ogTypeMeta.getAttribute('content') : '';
            var hasProductLdJson = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some(function(s) { return /"@type"\\s*:\\s*"Product"/i.test(s.textContent || ''); });
            if (ogType !== 'product' && !hasProductLdJson) {
                var hasAnyPrice = !!document.querySelector('[class*="price"],[class*="cost"],[class*="amount"],[id*="price"],[data-price],[itemprop*="price"]') || /₽|рубль/.test(document.body.innerText);
                var hasAnyBuyBtn = !!document.querySelector('[class*="buy"],[class*="cart"],[class*="order"],[id*="cart"],[id*="buy"]') || /Купить|В корзину|Заказать/i.test(document.body.innerText);
                var isNotListing = !document.querySelector('.products,.product-list,.shop-products,[class*="catalog"],[class*="category"]');
                if (!(hasAnyPrice && hasAnyBuyBtn && isNotListing)) return;
            }
            (function saveProduct() {
                var cart = getStoredCart(); var pageUrl = window.location.href;
                if (cart.find(function(c) { return c.url === pageUrl; })) return;
                var ogImg = document.querySelector('meta[property="og:image"]');
                var bodyImg = document.querySelector('img[alt],img[src]');
                var img = ogImg ? ogImg.getAttribute('content') : (bodyImg ? bodyImg.src : '');
                cart.push({ name: h1.innerText.trim(), url: pageUrl, img: img });
                setStoredCart(cart);
            })();
            window.addEventListener('beforeunload', function() {
                var cart = getStoredCart(); var pageUrl = window.location.href;
                if (!cart.find(function(c) { return c.url === pageUrl; })) {
                    var ogImg = document.querySelector('meta[property="og:image"]');
                    var bodyImg = document.querySelector('img[alt],img[src]');
                    var img = ogImg ? ogImg.getAttribute('content') : (bodyImg ? bodyImg.src : '');
                    cart.push({ name: h1.innerText.trim(), url: pageUrl, img: img });
                    setStoredCart(cart);
                }
            });
        },
        getPayload: function() {
            return {
                domain: window.location.hostname,
                utm: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.utm) || '{}'),
                visitedPages: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]'),
                cartItems: getStoredCart().map(function(c) { return c.name; }),
                landingPage: localStorage.getItem(WIDGET_CONFIG.storageKeys.landing)
            };
        }
    };
    tracking.init();

    var widget = document.getElementById('okk-lead-catcher-widget');
    var input = document.getElementById('okk-lead-catcher-input');
    var messages = document.getElementById('okk-lead-catcher-messages');
    var toggle = document.getElementById('okk-lead-catcher-toggle');
    var preview = document.getElementById('okk-lead-catcher-preview');
    var typingIndicator = document.getElementById('okk-typing-indicator');
    var addedMessages = new Set();

    if (widget) widget.style.display = 'flex';

    function showTyping(show) {
        if (!typingIndicator) return;
        typingIndicator.style.display = show ? 'block' : 'none';
        if (show && messages) messages.scrollTop = messages.scrollHeight;
    }

    function addMsg(text, type, skipSave, animate) {
        if (!text || addedMessages.has(text)) return;
        addedMessages.add(text);
        var d = document.createElement('div');
        d.className = 'okk-msg ' + type;
        if (messages) {
            if (animate && type === 'ai') {
                showTyping(true);
                setTimeout(function() {
                    showTyping(false);
                    messages.appendChild(d);
                    var i = 0;
                    var interval = setInterval(function() {
                        d.textContent += text[i++];
                        messages.scrollTop = messages.scrollHeight;
                        if (i >= text.length) clearInterval(interval);
                    }, WIDGET_CONFIG.typingSpeed);
                    if (widget && widget.classList.contains('minimized')) showPreview(text);
                }, 1500);
            } else {
                d.textContent = text;
                messages.appendChild(d);
                messages.scrollTop = messages.scrollHeight;
            }
        }
        if (!skipSave) {
            window.OKK_LEAD_CATCHER_CALLBACKS.onMessage({ text: text, type: type });
            var cache = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache) || '[]');
            cache.push({ text: text, type: type });
            localStorage.setItem(WIDGET_CONFIG.storageKeys.chatCache, JSON.stringify(cache.slice(-50)));
        }
    }

    function showPreview(text) {
        if (!preview || !widget || !widget.classList.contains('minimized')) return;
        preview.textContent = WIDGET_CONFIG.agentName + ': ' + (text.length > 60 ? text.substring(0, 60) + '...' : text);
        preview.style.display = 'block';
        setTimeout(function() { preview.style.display = 'none'; }, 6000);
    }

    function restoreChat() {
        if (!messages) return;
        var cacheStr = localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache);
        if (cacheStr) {
            var cache = JSON.parse(cacheStr);
            if (cache.length > 0) {
                messages.innerHTML = '';
                cache.forEach(function(m) {
                    var d = document.createElement('div');
                    d.className = 'okk-msg ' + m.type;
                    d.textContent = m.text;
                    messages.appendChild(d);
                });
                messages.scrollTop = messages.scrollHeight;
            }
        }
        var wasOpen = localStorage.getItem(WIDGET_CONFIG.storageKeys.widgetOpen) === 'true';
        if (wasOpen && widget) {
            widget.classList.remove('minimized');
            if (toggle) toggle.innerHTML = '▼';
        } else if (!localStorage.getItem(WIDGET_CONFIG.storageKeys.hasInteracted)) {
            autoExpandTimer = setTimeout(function() {
                if (widget && widget.classList.contains('minimized')) {
                    widget.classList.remove('minimized');
                    if (toggle) toggle.innerHTML = '▼';
                    window.OKK_LEAD_CATCHER_CALLBACKS.onWidgetToggle(true);
                }
            }, WIDGET_CONFIG.autoExpandDelay);
        }
    }

    async function apiCall(type, extra) {
        extra = extra || {};
        try {
            var res = await fetch(WIDGET_CONFIG.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ type: type, visitorId: tracking.ensureVisitorId(), visitorData: tracking.getPayload() }, extra))
            });
            var data = await res.json();
            if (data.reply && type !== 'init') addMsg(data.reply, 'ai', false, true);
            var cacheStr = localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache);
            var hasHistory = cacheStr && JSON.parse(cacheStr).length > 0;
            if (data.magicGreeting && !hasHistory && !wasGreetingShown()) {
                markGreetingShown();
                lastMessageTimestamp = new Date().toISOString();
                localStorage.setItem('okk_lc_last_msg_time', lastMessageTimestamp);
                var sentences = data.magicGreeting.match(/[^\\.!\\?]+[\\.!\\?]+/g) || [data.magicGreeting];
                var part1 = sentences[0];
                var part2 = sentences.slice(1).join(' ').trim();
                setTimeout(function() {
                    if (localStorage.getItem(WIDGET_CONFIG.storageKeys.hasInteracted) !== 'true') addMsg(part1, 'ai', false, true);
                }, WIDGET_CONFIG.greetingDelay1);
                if (part2) {
                    setTimeout(function() {
                        if (localStorage.getItem(WIDGET_CONFIG.storageKeys.hasInteracted) !== 'true') addMsg(part2, 'ai', false, true);
                    }, WIDGET_CONFIG.greetingDelay2);
                }
                if (WIDGET_CONFIG.quickButtonsEnabled) {
                    setTimeout(function() {
                        if (localStorage.getItem(WIDGET_CONFIG.storageKeys.hasInteracted) !== 'true') addQuickButtons();
                    }, WIDGET_CONFIG.quickButtonsDelay);
                }
            }
            return data;
        } catch(e) { return { error: e.message }; }
    }

    async function poll() {
        try {
            var res = await fetch(WIDGET_CONFIG.apiEndpoint + '?visitorId=' + tracking.ensureVisitorId() + '&after=' + lastMessageTimestamp);
            if (res.ok) {
                var data = await res.json();
                if (data.newMessages && data.newMessages.length > 0) {
                    data.newMessages.forEach(function(m) {
                        addMsg(m.content, m.role === 'system' ? 'system' : 'ai', false, true);
                        lastMessageTimestamp = m.created_at;
                        localStorage.setItem('okk_lc_last_msg_time', lastMessageTimestamp);
                    });
                }
            }
        } catch(e) {}
    }

    // ── Event listeners ────────────────────────────────────────────────────────
    var sendBtn = document.getElementById('okk-lead-catcher-send');
    if (sendBtn) {
        sendBtn.onclick = function() {
            var val = input ? input.value.trim() : '';
            if (val) {
                localStorage.setItem(WIDGET_CONFIG.storageKeys.hasInteracted, 'true');
                if (autoExpandTimer) clearTimeout(autoExpandTimer);
                addMsg(val, 'user', false, false);
                if (input) input.value = '';
                apiCall('chat', { message: val });
            }
        };
    }
    if (input) input.onkeypress = function(e) { if (e.key === 'Enter' && sendBtn) sendBtn.click(); };

    var fileInput = document.getElementById('okk-lead-catcher-file-input');
    var fileBtn = document.getElementById('okk-lead-catcher-file-btn');
    if (fileBtn && fileInput) {
        fileBtn.onclick = function() { fileInput.click(); };
        fileInput.onchange = function(e) {
            var file = e.target.files[0];
            if (file) {
                addMsg('Загрузка файла: ' + file.name + '...', 'system', false, false);
                var formData = new FormData();
                formData.append('file', file);
                formData.append('visitorId', tracking.ensureVisitorId());
                fetch('https://okk.zmksoft.com/api/widget/upload', { method: 'POST', body: formData })
                    .then(function(r) { return r.json(); })
                    .then(function(data) { addMsg(data.success ? '📎 Файл загружен: ' + file.name : '❌ Ошибка: ' + data.error, data.success ? 'user' : 'system', false, false); });
                fileInput.value = '';
            }
        };
    }

    var header = document.getElementById('okk-lead-catcher-header');
    if (header) {
        header.onclick = function() {
            if (!widget) return;
            localStorage.setItem(WIDGET_CONFIG.storageKeys.hasInteracted, 'true');
            if (autoExpandTimer) clearTimeout(autoExpandTimer);
            widget.classList.toggle('minimized');
            var isOpen = !widget.classList.contains('minimized');
            localStorage.setItem(WIDGET_CONFIG.storageKeys.widgetOpen, isOpen);
            if (toggle) toggle.innerHTML = isOpen ? '▼' : '▲';
            if (isOpen && preview) preview.style.display = 'none';
            window.OKK_LEAD_CATCHER_CALLBACKS.onWidgetToggle(isOpen);
        };
    }

    // ── Product cards ──────────────────────────────────────────────────────────
    function addProductCards(products) {
        if (!messages || !products || !products.length) return;
        var wrap = document.createElement('div');
        wrap.className = 'okk-msg ai okk-product-cards-wrap';
        wrap.style.cssText = 'max-width:100%;padding:10px 14px;';
        var label = document.createElement('div');
        label.style.cssText = 'font-size:12px;color:#6b7280;margin-bottom:8px;font-weight:600;';
        label.textContent = 'Вы просматривали (' + products.length + ' товара):';
        wrap.appendChild(label);
        products.forEach(function(item) {
            var name = typeof item === 'string' ? item : item.name;
            var url = typeof item === 'object' && item.url ? item.url : null;
            var img = typeof item === 'object' && item.img ? item.img : null;
            var card = url ? document.createElement('a') : document.createElement('div');
            if (url) { card.href = url; card.target = '_blank'; card.rel = 'noopener noreferrer'; }
            card.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;color:#1e293b;text-decoration:none;';
            var imgEl = document.createElement('img');
            imgEl.style.cssText = 'width:44px;height:44px;object-fit:cover;border-radius:8px;flex-shrink:0;';
            imgEl.alt = name;
            if (img) { imgEl.src = img; imgEl.onerror = function() { imgEl.style.display = 'none'; }; } else { imgEl.style.display = 'none'; }
            var nameEl = document.createElement('span');
            nameEl.style.cssText = 'flex:1;line-height:1.4;';
            nameEl.textContent = name;
            card.appendChild(imgEl); card.appendChild(nameEl);
            if (url) { var arrow = document.createElement('span'); arrow.style.cssText = 'color:${primaryColor};font-size:16px;'; arrow.textContent = '→'; card.appendChild(arrow); }
            wrap.appendChild(card);
        });
        messages.appendChild(wrap);
        messages.scrollTop = messages.scrollHeight;
    }

    // ── Email capture ──────────────────────────────────────────────────────────
    function addEmailCapture() {
        if (!messages || !WIDGET_CONFIG.emailCaptureEnabled) return;
        if (document.getElementById('okk-lc-email-capture')) return;
        var wrap = document.createElement('div');
        wrap.id = 'okk-lc-email-capture';
        wrap.className = 'okk-msg ai';
        wrap.style.cssText = 'padding:0;background:transparent;box-shadow:none;';
        var inner = document.createElement('div');
        inner.style.cssText = 'background:#fff;border:1px solid #d1fae5;border-radius:12px;padding:12px;';
        var hp = document.createElement('input');
        hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off';
        hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        var inp = document.createElement('input');
        inp.type = 'email'; inp.placeholder = 'Ваш email...';
        inp.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;margin-bottom:8px;';
        var btn = document.createElement('button');
        btn.textContent = 'Отправить список на почту';
        btn.style.cssText = 'width:100%;background:${primaryColor};color:#fff;border:none;border-radius:8px;padding:9px;font-size:13px;font-weight:600;cursor:pointer;';
        btn.onclick = function() {
            var email = inp.value.trim();
            if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { inp.style.borderColor = '#ef4444'; return; }
            btn.disabled = true; btn.textContent = 'Отправляю...';
            fetch(WIDGET_CONFIG.wishlistEndpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visitorId: tracking.ensureVisitorId(), email: email, products: getStoredCart().map(function(c) { return c.name; }), _hp: hp.value })
            }).then(function(r) { return r.json(); }).then(function() {
                wrap.remove();
                addMsg('Отлично! Список товаров уже летит на ' + email + ' — проверяйте почту 📬', 'ai', false, false);
            }).catch(function() { btn.disabled = false; btn.textContent = 'Попробовать снова'; });
        };
        inner.appendChild(hp); inner.appendChild(inp); inner.appendChild(btn);
        wrap.appendChild(inner); messages.appendChild(wrap);
        messages.scrollTop = messages.scrollHeight;
    }

    // ── Quick buttons ──────────────────────────────────────────────────────────
    function addQuickButtons() {
        if (!messages || document.getElementById('okk-lc-quick-btns')) return;
        var wrap = document.createElement('div');
        wrap.id = 'okk-lc-quick-btns';
        wrap.className = 'okk-quick-btns';
        [{ label: '📋 Хочу КП', action: 'kp' }, { label: '📞 Позвоните мне', action: 'callback' }, { label: '💬 Есть вопрос', action: 'question' }].forEach(function(cfg) {
            var btn = document.createElement('button');
            btn.className = 'okk-quick-btn'; btn.textContent = cfg.label;
            btn.onclick = function() {
                wrap.remove();
                if (cfg.action === 'kp') {
                    localStorage.setItem(WIDGET_CONFIG.storageKeys.hasInteracted, 'true');
                    addMsg('Хочу получить коммерческое предложение', 'user', false, false);
                    apiCall('chat', { message: 'Хочу получить коммерческое предложение' });
                } else if (cfg.action === 'callback') {
                    addPhoneCapture();
                } else if (cfg.action === 'question') {
                    if (input) {
                        if (widget && widget.classList.contains('minimized')) { widget.classList.remove('minimized'); if (toggle) toggle.innerHTML = '▼'; localStorage.setItem(WIDGET_CONFIG.storageKeys.widgetOpen, 'true'); }
                        input.focus();
                    }
                }
            };
            wrap.appendChild(btn);
        });
        messages.appendChild(wrap); messages.scrollTop = messages.scrollHeight;
    }

    // ── Phone capture ──────────────────────────────────────────────────────────
    function addPhoneCapture() {
        if (!messages || document.getElementById('okk-lc-phone-capture')) return;
        var wrap = document.createElement('div'); wrap.id = 'okk-lc-phone-capture'; wrap.className = 'okk-msg ai';
        wrap.style.cssText = 'padding:0;background:transparent;box-shadow:none;border:none;';
        var inner = document.createElement('div'); inner.style.cssText = 'background:#fff;border:1px solid #d1fae5;border-radius:12px;padding:12px;';
        var fieldStyle = 'width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;margin-bottom:8px;';
        var nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.placeholder = 'Ваше имя...'; nameInp.style.cssText = fieldStyle;
        var phoneInp = document.createElement('input'); phoneInp.type = 'tel'; phoneInp.placeholder = '+7 (___) ___-__-__'; phoneInp.style.cssText = fieldStyle;
        var companyInp = document.createElement('input'); companyInp.type = 'text'; companyInp.placeholder = 'Компания (необязательно)'; companyInp.style.cssText = fieldStyle;
        var submitBtn = document.createElement('button');
        submitBtn.textContent = 'Перезвоните мне';
        submitBtn.style.cssText = 'width:100%;background:${primaryColor};color:#fff;border:none;border-radius:8px;padding:9px;font-size:13px;font-weight:600;cursor:pointer;';
        submitBtn.onclick = function() {
            var name = nameInp.value.trim(); var phone = phoneInp.value.trim(); var company = companyInp.value.trim();
            if (!name) { nameInp.style.borderColor = '#ef4444'; nameInp.focus(); return; }
            if (!phone || !/^(\\+7|8|7)?[\\s\\-]?\\(?[489][0-9]{2}\\)?[\\s\\-]?\\d{3}[\\s\\-]?\\d{2}[\\s\\-]?\\d{2}$/.test(phone.replace(/\\s/g, ''))) { phoneInp.style.borderColor = '#ef4444'; phoneInp.focus(); return; }
            submitBtn.disabled = true; submitBtn.textContent = 'Отправляю...';
            localStorage.setItem(WIDGET_CONFIG.storageKeys.hasInteracted, 'true');
            apiCall('callback', { name: name, phone: phone, company: company || null }).then(function() {
                wrap.remove();
                addMsg('Отлично, ' + name + '! Перезвоним вам на ' + phone + ' в течение 15 минут 📞', 'ai', false, false);
            }).catch(function() { submitBtn.disabled = false; submitBtn.textContent = 'Попробовать снова'; });
        };
        inner.appendChild(nameInp); inner.appendChild(phoneInp); inner.appendChild(companyInp); inner.appendChild(submitBtn);
        wrap.appendChild(inner); messages.appendChild(wrap); messages.scrollTop = messages.scrollHeight;
        nameInp.focus();
    }

    // ── Exit intent ────────────────────────────────────────────────────────────
    function triggerExitIntent() {
        if (localStorage.getItem(WIDGET_CONFIG.storageKeys.exitIntentFired)) return;
        var products = getStoredCart();
        if (products.length === 0) {
            var h1 = document.querySelector('h1');
            if (h1 && h1.innerText && h1.innerText.trim().length > 2) {
                var pageUrl = window.location.href;
                var ogImg = document.querySelector('meta[property="og:image"]');
                var bodyImg = document.querySelector('img[alt],img[src]');
                var img = ogImg ? ogImg.getAttribute('content') : (bodyImg ? bodyImg.src : '');
                products = [{ name: h1.innerText.trim(), url: pageUrl, img: img }];
                setStoredCart(products);
            }
        }
        if (products.length === 0) return;
        localStorage.setItem(WIDGET_CONFIG.storageKeys.exitIntentFired, '1');
        if (widget && widget.classList.contains('minimized')) {
            widget.classList.remove('minimized');
            if (toggle) toggle.innerHTML = '▼';
            localStorage.setItem(WIDGET_CONFIG.storageKeys.widgetOpen, 'true');
            window.OKK_LEAD_CATCHER_CALLBACKS.onWidgetToggle(true);
        }
        addProductCards(products);
        setTimeout(function() {
            addMsg('Подождите, не уходите! Вы просматривали товары — отправить список вам на почту, чтобы не потерять?', 'ai', false, false);
            addEmailCapture();
        }, 400);
    }

    function setupExitIntent() {
        if (!WIDGET_CONFIG.exitIntentEnabled) return;
        if (localStorage.getItem(WIDGET_CONFIG.storageKeys.exitIntentFired)) return;
        // Не показываем exit-intent пока пользователь не посетил ≥2 страниц
        var visitedPages = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]');
        if (visitedPages.length < 2) {
            if (!scenario.exitIntentPending) {
                scenario.exitIntentPending = true;
                setTimeout(function() { scenario.exitIntentPending = false; setupExitIntent(); }, 8000);
            }
            return;
        }
        if (scenario.listenersBound) return;
        scenario.listenersBound = true;
        var fired = false;
        function fireOnce(reason) {
            if (fired || scenario.pageExitPromptShown) return;
            fired = true; scenario.pageExitPromptShown = true;
            triggerExitIntent();
        }
        document.documentElement.addEventListener('mouseleave', function() { fireOnce('mouseleave'); }, { passive: true });
        document.addEventListener('mouseout', function(e) { if (!e.relatedTarget && !e.toElement && e.clientY <= 0) fireOnce('mouseout'); }, { passive: true });
        document.addEventListener('pointerout', function(e) { if (!e.relatedTarget && !e.toElement && e.clientY <= 0) fireOnce('pointerout'); }, { passive: true });
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') fireOnce('escape'); });
        window.addEventListener('blur', function() { fireOnce('blur'); }, { passive: true });
        var exitTimer = null;
        document.addEventListener('mousemove', function(e) {
            if (e.clientY < 80) { if (!exitTimer) exitTimer = setTimeout(function() { fireOnce('mousemove.top'); }, 150); }
            else { if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; } }
        }, { passive: true });
    }

    // ── Boot ───────────────────────────────────────────────────────────────────
    restoreChat();
    await apiCall('init');
    lastMessageTimestamp = new Date().toISOString();
    localStorage.setItem('okk_lc_last_msg_time', lastMessageTimestamp);
    setupExitIntent();
    // Перепроверяем exit-intent при каждом возврате на страницу (bfcache/history navigation)
    window.addEventListener('pageshow', function() { setupExitIntent(); });
    setInterval(poll, WIDGET_CONFIG.pollingInterval);
}

var wasInitialized = localStorage.getItem('okk_lc_first_load_done');
var actualDelay = wasInitialized ? 100 : WIDGET_CONFIG.lazyLoadMs;
function startInit() {
    setTimeout(function() { initWidget(); localStorage.setItem('okk_lc_first_load_done', 'true'); }, actualDelay);
}
if (document.readyState === 'complete') { startInit(); } else { window.addEventListener('load', startInit); }
})();
`.trim();

    return new NextResponse(js, {
        headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
            'Access-Control-Allow-Origin': '*',
        },
    });
}

// ── Вспомогательные функции генерации HTML/CSS ──────────────────────────────

function buildHTML(agentName: string, agentTitle: string, avatarUrl: string, primaryColor: string): string {
    const initial = agentName.charAt(0);
    return `<div id="okk-lead-catcher-widget" class="minimized" style="display:none;">
  <div id="okk-lead-catcher-header">
    <div class="okk-agent-info">
      <img src="${avatarUrl}" alt="${agentName}" class="okk-agent-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=${primaryColor.slice(1)}&color=fff'">
      <div>
        <div style="font-size:14px;font-weight:700;">${agentName}</div>
        <div style="font-size:11px;opacity:0.9;">${agentTitle}</div>
      </div>
    </div>
    <span id="okk-lead-catcher-toggle">▲</span>
  </div>
  <div id="okk-lead-catcher-messages">
    <div id="okk-typing-indicator" style="display:none;align-self:flex-start;" class="okk-msg ai">
      <div class="okk-typing-dots"><div class="okk-dot"></div><div class="okk-dot"></div><div class="okk-dot"></div></div>
    </div>
  </div>
  <div id="okk-lead-catcher-input-area">
    <button id="okk-lead-catcher-file-btn" title="Прикрепить файл">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.5,6V17.5A4,4 0 0,1 12.5,21.5A4,4 0 0,1 8.5,17.5V5A2.5,2.5 0 0,1 11,2.5A2.5,2.5 0 0,1 13.5,5V15.5A1,1 0 0,1 12.5,16.5A1,1 0 0,1 11.5,15.5V6H10V15.5A2.5,2.5 0 0,0 12.5,18A2.5,2.5 0 0,0 15,15.5V5A4,4 0 0,0 11,1A4,4 0 0,0 7,5V17.5A5.5,5.5 0 0,0 12.5,23A5.5,5.5 0 0,0 18,17.5V6H16.5Z"/></svg>
    </button>
    <input type="file" id="okk-lead-catcher-file-input" style="display:none;">
    <input type="text" id="okk-lead-catcher-input" placeholder="Введите ваш вопрос...">
    <button id="okk-lead-catcher-send" title="Отправить">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M2,21L23,12L2,3V10L17,12L2,14V21Z"/></svg>
    </button>
  </div>
</div>
<div id="okk-lead-catcher-preview"></div>`;
}

function buildCSS(primaryColor: string, bottom: number, right: number, previewBottom: number): string {
    return `
#okk-lead-catcher-widget{position:fixed;bottom:${bottom}px;right:${right}px;width:360px;height:550px;background:#fff;border-radius:24px;box-shadow:0 10px 50px rgba(0,0,0,.15);display:flex;flex-direction:column;font-family:-apple-system,system-ui,sans-serif;z-index:2147483647;overflow:hidden;transition:all .4s cubic-bezier(.175,.885,.32,1.275);border:1px solid rgba(0,0,0,.05);}
#okk-lead-catcher-widget.minimized{height:70px;}
#okk-lead-catcher-header{background:#fff;color:#333;padding:18px 24px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f0f0f0;font-weight:600;user-select:none;}
.okk-agent-info{display:flex;align-items:center;gap:12px;}
.okk-agent-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;}
#okk-lead-catcher-messages{flex:1;padding:20px;overflow-y:auto;background:#f9fafb;display:flex;flex-direction:column;gap:12px;}
.okk-msg{max-width:85%;padding:12px 16px;border-radius:18px;font-size:14px;line-height:1.5;position:relative;animation:okkFadeIn .3s ease-out;white-space:pre-wrap;word-wrap:break-word;}
@keyframes okkFadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.okk-msg.ai{background:#fff;color:#1f2937;align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,.02);border:1px solid #f3f4f6;}
.okk-msg.user{background:${primaryColor};color:#fff;align-self:flex-end;border-bottom-right-radius:4px;}
.okk-msg.system{background:transparent;color:#9ca3af;font-size:11px;text-align:center;align-self:center;width:100%;}
#okk-lead-catcher-input-area{padding:16px;background:#fff;border-top:1px solid #f3f4f6;display:flex;align-items:center;gap:10px;}
#okk-lead-catcher-input{flex:1;border:1px solid #e5e7eb;border-radius:20px;padding:10px 16px;outline:none;font-size:14px;}
#okk-lead-catcher-send,#okk-lead-catcher-file-btn{background:none;border:none;color:${primaryColor};cursor:pointer;display:flex;align-items:center;}
.okk-quick-btns{display:flex;gap:8px;overflow-x:auto;padding:2px 0 6px;scrollbar-width:none;align-self:flex-start;max-width:100%;animation:okkFadeIn .3s ease-out;}
.okk-quick-btns::-webkit-scrollbar{display:none;}
.okk-quick-btn{flex-shrink:0;background:#f0fdf4;color:#059669;border:1px solid #a7f3d0;border-radius:20px;padding:7px 14px;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s;}
.okk-quick-btn:hover{background:#d1fae5;border-color:#6ee7b7;}
.okk-typing-dots{display:flex;gap:4px;padding:4px 0;}
.okk-dot{width:6px;height:6px;background:${primaryColor};border-radius:50%;animation:okkDotPulse 1.4s infinite ease-in-out;}
.okk-dot:nth-child(2){animation-delay:.2s;}
.okk-dot:nth-child(3){animation-delay:.4s;}
@keyframes okkDotPulse{0%,80%,100%{transform:scale(.3);opacity:.3}40%{transform:scale(1);opacity:1}}
#okk-lead-catcher-preview{position:fixed;bottom:${previewBottom}px;right:${right}px;background:#fff;padding:12px 18px;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.1);max-width:280px;font-size:13px;color:#333;display:none;z-index:2147483646;animation:okkFadeIn .3s ease-out;border-bottom-right-radius:4px;}
`.trim();
}
