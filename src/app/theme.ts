/** Тема: system | light | dark. На <html> всегда ставим конкретную data-theme. */
import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'fw.theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* noop */
  }
  return 'system';
}

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--surface-100').trim();
  if (meta && brand) meta.setAttribute('content', brand);
}

export function initTheme() {
  apply(readPref());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => apply(readPref()));
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* noop */
    }
    apply(pref);
  }, [pref]);
  return [pref, setPref] as const;
}
