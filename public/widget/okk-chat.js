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
            chatCache: 'okk_chat_cache',
            hasInteracted: 'okk_has_interacted'
        },
        maxHistory: 20,
        interestTimerMs: 10000,
        pollingInterval: 3000,
        autoExpandDelay: 30000, 
        typingSpeed: 25
    };

    let lastMessageTimestamp = localStorage.getItem('okk_last_msg_time') || new Date().toISOString();
    let autoExpandTimer = null;

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
        setupInterestTimer: function() {
            const h1 = document.querySelector('h1');
            if (h1) {
                setTimeout(() => {
                    let cart = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.cart) || '[]');
                    if (!cart.includes(h1.innerText)) {
                        cart.push(h1.innerText);
                        localStorage.setItem(WIDGET_CONFIG.storageKeys.cart, JSON.stringify(cart));
                    }
                }, WIDGET_CONFIG.interestTimerMs);
            }
        },
        getPayload: function() {
            return {
                domain: window.location.hostname,
                utm: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.utm) || '{}'),
                visitedPages: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]'),
                cartItems: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.cart) || '[]'),
                landingPage: localStorage.getItem(WIDGET_CONFIG.storageKeys.landing)
            };
        }
    };

    tracking.init();

    const widget = document.getElementById('okk-chat-widget');
    const input = document.getElementById('okk-chat-input');
    const messages = document.getElementById('okk-chat-messages');
    const toggle = document.getElementById('okk-chat-toggle');
    const preview = document.getElementById('okk-chat-preview');
    const typingIndicator = document.getElementById('okk-typing-indicator');

    function showTyping(show) {
        if (!typingIndicator) return;
        typingIndicator.style.display = show ? 'block' : 'none';
        if (show) messages.scrollTop = messages.scrollHeight;
    }

    function addMsg(text, type, skipSave = false, animate = false) {
        if (!text) return;
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

        if (!skipSave) {
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
                    }
                }, WIDGET_CONFIG.autoExpandDelay);
            }
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
            if (data.reply) addMsg(data.reply, 'ai', false, true);
            
            const cacheStr = localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache);
            const hasHistory = cacheStr && JSON.parse(cacheStr).length > 0;
            
            if (data.magicGreeting && !hasHistory) {
                setTimeout(() => addMsg(data.magicGreeting, 'ai', false, true), 1000);
            }
            return data;
        } catch (e) { return { error: e.message }; }
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
                localStorage.setItem(WIDGET_CONFIG.storageKeys.hasInteracted, 'true');
                if (autoExpandTimer) clearTimeout(autoExpandTimer);
                addMsg(val, 'user');
                input.value = '';
                apiCall('chat', { message: val });
            }
        };
    }

    if (input) {
        input.onkeypress = (e) => { if (e.key === 'Enter') document.getElementById('okk-chat-send').click(); };
    }

    const fileInput = document.getElementById('okk-chat-file-input');
    const fileBtn = document.getElementById('okk-chat-file-btn');
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
    
    if (document.getElementById('okk-chat-header')) {
        document.getElementById('okk-chat-header').onclick = () => {
            if (widget) {
                localStorage.setItem(WIDGET_CONFIG.storageKeys.hasInteracted, 'true');
                if (autoExpandTimer) clearTimeout(autoExpandTimer);
                widget.classList.toggle('minimized');
                const isOpen = !widget.classList.contains('minimized');
                localStorage.setItem(WIDGET_CONFIG.storageKeys.widgetOpen, isOpen);
                if (toggle) toggle.innerHTML = isOpen ? '▼' : '▲';
                if (isOpen && preview) preview.style.display = 'none';
            }
        };
    }

    restoreChat();
    apiCall('init');
    setInterval(poll, WIDGET_CONFIG.pollingInterval);
})();
