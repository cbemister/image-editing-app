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

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
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
      })
      .catch(() => {
        // Offline install is a bonus, not a requirement — the app still runs.
      });
  });
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
