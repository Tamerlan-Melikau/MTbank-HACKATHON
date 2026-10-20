/**
 * Линейные иконки 24×24, штрих 1.75 (README дизайн-системы). Цвет — currentColor.
 * Новый значок: добавьте path в ICONS, имя станет доступно в типе IconName.
 */
const ICONS = {
  home: 'M4 11l8-7 8 7v9H4z',
  products: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5zM3 10h18',
  chat: 'M4 5h16v11H9l-5 4z',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  topup: 'M12 4v10M8 10l4 4 4-4M4 14v5h16v-5',
  transfer: 'M4 9h14M14 5l4 4-4 4M20 16H6M10 12l-4 4 4 4',
  pay: 'M4 7h16v12H4zM4 11h16',
  gift: 'M4 9h16v11H4zM12 9v11M4 13h16M12 9c-3 0-4-4-1-4 2 0 1 4 1 4zm0 0c3 0 4-4 1-4-2 0-1 4-1 4z',
  user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21c1-4 4-6 8-6s7 2 8 6',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  limit: 'M4 18a8 8 0 1 1 16 0M12 18l4-6',
  piggy: 'M5 11a7 6 0 0 1 13-2h2v4h-2a7 6 0 0 1-3 3v3h-3v-2h-3v2H6v-3a6 6 0 0 1-1-5zM15 9h.01',
  task: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M19 19v2H6',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  check: 'M5 12l5 5 9-10',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  ask: 'M12 3a9 9 0 1 1-6.4 15.4L3 21l.6-3.6A9 9 0 0 1 12 3zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.2M12 16.5h.01',
  history: 'M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6M12 8v4l3 2',
  family: 'M8 7a3 3 0 1 1 0 .01M17 8a2.5 2.5 0 1 1 0 .01M3 20c.5-3.5 2.5-5.5 5-5.5s4.5 2 5 5.5M14 20c.3-2.5 1.5-4 3-4s2.7 1.5 3 4',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19 12l2-1-1-3-2 .3-1.4-1.4L16.9 5 14 4l-1 2h-2l-1-2-3 1 .3 2-1.4 1.4L5 8.1 4 11l2 1v0l-2 1 1 3 2-.3 1.4 1.4L7.1 19 10 20l1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .3 1-3z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  key: 'M14 10a4 4 0 1 1-1.2-2.8L21 15v3h-3v-2h-2v-2h-2',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
