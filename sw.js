// Predictor Fútbol: avisos (notificaciones push) y arranque rápido
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = { titulo: "PBCT", cuerpo: "Ya están los pronósticos de hoy" };
  try { d = Object.assign(d, e.data.json()); } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.titulo, {
    body: d.cuerpo, icon: "icono-192.png", badge: "icono-192.png", tag: "seguras", renotify: true, data: { url: "./" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((ws) => {
    for (const w of ws) { if ("focus" in w) return w.focus(); }
    return self.clients.openWindow(e.notification.data.url || "./");
  }));
});
