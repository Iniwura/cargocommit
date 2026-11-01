import { useEffect, useState } from 'react';

// Minimal path router. Shareable state lives in the path (/order/0x...), never in a hash.
const NAV_EVENT = 'seldra:navigate';

export function navigate(to: string): void {
  if (to === window.location.pathname) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0 });
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    window.addEventListener(NAV_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAV_EVENT, sync);
    };
  }, []);
  return path;
}
