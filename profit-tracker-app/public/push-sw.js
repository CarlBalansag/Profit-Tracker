/* Push notifications, loaded into the generated service worker
   (vite.config.js -> workbox.importScripts). The API sends JSON:
   { title, body, url, tag, badge }. Every push must show a notification:
   iPhones turn notifications off for sites that push silently. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Profit Tracker';
  const shown = self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: data.url || '/todos' },
  });
  const badge = typeof data.badge === 'number' && 'setAppBadge' in self.navigator
    ? (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {})
    : Promise.resolve();
  event.waitUntil(Promise.all([shown, badge]));
});

// Tapping a notification opens its page: in an open app window if there is
// one, otherwise a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/todos', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => client.url.startsWith(self.location.origin));
    if (open) {
      await open.focus();
      if ('navigate' in open) return open.navigate(url);
      return undefined;
    }
    return self.clients.openWindow(url);
  })());
});
