<!-- Блок Webasyst: ОКК: Ловец лидов (Турбо-версия с колбэками и Lazy Loading) -->
{literal}
<div id="okk-lead-catcher-widget" class="minimized" style="display: none;">
    <div id="okk-lead-catcher-header">
        <div class="agent-info">
            <img src="https://okk.zmksoft.com/images/agents/elena.png" alt="Елена" class="agent-avatar" onerror="this.src='https://ui-avatars.com/api/?name=Елена&background=10b981&color=fff'">
            <div>
                <div style="font-size: 14px; font-weight: 700;">Елена (ЗМК)</div>
                <div class="agent-status" style="font-size: 11px; opacity: 0.9;">В сети • Продуктолог</div>
            </div>
        </div>
        <span id="okk-lead-catcher-toggle">▲</span>
    </div>
    
    <div id="okk-lead-catcher-messages">
        <div id="okk-typing-indicator" style="display:none; align-self:flex-start;" class="okk-msg ai">
            <div class="okk-typing-dots">
                <div class="okk-dot"></div><div class="okk-dot"></div><div class="okk-dot"></div>
            </div>
        </div>
    </div>

    <div id="okk-lead-catcher-input-area">
        <button id="okk-lead-catcher-file-btn" title="Прикрепить файл">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.5,6V17.5A4,4 0 0,1 12.5,21.5A4,4 0 0,1 8.5,17.5V5A2.5,2.5 0 0,1 11,2.5A2.5,2.5 0 0,1 13.5,5V15.5A1,1 0 0,1 12.5,16.5A1,1 0 0,1 11.5,15.5V6H10V15.5A2.5,2.5 0 0,0 12.5,18A2.5,2.5 0 0,0 15,15.5V5A4,4 0 0,0 11,1A4,4 0 0,0 7,5V17.5A5.5,5.5 0 0,0 12.5,23A5.5,5.5 0 0,0 18,17.5V6H16.5Z" /></svg>
        </button>
        <input type="file" id="okk-lead-catcher-file-input" style="display: none;">
        <input type="text" id="okk-lead-catcher-input" placeholder="Введите ваш вопрос...">
        <button id="okk-lead-catcher-send" title="Отправить">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M2,21L23,12L2,3V10L17,12L2,14V21Z" /></svg>
        </button>
    </div>
</div>

<div id="okk-lead-catcher-preview"></div>

