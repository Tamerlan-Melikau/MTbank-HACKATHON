/**
 * Минимальный hash-роутер. Почему hash: GitHub Pages отдаёт статику и не умеет
 * fallback на index.html для глубоких ссылок; #/child/42 работает без настройки сервера.
 * Своя реализация вместо библиотеки — 60 строк без версионных сюрпризов.
 */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

function readPath(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return raw.startsWith('/') ? raw : '/';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, readPath, () => '/');
}

/** Сколько переходов сделано внутри приложения: от этого зависит, куда ведёт «Назад». */
let depth = 0;

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) window.location.replace(`#${path}`);
  else {
    depth++;
    window.location.hash = path;
  }
}

/** «Назад»: по истории, если пришли изнутри приложения, иначе — на fallback (например, открыли по ссылке). */
export function goBack(fallback = '/') {
  if (depth > 0) {
    depth--;
    window.history.back();
  } else navigate(fallback, { replace: true });
}

export type Params = Record<string, string>;

/** Сопоставление '/child/:id' с '/child/m_1' → { id: 'm_1' }. */
export function matchPath(pattern: string, path: string): Params | null {
  const pp = pattern.split('/').filter(Boolean);
  const ap = path.split('?')[0]!.split('/').filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Params = {};
  for (let i = 0; i < pp.length; i++) {
    const p = pp[i]!;
    const a = decodeURIComponent(ap[i]!);
    if (p.startsWith(':')) params[p.slice(1)] = a;
    else if (p !== a) return null;
  }
  return params;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={`#${to}`}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey) depth++;
      }}
      {...rest}
    />
  );
}
