/**
 * Точка выбора реализации API. Сейчас — MockBank в браузере.
 * Подключение реального бэкенда: реализовать BankApi (например, HttpBank)
 * и вернуть его здесь, например по import.meta.env.VITE_API_URL.
 */
import type { BankApi } from './contract';
import { MockBank } from './mock/server';
import { webStorage } from './mock/storage';

export const api: BankApi = new MockBank({
  db: webStorage('local'),
  session: webStorage('session'),
  latencyMs: 120,
  crossTab: true,
});

export * from './contract';
