(function() {
    const WIDGET_CONFIG = {
        apiEndpoint: '/api/widget/chat',
        storageKeys: {
            visitorId: 'okk_visitor_id',
            utm: 'okk_utm',
            history: 'okk_visited_pages',
            landing: 'okk_landing_page',
            cart: 'okk_cart_items'
        },
        maxHistory: 20
    };

    const tracking = {
        init: function() {
            this.ensureVisitorId();
            this.trackUTM();
            this.trackLandingPage();
            this.trackReferrer();
            this.trackPageView();
            this.setupCartTracking();
        },

        ensureVisitorId: function() {
            let visitorId = localStorage.getItem(WIDGET_CONFIG.storageKeys.visitorId);
            if (!visitorId) {
                visitorId = 'v_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
                localStorage.setItem(WIDGET_CONFIG.storageKeys.visitorId, visitorId);
            }
            return visitorId;
        },

        trackUTM: function() {
            const urlParams = new URLSearchParams(window.location.search);
            const utm = {};
            ['source', 'medium', 'campaign', 'content', 'term'].forEach(key => {
                const val = urlParams.get('utm_' + key);
                if (val) utm[key] = val;
            });

            if (Object.keys(utm).length > 0) {
                localStorage.setItem(WIDGET_CONFIG.storageKeys.utm, JSON.stringify(utm));
            }
        },

        trackLandingPage: function() {
            if (!localStorage.getItem(WIDGET_CONFIG.storageKeys.landing)) {
                localStorage.setItem(WIDGET_CONFIG.storageKeys.landing, window.location.href);
            }
        },

        trackReferrer: function() {
            if (document.referrer && !localStorage.getItem('okk_referrer')) {
                localStorage.setItem('okk_referrer', document.referrer);
            }
        },

        trackPageView: function() {
            let history = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]');
            const currentPage = {
                url: window.location.pathname + window.location.search,
                title: document.title,
                timestamp: new Date().toISOString()
            };

            // Avoid duplicate consecutive entries
            if (history.length === 0 || history[history.length - 1].url !== currentPage.url) {
                history.push(currentPage);
                if (history.length > WIDGET_CONFIG.maxHistory) {
                    history.shift();
                }
                localStorage.setItem(WIDGET_CONFIG.storageKeys.history, JSON.stringify(history));
            }
        },

        setupCartTracking: function() {
            // Webasyst specific or generic "In cart" button tracking
            document.addEventListener('click', (e) => {
                const cartBtn = e.target.closest('.add-to-cart, [data-cart-add], .js-add-to-cart');
                if (cartBtn) {
                    const productName = document.querySelector('h1')?.innerText || 'Product';
                    this.addToCart(productName);
                }
            });
        },

        addToCart: function(item) {
            let cart = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.cart) || '[]');
            if (!cart.includes(item)) {
                cart.push(item);
                localStorage.setItem(WIDGET_CONFIG.storageKeys.cart, JSON.stringify(cart));
            }
        },

        getPayload: function(message) {
            return {
                visitorId: this.ensureVisitorId(),
                message: message,
                visitorData: {
                    domain: window.location.hostname,
                    utm: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.utm) || '{}'),
                    referrer: localStorage.getItem('okk_referrer') || document.referrer,
                    landingPage: localStorage.getItem(WIDGET_CONFIG.storageKeys.landing),
                    visitedPages: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]'),
                    cartItems: JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.cart) || '[]'),
                    userAgent: navigator.userAgent
                }
            };
        }
    };

    // Initialize tracking
    tracking.init();

    // Expose global object for the UI to use
    window.OKKWidget = {
        sendMessage: async function(message) {
            const payload = tracking.getPayload(message);
            try {
                const response = await fetch(WIDGET_CONFIG.apiEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                return await response.json();
            } catch (err) {
                console.error('OKK Widget Error:', err);
                return { error: 'Failed to send message' };
            }
        },
        getHistory: () => JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]')
    };

    console.log('OKK Chat Widget Initialized');
})();
