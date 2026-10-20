/**
 * Обёртка над Web Storage: в приватном режиме, превью и при отключённых cookie
 * localStorage может бросать исключение — тогда живём в памяти.
 */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryStorage(): KeyValue {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
  };
}

export function webStorage(kind: 'local' | 'session'): KeyValue {
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    const probe = '__fw_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return {
      get: (k) => {
        try {
          return s.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          s.setItem(k, v);
        } catch {
          /* квота или запрет — игнорируем, данные остаются в памяти сервера */
        }
      },
      remove: (k) => {
        try {
          s.removeItem(k);
        } catch {
          /* noop */
        }
      },
    };
  } catch {
    return memoryStorage();
  }
}