<style>
    #okk-lead-catcher-widget {
        position: fixed;
        bottom: 260px;
        right: 20px;
        width: 360px;
        height: 550px; /* Высота в развернутом виде */
        background: #ffffff;
        border-radius: 24px;
        box-shadow: 0 10px 50px rgba(0,0,0,0.15);
        display: flex;
        flex-direction: column;
        font-family: -apple-system, system-ui, sans-serif;
        z-index: 2147483647;
        overflow: hidden;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        border: 1px solid rgba(0,0,0,0.05);
    }

    #okk-lead-catcher-widget.minimized {
        height: 70px; /* Высота только шапки */
    }

    #okk-lead-catcher-header {
        background: #ffffff;
        color: #333;
        padding: 18px 24px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #f0f0f0;
        font-weight: 600;
        user-select: none;
    }

    #okk-lead-catcher-header .agent-info {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    #okk-lead-catcher-header .agent-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
    }

    #okk-lead-catcher-messages {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
        background: #f9fafb;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .okk-msg {
        max-width: 85%;
        padding: 12px 16px;
        border-radius: 18px;
        font-size: 14px;
        line-height: 1.5;
        position: relative;
        animation: okkFadeIn 0.3s ease-out;
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    @keyframes okkFadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .okk-msg.ai { background: #ffffff; color: #1f2937; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); border: 1px solid #f3f4f6; }
    .okk-msg.user { background: #10b981; color: #ffffff; align-self: flex-end; border-bottom-right-radius: 4px; }
    .okk-msg.system { background: transparent; color: #9ca3af; font-size: 11px; text-align: center; align-self: center; width: 100%; }

    #okk-lead-catcher-input-area {
        padding: 16px;
        background: #fff;
        border-top: 1px solid #f3f4f6;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    #okk-lead-catcher-input {
        flex: 1;
        border: 1px solid #e5e7eb;
        border-radius: 20px;
        padding: 10px 16px;
        outline: none;
        font-size: 14px;
    }

    #okk-lead-catcher-send, #okk-lead-catcher-file-btn {
        background: none;
        border: none;
        color: #10b981;
        cursor: pointer;
        display: flex;
        align-items: center;
    }

    .okk-typing-dots { display: flex; gap: 4px; padding: 4px 0; }
    .okk-dot { width: 6px; height: 6px; background: #10b981; border-radius: 50%; animation: okkDotPulse 1.4s infinite ease-in-out; }
    .okk-dot:nth-child(2) { animation-delay: 0.2s; }
    .okk-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes okkDotPulse { 0%, 80%, 100% { transform: scale(0.3); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }

    #okk-lead-catcher-preview {
        position: fixed;
        bottom: 340px; /* ПРИПОДНЯТО: Соответственно виджету */
        right: 20px;
        background: #ffffff;
        padding: 12px 18px;
        border-radius: 18px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        max-width: 280px;
        font-size: 13px;
        color: #333;
        display: none;
        z-index: 2147483646;
        animation: okkFadeIn 0.3s ease-out;
        border-bottom-right-radius: 4px;
    }
</style>

<script>
(function() {
    // 1. Конфигурация колбэков (можно переопределить на сайте)
    window.OKK_LEAD_CATCHER_CALLBACKS = window.OKK_LEAD_CATCHER_CALLBACKS || {
        onMessage: (msg) => console.log('[OKK] New message:', msg),
        onLeadCaptured: (data) => console.log('[OKK] Lead data detected:', data),
        onWidgetToggle: (isOpen) => console.log('[OKK] Widget is ' + (isOpen ? 'open' : 'closed'))
    };

    const WIDGET_CONFIG = {
        apiEndpoint: 'https://okk.zmksoft.com/api/widget/chat',
        wishlistEndpoint: 'https://okk.zmksoft.com/api/widget/wishlist-email',
        storageKeys: {
            visitorId: 'okk_lc_visitor_id',
            utm: 'okk_lc_utm',
            history: 'okk_lc_pages',
            landing: 'okk_lc_landing',
            cart: 'okk_lc_cart',
            widgetOpen: 'okk_lc_widget_open',
            chatCache: 'okk_lc_chat_cache',
            hasInteracted: 'okk_lc_has_interacted',
            exitIntentFired: 'okk_lc_exit_intent_fired'
        },
        maxHistory: 20,
        interestTimerMs: 2000,
        pollingInterval: 3000,
        autoExpandDelay: 30000, 
        typingSpeed: 25,
        lazyLoadMs: 500 // минимальная задержка первой загрузки
    };

    async function initWidget() {
        console.log('[OKK Widget] initWidget starting...');
        let lastMessageTimestamp = localStorage.getItem('okk_lc_last_msg_time') || new Date().toISOString();
        let autoExpandTimer = null;

        function getStoredCart() {
            try {
                const raw = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.cart) || '[]');
                if (!Array.isArray(raw)) return [];
                // Сохраняем только объектные записи товаров, вычищаем легаси-строки (категории/старый формат)
                return raw.filter(item => item && typeof item === 'object' && !!item.name && !!item.url);
            } catch (_) {
                return [];
            }
        }

        function setStoredCart(cart) {
            localStorage.setItem(WIDGET_CONFIG.storageKeys.cart, JSON.stringify(cart.slice(-WIDGET_CONFIG.maxHistory)));
        }

        const tracking = {
            init: function() {
                this.ensureVisitorId();
                this.trackUTM();
                this.trackLandingPage();
                this.trackPageView();
                this.setupInterestTimer();
            },
            ensureVisitorId: function() {
                let id = localStorage.getItem(WIDGET_CONFIG.storageKeys.visitorId);
                if (!id) {
                    id = 'v_lc_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
                    localStorage.setItem(WIDGET_CONFIG.storageKeys.visitorId, id);
                }
                return id;
            },
            trackUTM: function() {
                const params = new URLSearchParams(window.location.search);
                const utm = {};
                ['source', 'medium', 'campaign', 'content', 'term'].forEach(k => {
                    if (params.get('utm_'+k)) utm[k] = params.get('utm_'+k);
                });
                if (Object.keys(utm).length) localStorage.setItem(WIDGET_CONFIG.storageKeys.utm, JSON.stringify(utm));
            },
            trackLandingPage: function() {
                if (!localStorage.getItem(WIDGET_CONFIG.storageKeys.landing)) {
                    localStorage.setItem(WIDGET_CONFIG.storageKeys.landing, window.location.href);
                }
            },
            trackPageView: function() {
                let history = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]');
                history.push({ url: window.location.pathname, title: document.title });
                localStorage.setItem(WIDGET_CONFIG.storageKeys.history, JSON.stringify(history.slice(-WIDGET_CONFIG.maxHistory)));
            },
            setupInterestTimer: function() {
                const h1 = document.querySelector('h1');
                if (!h1) {
                    console.log('[OKK Widget] setupInterestTimer: no h1 found');
                    return;
                }

                // ============ МАКСИМАЛЬНО МЯГКИЙ ФИЛЬТР ============
                
                // Проверка 1: мета-теги и JSON-LD (стандартные)
                const ogTypeMeta = document.querySelector('meta[property="og:type"]');
                const ogType = ogTypeMeta ? ogTypeMeta.getAttribute('content') : '';
                const hasProductLdJson = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                    .some(s => /"@type"\s*:\s*"Product"/i.test(s.textContent || ''));
                
                if (ogType === 'product' || hasProductLdJson) {
                    console.log('[OKK Widget] setupInterestTimer: detected by meta/JSON-LD');
                } else {
                    // Проверка 2: очень мягкие условия - просто наличие цены ИЛИ кнопки
                    const hasAnyPrice = !!document.querySelector(
                        '[class*="price"], [class*="cost"], [class*="amount"], [id*="price"], ' +
                        '[data-price], [itemprop*="price"], input[value*="₽"]'
                    ) || /₽|рубль|\d+\s+[p₽]/.test(document.body.innerText);
                    
                    const hasAnyBuyBtn = !!document.querySelector(
                        'button, a[href*="cart"], input[type="button"], input[type="submit"], ' +
                        '[class*="buy"], [class*="cart"], [class*="order"], [id*="cart"], [id*="buy"]'
                    ) || /Купить|В корзину|Заказать|Buy|Добавить|корзин|заказ/i.test(document.body.innerText);
                    
                    const isNotListingPage = !document.querySelector(
                        '.products, .product-list, .shop-products, [class*="products"], ' +
                        '[class*="catalog"], [class*="category"], [id*="products"]'
                    );
                    
                    if (!(hasAnyPrice && hasAnyBuyBtn && isNotListingPage)) {
                        console.log('[OKK Widget] setupInterestTimer: not a product page. hasPrice=' + hasAnyPrice + 
                            ', hasBuyBtn=' + hasAnyBuyBtn + ', isNotListing=' + isNotListingPage);
                        return;
                    }
                    console.log('[OKK Widget] setupInterestTimer: detected by soft filters');
                }

                console.log('[OKK Widget] setupInterestTimer: isProductPage=true, h1=' + h1.innerText);

                setTimeout(() => {
                    let cart = getStoredCart();
                    const pageUrl = window.location.href;
                    
                    // Уже есть этот товар?
                    if (cart.find(c => c.url === pageUrl)) {
                        console.log('[OKK Widget] Already in cart:', pageUrl);
                        return;
                    }
                    
                    // Картинка: og:image → первый img
                    const ogImg = document.querySelector('meta[property="og:image"]');
                    const bodyImg = document.querySelector('img[alt], img[src]');
                    const img = ogImg ? ogImg.getAttribute('content') : (bodyImg ? bodyImg.src : '');
                    
                    const item = { name: h1.innerText.trim(), url: pageUrl, img: img };
                    cart.push(item);
                    setStoredCart(cart);
                    console.log('[OKK Widget] Added to cart:', item, 'cart now has:', cart.length, 'items');
                }, WIDGET_CONFIG.interestTimerMs);
            },
            getPayload: function() {
                const cartNames = getStoredCart().map(c => c.name);
                return {
                    domain: window.location.hostname,
                    utm: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.utm) || '{}'),
                    visitedPages: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]'),
                    cartItems: cartNames,
                    landingPage: localStorage.getItem(WIDGET_CONFIG.storageKeys.landing)
                };
            }
        };

        tracking.init();

        const widget = document.getElementById('okk-lead-catcher-widget');
        const input = document.getElementById('okk-lead-catcher-input');
        const messages = document.getElementById('okk-lead-catcher-messages');
        const toggle = document.getElementById('okk-lead-catcher-toggle');
        const preview = document.getElementById('okk-lead-catcher-preview');
        const typingIndicator = document.getElementById('okk-typing-indicator');
        const addedMessages = new Set();

        // Покажем виджет после инициализации
        if (widget) widget.style.display = 'flex';

        function checkLeadData(text) {
            const phoneMatch = text.match(/(\+7|8|7)?[\s\-]?\(?[489][0-9]{2}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
            const emailMatch = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
            if (phoneMatch || emailMatch) {
                window.OKK_LEAD_CATCHER_CALLBACKS.onLeadCaptured({
                    phone: phoneMatch ? phoneMatch[0] : null,
                    email: emailMatch ? emailMatch[0] : null
                });
            }
        }

        function showTyping(show) {
            if (!typingIndicator) return;
            typingIndicator.style.display = show ? 'block' : 'none';
            if (show) messages.scrollTop = messages.scrollHeight;
        }

        function addMsg(text, type, skipSave = false, animate = false) {
            if (!text) return;

            // Защита от дублей (даже если сообщение еще анимируется)
            if (addedMessages.has(text)) return;
            addedMessages.add(text);

            const d = document.createElement('div');
            d.className = 'okk-msg ' + type;
            
            if (messages) {
                if (animate && type === 'ai') {
                    showTyping(true);
                    setTimeout(() => {
                        showTyping(false);
                        messages.appendChild(d);
                        let i = 0;
                        const interval = setInterval(() => {
                            d.textContent += text[i++];
                            messages.scrollTop = messages.scrollHeight;
                            if (i >= text.length) clearInterval(interval);
                        }, WIDGET_CONFIG.typingSpeed);
                        if (widget.classList.contains('minimized')) showPreview(text);
                    }, 1500); 
                } else {
                    d.textContent = text;
                    messages.appendChild(d);
                    messages.scrollTop = messages.scrollHeight;
                }
            }

            // Вызов колбэка сообщения
            if (!skipSave) {
                window.OKK_LEAD_CATCHER_CALLBACKS.onMessage({ text, type });
                if (type === 'user') checkLeadData(text);
                
                const cache = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache) || '[]');
                cache.push({ text, type });
                localStorage.setItem(WIDGET_CONFIG.storageKeys.chatCache, JSON.stringify(cache.slice(-50)));
            }
        }

        function showPreview(text) {
            if (!preview || !widget.classList.contains('minimized')) return;
            preview.textContent = "Елена: " + (text.length > 60 ? text.substring(0, 60) + "..." : text);
            preview.style.display = 'block';
            setTimeout(() => preview.style.display = 'none', 6000);
        }

        function restoreChat() {
            if (!messages) return;
            const cacheStr = localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache);
            if (cacheStr) {
                const cache = JSON.parse(cacheStr);
                if (cache.length > 0) {
                    messages.innerHTML = ''; 
                    cache.forEach(m => {
                        const d = document.createElement('div');
                        d.className = 'okk-msg ' + m.type;
                        d.textContent = m.text;
                        messages.appendChild(d);
                    });
                    messages.scrollTop = messages.scrollHeight;
                }
            }

            const wasOpen = localStorage.getItem(WIDGET_CONFIG.storageKeys.widgetOpen) === 'true';
            if (wasOpen && widget) {
                widget.classList.remove('minimized');
                if (toggle) toggle.innerHTML = '▼';
            } else {
                const interacted = localStorage.getItem(WIDGET_CONFIG.storageKeys.hasInteracted);
                if (!interacted) {
                    autoExpandTimer = setTimeout(() => {
                        if (widget.classList.contains('minimized')) {
                            widget.classList.remove('minimized');
                            if (toggle) toggle.innerHTML = '▼';
                            window.OKK_LEAD_CATCHER_CALLBACKS.onWidgetToggle(true);
                        }
                    }, WIDGET_CONFIG.autoExpandDelay);
                }
            }
        }

        async function apiCall(type, extra = {}) {
            try {
                console.log('[OKK Widget] apiCall:', type, 'with data:', tracking.getPayload());
                const res = await fetch(WIDGET_CONFIG.apiEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type,
                        visitorId: tracking.ensureVisitorId(),
                        visitorData: tracking.getPayload(),
                        ...extra
                    })
                });
                const data = await res.json();
                console.log('[OKK Widget] apiCall response:', type, data);
                
                // НЕ показываем data.reply если это тип 'init' и есть magicGreeting
                if (data.reply && type !== 'init') {
                    addMsg(data.reply, 'ai', false, true);
                }
                
                const cacheStr = localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache);
                const hasHistory = cacheStr && JSON.parse(cacheStr).length > 0;
                
                if (data.magicGreeting && !hasHistory) {
                    console.log('[OKK Widget] Got magicGreeting:', data.magicGreeting);
                    // Предотвращаем подхват этого сообщения через poll
                    lastMessageTimestamp = new Date().toISOString();
                    localStorage.setItem('okk_lc_last_msg_time', lastMessageTimestamp);

                    // Разбиваем сообщение на две части
                    let part1, part2;
                    if (data.magicGreeting.includes("Могу помочь вам подобрать оборудование.")) {
                        part1 = "Добрый день! Я Елена, эксперт ЗМК. Могу помочь вам подобрать оборудование.";
                        part2 = "Вы можете прикрепить файл с ТЗ, прислать список текстом или просто задать вопрос — я подберу модели под ваши параметры.";
                    } else {
                        const sentences = data.magicGreeting.match(/[^\.!\?]+[\.!\?]+/g) || [data.magicGreeting];
                        part1 = sentences[0];
                        part2 = sentences.slice(1).join(' ').trim();
                    }
                    
                    // Первое сообщение через 10 секунд
                    setTimeout(() => {
                        const interacted = localStorage.getItem(WIDGET_CONFIG.storageKeys.hasInteracted) === 'true';
                        if (!interacted) {
                            console.log('[OKK Widget] Showing greeting part1:', part1);
                            addMsg(part1, 'ai', false, true);
                        }
                    }, 10000);
                    
                    // Второе сообщение через 20 секунд (10+10)
                    if (part2) {
                        setTimeout(() => {
                            const interacted = localStorage.getItem(WIDGET_CONFIG.storageKeys.hasInteracted) === 'true';
                            if (!interacted) {
                                console.log('[OKK Widget] Showing greeting part2:', part2);
                                addMsg(part2, 'ai', false, true);
                            }
                        }, 20000);
                    }
                }
                return data;
            } catch (e) { 
                console.error('[OKK Widget] apiCall error:', e);
                return { error: e.message }; 
            }
        }

        async function poll() {
            try {
                const res = await fetch(`${WIDGET_CONFIG.apiEndpoint}?visitorId=${tracking.ensureVisitorId()}&after=${lastMessageTimestamp}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.newMessages && data.newMessages.length > 0) {
                        data.newMessages.forEach(m => {
                            const type = m.role === 'system' ? 'system' : 'ai';
                            addMsg(m.content, type, false, true);
                            lastMessageTimestamp = m.created_at;
                            localStorage.setItem('okk_lc_last_msg_time', lastMessageTimestamp);
                        });
                    }
                }
            } catch (e) {}
        }

        if (document.getElementById('okk-lead-catcher-send')) {
            document.getElementById('okk-lead-catcher-send').onclick = () => {
                const val = input.value.trim();
                if (val) {
                    localStorage.setItem(WIDGET_CONFIG.storageKeys.hasInteracted, 'true');
                    if (autoExpandTimer) clearTimeout(autoExpandTimer);
                    addMsg(val, 'user');
                    input.value = '';
                    apiCall('chat', { message: val });
                }
            };
        }

        if (input) {
            input.onkeypress = (e) => { if (e.key === 'Enter') document.getElementById('okk-lead-catcher-send').click(); };
        }

        const fileInput = document.getElementById('okk-lead-catcher-file-input');
        const fileBtn = document.getElementById('okk-lead-catcher-file-btn');
        if (fileBtn && fileInput) {
            fileBtn.onclick = () => fileInput.click();
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    addMsg(`Загрузка файла: ${file.name}...`, 'system');
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('visitorId', tracking.ensureVisitorId());
                    fetch('https://okk.zmksoft.com/api/widget/upload', { method: 'POST', body: formData })
                        .then(r => r.json()).then(data => {
                            if (data.success) addMsg(`📎 Файл загружен: ${file.name}`, 'user');
                            else addMsg(`❌ Ошибка: ${data.error}`, 'system');
                        });
                    fileInput.value = '';
                }
            };
        }
        
        if (document.getElementById('okk-lead-catcher-header')) {
            document.getElementById('okk-lead-catcher-header').onclick = () => {
                if (widget) {
                    localStorage.setItem(WIDGET_CONFIG.storageKeys.hasInteracted, 'true');
                    if (autoExpandTimer) clearTimeout(autoExpandTimer);
                    widget.classList.toggle('minimized');
                    const isOpen = !widget.classList.contains('minimized');
                    localStorage.setItem(WIDGET_CONFIG.storageKeys.widgetOpen, isOpen);
                    if (toggle) toggle.innerHTML = isOpen ? '▼' : '▲';
                    if (isOpen && preview) preview.style.display = 'none';
                    
                    window.OKK_LEAD_CATCHER_CALLBACKS.onWidgetToggle(isOpen);
                }
            };
        }

        // ─── WISHLIST / EXIT-INTENT ────────────────────────────────────────────

        function addProductCards(products) {
            if (!messages || !products || products.length === 0) return;
            const wrap = document.createElement('div');
            wrap.className = 'okk-msg ai okk-product-cards-wrap';
            wrap.style.cssText = 'max-width:100%;padding:10px 14px;';

            const label = document.createElement('div');
            label.style.cssText = 'font-size:12px;color:#6b7280;margin-bottom:8px;font-weight:600;';
            label.textContent = 'Вы просматривали (' + products.length + ' товара):';
            wrap.appendChild(label);

            products.forEach(function(item) {
                const name = typeof item === 'string' ? item : item.name;
                const url  = typeof item === 'object' && item.url  ? item.url  : null;
                const img  = typeof item === 'object' && item.img  ? item.img  : null;

                const card = url ? document.createElement('a') : document.createElement('div');
                if (url) {
                    card.href = url;
                    card.target = '_blank';
                    card.rel = 'noopener noreferrer';
                }
                card.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;color:#1e293b;text-decoration:none;cursor:' + (url ? 'pointer' : 'default') + ';transition:background 0.15s;';
                if (url) {
                    card.onmouseenter = function() { card.style.background = '#f0fdf4'; card.style.borderColor = '#86efac'; };
                    card.onmouseleave = function() { card.style.background = '#f8fafc'; card.style.borderColor = '#e2e8f0'; };
                }

                const imgEl = document.createElement('img');
                imgEl.style.cssText = 'width:44px;height:44px;object-fit:cover;border-radius:8px;flex-shrink:0;background:#e2e8f0;';
                imgEl.alt = name;
                if (img) {
                    imgEl.src = img;
                    imgEl.onerror = function() { imgEl.style.display = 'none'; };
                } else {
                    imgEl.style.display = 'none';
                }

                const nameEl = document.createElement('span');
                nameEl.style.cssText = 'flex:1;line-height:1.4;';
                nameEl.textContent = name;

                if (url) {
                    const arrow = document.createElement('span');
                    arrow.style.cssText = 'color:#10b981;font-size:16px;flex-shrink:0;';
                    arrow.textContent = '→';
                    card.appendChild(imgEl);
                    card.appendChild(nameEl);
                    card.appendChild(arrow);
                } else {
                    card.appendChild(imgEl);
                    card.appendChild(nameEl);
                }

                wrap.appendChild(card);
            });

            messages.appendChild(wrap);
            messages.scrollTop = messages.scrollHeight;
        }

        function addEmailCapture() {
            if (!messages) return;
            if (document.getElementById('okk-lc-email-capture')) return;

            const wrap = document.createElement('div');
            wrap.id = 'okk-lc-email-capture';
            wrap.className = 'okk-msg ai';
            wrap.style.cssText = 'padding:0;background:transparent;box-shadow:none;';

            const inner = document.createElement('div');
            inner.style.cssText = 'background:#fff;border:1px solid #d1fae5;border-radius:12px;padding:12px;';

            const inp = document.createElement('input');
            inp.type = 'email';
            inp.placeholder = 'Ваш email...';
            inp.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;margin-bottom:8px;';

            const btn = document.createElement('button');
            btn.textContent = 'Отправить список на почту';
            btn.style.cssText = 'width:100%;background:#10b981;color:#fff;border:none;border-radius:8px;padding:9px;font-size:13px;font-weight:600;cursor:pointer;';
            btn.onclick = function() {
                const email = inp.value.trim();
                if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    inp.style.borderColor = '#ef4444';
                    return;
                }
                btn.disabled = true;
                btn.textContent = 'Отправляю...';
                const products = getStoredCart().map(c => c.name);
                fetch(WIDGET_CONFIG.wishlistEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        visitorId: tracking.ensureVisitorId(),
                        email: email,
                        products: products
                    })
                }).then(function(r) { return r.json(); }).then(function() {
                    wrap.remove();
                    addMsg('Отлично! Список товаров уже летит на ' + email + ' — проверяйте почту 📬', 'ai', false, false);
                }).catch(function() {
                    btn.disabled = false;
                    btn.textContent = 'Попробовать снова';
                });
            };

            inner.appendChild(inp);
            inner.appendChild(btn);
            wrap.appendChild(inner);
            messages.appendChild(wrap);
            messages.scrollTop = messages.scrollHeight;
        }

        function triggerExitIntent() {
            console.log('[OKK Widget] triggerExitIntent called');
            if (localStorage.getItem(WIDGET_CONFIG.storageKeys.exitIntentFired)) {
                console.log('[OKK Widget] exitIntentFired already set, skipping');
                return;
            }
            const products = getStoredCart();
            console.log('[OKK Widget] stored cart products:', products);
            if (products.length === 0) {
                console.log('[OKK Widget] no products in cart, skipping');
                return;
            }

            localStorage.setItem(WIDGET_CONFIG.storageKeys.exitIntentFired, '1');

            if (widget && widget.classList.contains('minimized')) {
                widget.classList.remove('minimized');
                if (toggle) toggle.innerHTML = '▼';
                localStorage.setItem(WIDGET_CONFIG.storageKeys.widgetOpen, 'true');
                window.OKK_LEAD_CATCHER_CALLBACKS.onWidgetToggle(true);
            }

            addProductCards(products);
            setTimeout(function() {
                addMsg('Подождите, не уходите! Вы просматривали товары — отправить список вам на почту, чтобы не потерять?', 'ai', false, true);
                setTimeout(addEmailCapture, 2000);
            }, 400);
        }

        function setupExitIntent() {
            console.log('[OKK Widget] setupExitIntent starting');
            if (localStorage.getItem(WIDGET_CONFIG.storageKeys.exitIntentFired)) {
                console.log('[OKK Widget] exitIntentFired already set, skipping setupExitIntent');
                return;
            }
            
            let fired = false;
            
            // Метод 1: mouseleave на document.documentElement (когда мышь выходит из окна браузера)
            document.documentElement.addEventListener('mouseleave', function onMouseLeave() {
                console.log('[OKK Widget] mouseleave on documentElement detected');
                if (!fired) {
                    fired = true;
                    document.documentElement.removeEventListener('mouseleave', onMouseLeave);
                    triggerExitIntent();
                }
            });
            
            // Метод 2: mouseout с проверкой clientY < 0 (резервный способ)
            document.addEventListener('mouseout', function(e) {
                if (e.clientY < 0 && !fired) {
                    console.log('[OKK Widget] mouseout detected with clientY < 0');
                    fired = true;
                    triggerExitIntent();
                }
            });
            
        }

        // ─────────────────────────────────────────────────────────────────────────

        console.log('[OKK Widget] Restoring chat and initializing...');
        restoreChat();
        await apiCall('init');
        // Обновим время ПОСЛЕ инициализации, чтобы poll не тащил то, что уже есть
        lastMessageTimestamp = new Date().toISOString();
        localStorage.setItem('okk_lc_last_msg_time', lastMessageTimestamp);

        console.log('[OKK Widget] Setting up exit intent...');
        setupExitIntent();
        setInterval(poll, WIDGET_CONFIG.pollingInterval);
        console.log('[OKK Widget] Initialization complete');
    }

    // Lazy Loading Логика (задержка только при первом посещении)
    const wasInitialized = localStorage.getItem('okk_lc_first_load_done');
    const actualDelay = wasInitialized ? 100 : WIDGET_CONFIG.lazyLoadMs;

    function startInit() {
        setTimeout(() => {
            initWidget();
            localStorage.setItem('okk_lc_first_load_done', 'true');
        }, actualDelay);
    }

    if (document.readyState === 'complete') {
        startInit();
    } else {
        window.addEventListener('load', startInit);
    }
})();
</script>
{/literal}
