import { useEffect, useState } from 'react';

export type Route =
  | { name: 'landing' }
  | { name: 'game'; gameId: string }
  | { name: 'offline' }
  | { name: 'stats' }
  | { name: 'rules' };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const g = /^\/g\/([^/?#]+)/.exec(h);
  if (g) return { name: 'game', gameId: decodeURIComponent(g[1]!) };
  if (/^\/offline\b/.test(h)) return { name: 'offline' };
  if (/^\/stats\b/.test(h)) return { name: 'stats' };
  if (/^\/rules\b/.test(h)) return { name: 'rules' };
  return { name: 'landing' };
}

export function navigate(path: string): void {
  location.hash = path;
}

export const gamePath = (gameId: string) => `#/g/${encodeURIComponent(gameId)}`;

export function gameLink(gameId: string): string {
  return `${location.origin}${location.pathname}${gamePath(gameId)}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
