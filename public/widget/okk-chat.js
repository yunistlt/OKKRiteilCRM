(function() {
    const WIDGET_CONFIG = {
        apiEndpoint: '/api/widget/chat',
        storageKeys: {
            visitorId: 'okk_visitor_id',
            utm: 'okk_utm',
            history: 'okk_pages',
            landing: 'okk_landing',
            cart: 'okk_cart'
        },
        maxHistory: 20,
        interestTimerMs: 10000
    };

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

        trackPageView: function() {
            let history = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.history) || '[]');
            const currentPage = {
                url: window.location.pathname + window.location.search,
                title: document.title,
                timestamp: new Date().toISOString()
            };

            if (history.length === 0 || history[history.length - 1].url !== currentPage.url) {
                history.push(currentPage);
                if (history.length > WIDGET_CONFIG.maxHistory) {
                    history.shift();
                }
                localStorage.setItem(WIDGET_CONFIG.storageKeys.history, JSON.stringify(history));
            }
        },

        setupCartTracking: function() {
            document.addEventListener('click', (e) => {
                const cartBtn = e.target.closest('.add-to-cart, [data-cart-add], .js-add-to-cart');
                if (cartBtn) {
                    const productName = document.querySelector('h1')?.innerText || 'Product';
                    this.markInterest(productName);
                }
            });
        },

        setupInterestTimer: function() {
            const h1 = document.querySelector('h1');
            // Detect product page (Webasyst common patterns)
            const isProductPage = window.location.pathname.includes('/product/') || 
                                 document.querySelector('.product-info') || 
                                 document.querySelector('.js-product');

            if (h1 && isProductPage) {
                setTimeout(() => {
                    this.markInterest(h1.innerText);
                }, WIDGET_CONFIG.interestTimerMs);
            }
        },

        markInterest: function(item) {
            let cart = JSON.parse(localStorage.getItem(WIDGET_CONFIG.storageKeys.cart) || '[]');
            if (!cart.includes(item)) {
                cart.push(item);
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

    window.OKKWidget = {
        apiCall: async function(type, extra = {}) {
            try {
                const response = await fetch(WIDGET_CONFIG.apiEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type,
                        visitorId: tracking.ensureVisitorId(),
                        visitorData: tracking.getPayload(),
                        ...extra
                    })
                });
                return await response.json();
            } catch (err) {
                console.error('OKK Widget Error:', err);
                return { error: 'Connection failed' };
            }
        },
        sendMessage: function(message) {
            return this.apiCall('chat', { message });
        },
        init: function() {
            return this.apiCall('init');
        }
    };
})();
