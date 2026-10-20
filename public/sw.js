/* SnapTheJob service worker: shows follow notifications */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'SnapTheJob', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SnapTheJob', {
    body: d.body || 'New before and after job',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url === url && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
