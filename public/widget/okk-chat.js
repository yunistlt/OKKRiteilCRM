(function() {
    const WIDGET_CONFIG = {
        apiEndpoint: 'https://okk.zmksoft.com/api/widget/chat',
        storageKeys: {
            visitorId: 'okk_visitor_id',
            utm: 'okk_utm',
            history: 'okk_pages',
            landing: 'okk_landing',
            cart: 'okk_cart',
            widgetOpen: 'okk_widget_open',
            chatCache: 'okk_chat_cache'
        },
        maxHistory: 20,
        interestTimerMs: 10000,
        pollingInterval: 3000
    };

    // 1. IMMEDIATE UI RESTORE (Before even finding elements)
    const wasOpen = localStorage.getItem(WIDGET_CONFIG.storageKeys.widgetOpen) === 'true';
    const styleId = 'okk-chat-immediate-styles';
    if (wasOpen && !document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = '#okk-chat-widget.minimized { bottom: 0 !important; height: 500px !important; } .okk-chat-toggle { transform: rotate(180deg); }';
        document.head.appendChild(style);
    }

    let lastMessageTimestamp = localStorage.getItem('okk_last_msg_time') || new Date().toISOString();

    const tracking = {
        init: function() {
            this.ensureVisitorId();
            this.trackUTM();
            this.trackLandingPage();
            this.trackPageView();
            this.setupCartTracking();
            this.setupInterestTimer();
        },
        ensureVisitorId: function() {
            let id = localStorage.getItem(WIDGET_CONFIG.storageKeys.visitorId);
            if (!id) {
                id = 'v_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
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
        setupCartTracking: function() {
            document.addEventListener('click', (e) => {
                if (e.target.closest('.add-to-cart, .js-add-to-cart, [data-cart-add]')) {
                    const name = document.querySelector('h1')?.innerText || 'Товар';
                    this.markInterest(name);
                }
            });
        },
        setupInterestTimer: function() {
            const h1 = document.querySelector('h1');
            if (h1 && (window.location.pathname.includes('/product/') || document.querySelector('.product-info'))) {
                setTimeout(() => this.markInterest(h1.innerText), WIDGET_CONFIG.interestTimerMs);
            }
        },
        markInterest: function(name) {
            let cart = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.cart) || '[]');
            if (!cart.includes(name)) {
                cart.push(name);
                localStorage.setItem(WIDGET_CONFIG.storageKeys.cart, JSON.stringify(cart));
            }
        },
        getPayload: function() {
            return {
                domain: window.location.hostname,
                utm: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.utm) || '{}'),
                referrer: document.referrer,
                landingPage: localStorage.getItem(WIDGET_CONFIG.storageKeys.landing),
                visitedPages: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]'),
                cartItems: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.cart) || '[]'),
                userAgent: navigator.userAgent
            };
        }
    };

    tracking.init();

    // UI & Logic
    const widget = document.getElementById('okk-chat-widget');
    const input = document.getElementById('okk-chat-input');
    const messages = document.getElementById('okk-chat-messages');
    const toggle = document.getElementById('okk-chat-toggle');

    function addMsg(text, type, skipSave = false) {
        if (!text) return;
        const d = document.createElement('div');
        d.className = 'okk-msg ' + type;
        d.innerText = text;
        if (messages) {
            messages.appendChild(d);
            messages.scrollTop = messages.scrollHeight;
        }

        if (!skipSave) {
            const cache = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache) || '[]');
            cache.push({ text, type });
            localStorage.setItem(WIDGET_CONFIG.storageKeys.chatCache, JSON.stringify(cache.slice(-50)));
        }
    }

    function restoreChat() {
        if (!messages) return;
        const cache = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache) || '[]');
        if (cache.length > 0) {
            messages.innerHTML = ''; 
            cache.forEach(m => addMsg(m.text, m.type, true));
        }

        if (wasOpen && widget) {
            widget.classList.remove('minimized');
            if (toggle) toggle.innerHTML = '▼';
            const styles = document.getElementById(styleId);
            if (styles) styles.remove(); // Clean up temporary styles
        }
    }

    async function apiCall(type, extra = {}) {
        try {
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
            if (data.reply) addMsg(data.reply, 'ai');
            
            // MAGIC GREETING PROTECTION:
            // Don't show greeting if we have user messages in cache
            const cache = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache) || '[]');
            const hasUserMsg = cache.some(m => m.type === 'user');
            
            if (data.magicGreeting && !hasUserMsg && cache.length < 2) {
                addMsg(data.magicGreeting, 'ai');
            }
            return data;
        } catch (e) { 
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
                        addMsg(m.content, 'ai');
                        lastMessageTimestamp = m.created_at;
                        localStorage.setItem('okk_last_msg_time', lastMessageTimestamp);
                    });
                }
            }
        } catch (e) {}
    }

    if (document.getElementById('okk-chat-send')) {
        document.getElementById('okk-chat-send').onclick = () => {
            const val = input.value.trim();
            if (val) {
                addMsg(val, 'user');
                input.value = '';
                apiCall('chat', { message: val });
            }
        };
    }

    if (input) {
        input.onkeypress = (e) => { if (e.key === 'Enter') document.getElementById('okk-chat-send').click(); };
    }
    
    if (document.getElementById('okk-chat-header')) {
        document.getElementById('okk-chat-header').onclick = () => {
            if (widget) {
                widget.classList.toggle('minimized');
                const isOpen = !widget.classList.contains('minimized');
                localStorage.setItem(WIDGET_CONFIG.storageKeys.widgetOpen, isOpen);
                if (toggle) toggle.innerHTML = isOpen ? '▼' : '▲';
            }
        };
    }

    restoreChat();
    apiCall('init');
    setInterval(poll, WIDGET_CONFIG.pollingInterval);
})();
