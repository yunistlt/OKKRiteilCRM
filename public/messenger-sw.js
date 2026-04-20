const CACHE_NAME = 'okk-messenger-pwa-v1';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/favicon-v2.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/images/') ||
    STATIC_ASSETS.includes(url.pathname);

  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'OKKRiteilCRM', body: event.data.text() };
  }

  const title = payload.title || 'Новое сообщение';
  const body = payload.body || 'В корпоративном мессенджере появилось новое сообщение';
  const chatId = payload.chat_id;
  const messageId = payload.message_id;
  const fallbackUrl = chatId
    ? `/messenger?chat_id=${encodeURIComponent(chatId)}${messageId ? `&message_id=${encodeURIComponent(messageId)}` : ''}`
    : '/messenger';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon-v2.png',
      badge: '/favicon-v2.png',
      data: {
        url: fallbackUrl,
        click_action: payload.click_action || fallbackUrl,
      },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  const targetUrl = event.notification?.data?.click_action || event.notification?.data?.url || '/messenger';
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const matchingClient = clients.find((client) => 'focus' in client);

      if (matchingClient) {
        matchingClient.navigate(targetUrl);
        return matchingClient.focus();
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});