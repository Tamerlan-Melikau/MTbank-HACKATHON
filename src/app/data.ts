/**
 * Хуки доступа к данным. Экраны получают данные только через них —
 * поэтому интерфейс можно переписать, не трогая загрузку и бизнес-логику.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError } from '@/api';
import { toast } from './toast';

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Загружает данные и перечитывает их при любом изменении в «банке»
 * (своя команда, другая вкладка, расписание). Пока идёт перезагрузка,
 * показываем старые данные — без мигания.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  const load = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    run()
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (id !== seq.current) return;
        setError(e instanceof ApiError ? e : new ApiError('VALIDATION', String(e)));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, [run]);

  useEffect(() => {
    load();
    return api.subscribe(load);
  }, [load]);

  return { data, error, loading, reload: load };
}

/**
 * Команда с состоянием «выполняется» и показом ошибки. Возвращает результат
 * или undefined, если команда упала (ошибку уже показали тостом).
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const ref = useRef(fn);
  ref.current = fn;
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true);
    try {
      return await ref.current(...args);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Что-то пошло не так', 'error');
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return [run, pending] as const;
}

/** Текущая сессия (реактивно). */
export function useSession() {
  return useSyncExternalStore(
    (cb) => api.subscribe(cb),
    () => sessionKey(),
    () => null,
  );
}

let lastKey: string | null = null;
let lastSession: ReturnType<typeof api.session> = null;
function sessionKey() {
  const s = api.session();
  const key = s ? `${s.memberId}` : null;
  if (key !== lastKey) {
    lastKey = key;
    lastSession = s;
  }
  return lastSession;
}
