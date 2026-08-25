/**
 * Registers the service worker that makes the app work with no server running.
 *
 * Only in production builds: a service worker during `npm run dev` would serve
 * stale modules and make edits appear not to take effect.
 */

export type UpdateHandler = () => void;

export function registerServiceWorker(onUpdateReady?: UpdateHandler): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;

  // React mounts after "load" has already fired, so waiting for that event
  // would attach a listener that never runs. Register straight away unless the
  // page genuinely is still loading.
  const start = () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        // A worker that finished installing before this listener attached is
        // already waiting — surface it rather than missing the notification.
        if (registration.waiting && navigator.serviceWorker.controller) {
          onUpdateReady?.();
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // A new worker parked in "installed" while one already controls the
            // page means an update is downloaded and waiting.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdateReady?.();
            }
          });
        });

        // Browsers do not reliably re-fetch sw.js on every load, so ask
        // explicitly. Without this an installed app can run stale for days.
        registration.update().catch(() => {});
      })
      .catch(() => {
        // Offline install is a bonus, not a requirement — the app still runs.
      });
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/** Activate a waiting worker and reload onto the new version. */
export async function applyUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration?.waiting) {
    registration.waiting.postMessage('SKIP_WAITING');
    // controllerchange fires once the new worker takes over.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    }, { once: true });
  } else {
    window.location.reload();
  }
}
