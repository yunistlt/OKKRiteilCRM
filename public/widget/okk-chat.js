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
        pollingInterval: 3000,
        autoExpandDelay: 10000,
        typingSpeed: 30
    };

    // 1. STYLES INJECTION
    const styleId = 'okk-chat-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            #okk-chat-widget {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 360px;
                height: 550px;
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

            #okk-chat-widget.minimized {
                transform: translateY(calc(100% - 70px));
            }

            #okk-chat-header {
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

            #okk-chat-widget.minimized #okk-chat-header {
                border-bottom: none;
            }

            #okk-chat-header .agent-info {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            #okk-chat-header .agent-avatar {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                border: 2px solid rgba(255, 255, 255, 0.2);
                object-fit: cover;
            }

            #okk-chat-widget.minimized .agent-avatar {
                width: 64px;
                height: 64px;
                border: none;
            }

            #okk-chat-header .agent-status {
                font-size: 11px;
                opacity: 0.8;
                font-weight: 400;
            }

            #okk-chat-messages {
                flex: 1;
                padding: 20px;
                overflow-y: auto;
                background: #f9fafb;
                display: flex;
                flex-direction: column;
                gap: 12px;
                scrollbar-width: thin;
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

            .okk-msg.ai {
                background: #ffffff;
                color: #1f2937;
                align-self: flex-start;
                border-bottom-left-radius: 4px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.02);
                border: 1px solid #f3f4f6;
            }

            .okk-msg.user {
                background: #10b981;
                color: #ffffff;
                align-self: flex-end;
                border-bottom-right-radius: 4px;
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
            }

            .okk-msg.system {
                background: transparent;
                color: #9ca3af;
                font-size: 11px;
                text-align: center;
                align-self: center;
                width: 100%;
                padding: 4px;
            }

            #okk-chat-input-area {
                padding: 16px;
                background: #fff;
                border-top: 1px solid #f3f4f6;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            #okk-chat-input {
                flex: 1;
                border: 1px solid #e5e7eb;
                border-radius: 20px;
                padding: 10px 16px;
                outline: none;
                font-size: 14px;
                transition: border-color 0.2s;
            }

            #okk-chat-input:focus {
                border-color: #10b981;
            }

            #okk-chat-send, #okk-chat-file-btn {
                background: none;
                border: none;
                padding: 8px;
                color: #10b981;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.2s;
            }

            #okk-chat-send:hover, #okk-chat-file-btn:hover {
                transform: scale(1.1);
            }

            /* Typing Preview */
            #okk-chat-preview {
                position: absolute;
                bottom: 100px;
                right: 20px;
                background: #fff;
                padding: 12px 16px;
                border-radius: 20px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.12);
                font-size: 13px;
                color: #374151;
                max-width: 240px;
                display: none;
                z-index: 2147483646;
                animation: okkSlideIn 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67);
            }

            @keyframes okkSlideIn {
                from { opacity: 0; transform: translateX(20px); }
                to { opacity: 1; transform: translateX(0); }
            }

            #okk-chat-preview.active {
                display: block;
            }

            .okk-typing-dots {
                display: inline-flex;
                gap: 3px;
                margin-left: 4px;
            }

            .okk-dot {
                width: 4px;
                height: 4px;
                background: #10b981;
                border-radius: 50%;
                animation: okkDotPulse 1.4s infinite ease-in-out;
            }

            .okk-dot:nth-child(2) { animation-delay: 0.2s; }
            .okk-dot:nth-child(3) { animation-delay: 0.4s; }

            @keyframes okkDotPulse {
                0%, 80%, 100% { transform: scale(0); }
                40% { transform: scale(1); }
            }

            /* Mobile adjustments */
            @media (max-width: 480px) {
                #okk-chat-widget {
                    width: 100%;
                    height: 100%;
                    bottom: 0;
                    right: 0;
                    border-radius: 0;
                }
                #okk-chat-widget.minimized {
                    width: 60px;
                    height: 60px;
                    bottom: 20px;
                    right: 20px;
                    border-radius: 30px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    let lastMessageTimestamp = localStorage.getItem('okk_last_msg_time') || new Date().toISOString();
    let autoExpandTimer = null;

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
    
    // Inject Preview Element if missing
    let preview = document.getElementById('okk-chat-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'okk-chat-preview';
        document.body.appendChild(preview);
    }

    function typeText(element, text, callback) {
        let i = 0;
        element.innerText = '';
        const interval = setInterval(() => {
            element.innerText += text[i];
            i++;
            if (i >= text.length) {
                clearInterval(interval);
                if (callback) callback();
            }
            if (messages) messages.scrollTop = messages.scrollHeight;
        }, WIDGET_CONFIG.typingSpeed);
    }

    function addMsg(text, type, skipSave = false, animate = false) {
        if (!text) return;
        const d = document.createElement('div');
        d.className = 'okk-msg ' + type;
        
        if (messages) {
            messages.appendChild(d);
            if (animate && type === 'ai') {
                typeText(d, text);
            } else {
                d.innerText = text;
            }
            messages.scrollTop = messages.scrollHeight;
        }

        if (!skipSave) {
            const cache = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache) || '[]');
            cache.push({ text, type });
            localStorage.setItem(WIDGET_CONFIG.storageKeys.chatCache, JSON.stringify(cache.slice(-50)));
        }

        // Show preview if minimized and message is from AI
        if (type === 'ai' && widget && widget.classList.contains('minimized')) {
            showPreview(text);
        }
    }

    function showPreview(text) {
        if (!preview) return;
        preview.innerHTML = `<strong>Елена</strong>: ${text.substring(0, 40)}${text.length > 40 ? '...' : ''} <div class="okk-typing-dots"><div class="okk-dot"></div><div class="okk-dot"></div><div class="okk-dot"></div></div>`;
        preview.classList.add('active');
        setTimeout(() => preview.classList.remove('active'), 5000);
    }

    function restoreChat() {
        if (!messages) return;
        const cache = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache) || '[]');
        if (cache.length > 0) {
            messages.innerHTML = ''; 
            cache.forEach(m => addMsg(m.text, m.type, true));
        }

        const wasOpen = localStorage.getItem(WIDGET_CONFIG.storageKeys.widgetOpen) === 'true';
        if (wasOpen && widget) {
            widget.classList.remove('minimized');
            if (toggle) toggle.innerHTML = '▼';
        } else if (widget) {
            // Setup auto-expand for first-time visitors
            const hasInteracted = localStorage.getItem('okk_has_interacted') === 'true';
            if (!hasInteracted) {
                autoExpandTimer = setTimeout(() => {
                    if (widget.classList.contains('minimized')) {
                        widget.classList.remove('minimized');
                        localStorage.setItem(WIDGET_CONFIG.storageKeys.widgetOpen, 'true');
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
            
            // If it's a chat response, animate it
            if (data.reply) {
                addMsg(data.reply, 'ai', false, true);
            }
            
            // MAGIC GREETING PROTECTION:
            const cache = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.chatCache) || '[]');
            const hasUserMsg = cache.some(m => m.type === 'user');
            
            if (data.magicGreeting && !hasUserMsg && cache.length < 2) {
                // Wait a bit before showing greeting to simulate thinking
                setTimeout(() => {
                    addMsg(data.magicGreeting, 'ai', false, true);
                }, 1000);
            }
            return data;
        } catch (e) { 
            return { error: e.message }; 
        }
    }

    async function uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('visitorId', tracking.ensureVisitorId());
        
        addMsg(`Загрузка файла: ${file.name}...`, 'system');

        try {
            const res = await fetch('https://okk.zmksoft.com/api/widget/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                addMsg(`📎 Файл загружен: ${file.name}`, 'user');
                return data;
            } else {
                addMsg(`❌ Ошибка загрузки: ${data.error}`, 'system');
            }
        } catch (e) {
            addMsg(`❌ Ошибка сети при загрузке`, 'system');
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
                localStorage.setItem('okk_has_interacted', 'true');
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
                uploadFile(file);
                fileInput.value = ''; // Reset
            }
        };
    }
    
    if (document.getElementById('okk-chat-header')) {
        document.getElementById('okk-chat-header').onclick = () => {
            if (widget) {
                localStorage.setItem('okk_has_interacted', 'true');
                if (autoExpandTimer) clearTimeout(autoExpandTimer);
                
                widget.classList.toggle('minimized');
                const isOpen = !widget.classList.contains('minimized');
                localStorage.setItem(WIDGET_CONFIG.storageKeys.widgetOpen, isOpen);
                if (toggle) toggle.innerHTML = isOpen ? '▼' : '▲';
                if (isOpen && preview) preview.classList.remove('active');
            }
        };
    }

    restoreChat();
    apiCall('init');
    setInterval(poll, WIDGET_CONFIG.pollingInterval);
})();
