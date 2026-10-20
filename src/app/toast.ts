/** Простая шина тостов: вызывается откуда угодно, рисуется компонентом Toaster. */
export type ToastKind = 'info' | 'error';
export interface ToastMsg {
  id: number;
  text: string;
  kind: ToastKind;
}

type Listener = (list: ToastMsg[]) => void;
let list: ToastMsg[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(list);
}

export function toast(text: string, kind: ToastKind = 'info') {
  const id = ++seq;
  list = [...list, { id, text, kind }];
  emit();
  setTimeout(() => {
    list = list.filter((t) => t.id !== id);
    emit();
  }, 3200);
}

export function onToasts(l: Listener) {
  listeners.add(l);
  l(list);
  return () => void listeners.delete(l);
}
