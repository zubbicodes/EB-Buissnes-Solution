const isLocalhost = Boolean(
  window.location.hostname === "localhost" ||
    window.location.hostname === "[::1]" ||
    window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/),
);

export function register() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

    if (isLocalhost) {
      checkValidServiceWorker(swUrl);
      return;
    }

    registerValidServiceWorker(swUrl);
  });
}

function registerValidServiceWorker(swUrl) {
  navigator.serviceWorker.register(swUrl).catch(() => {
    // Registration failures should not block the app.
  });
}

function checkValidServiceWorker(swUrl) {
  fetch(swUrl, {
    headers: { "Service-Worker": "script" },
  })
    .then((response) => {
      const contentType = response.headers.get("content-type");
      if (response.status === 404 || (contentType && !contentType.includes("javascript"))) {
        navigator.serviceWorker.ready
          .then((registration) => registration.unregister())
          .then(() => window.location.reload());
      } else {
        registerValidServiceWorker(swUrl);
      }
    })
    .catch(() => {
      // Offline on localhost: let the existing service worker handle it if present.
    });
}
