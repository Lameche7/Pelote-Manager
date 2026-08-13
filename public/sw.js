const DEFAULT_NOTIFICATION_URL = "/mon-espace/notifications";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "Pelote Manager",
      body: event.data?.text() ?? "Une nouvelle notification est disponible.",
    };
  }

  const title = payload.title || "Pelote Manager";
  const options = {
    body: payload.body || "Une nouvelle notification est disponible.",
    icon: payload.icon || "/pwa-icon.svg",
    badge: payload.badge || "/pwa-icon.svg",
    tag: payload.tag || undefined,
    renotify: payload.priority === "urgent",
    data: {
      url: payload.url || DEFAULT_NOTIFICATION_URL,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || DEFAULT_NOTIFICATION_URL,
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const sameOriginClient = clients.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      if (sameOriginClient) {
        return sameOriginClient.navigate(targetUrl).then(() => sameOriginClient.focus());
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
