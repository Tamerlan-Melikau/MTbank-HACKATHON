/**
 * Геймификация: уроки, баллы, уровни, правила начисления.
 * Все числа — ДОПУЩЕНИЯ для прототипа, не тарифы банка.
 */
import type { AgeGroup } from './age';

export interface Lesson {
  id: string;
  title: string;
  forGroups: AgeGroup[];
  minutes: number;
  points: number;
  body: string;
  quiz: { question: string; options: string[]; correct: number }[];
}

export const LESSONS: Lesson[] = [
  {
    id: 'need-vs-want',
    title: 'Нужно или хочется',
    forGroups: ['junior', 'teen'],
    minutes: 3,
    points: 30,
    body: 'Нужное — то, без чего не обойтись: еда, проезд, тетради. Хотелки — то, что приятно, но может подождать. Если сначала оплатить нужное, на хотелки останется спокойно.',
    quiz: [
      { question: 'Что из этого нужное?', options: ['Проездной на месяц', 'Новый скин в игре', 'Третья шоколадка'], correct: 0 },
      { question: 'Хочется дорогую игрушку. Что сделать?', options: ['Попросить в долг у друга', 'Завести копилку и откладывать', 'Купить сразу на все деньги'], correct: 1 },
    ],
  },
  {
    id: 'piggy-bank',
    title: 'Как работает копилка',
    forGroups: ['junior', 'teen'],
    minutes: 4,
    points: 40,
    body: 'Копилка — отдельный кармашек на счёте. Деньги в ней не тратятся случайно. Поставь цель и сумму, откладывай понемногу — и увидишь, сколько осталось.',
    quiz: [
      { question: 'Цель 50 BYN, откладываешь 5 BYN в неделю. Сколько недель?', options: ['5', '10', '25'], correct: 1 },
    ],
  },
  {
    id: 'scam',
    title: 'Как не попасться мошенникам',
    forGroups: ['junior', 'teen'],
    minutes: 5,
    points: 50,
    body: 'Банк никогда не спрашивает код из СМС, CVV и пароль. Если пишут «срочно переведи» или «ты выиграл приз» — это обман. Покажи сообщение родителю.',
    quiz: [
      { question: 'Пишут: «Назови код из СМС, чтобы получить приз». Что делать?', options: ['Назвать код', 'Не отвечать и показать родителю', 'Переслать друзьям'], correct: 1 },
      { question: 'Кому можно сообщать CVV-код карты?', options: ['Сотруднику банка', 'Никому', 'Лучшему другу'], correct: 1 },
    ],
  },
  {
    id: 'deposit-teen',
    title: 'Проценты: деньги, которые работают',
    forGroups: ['teen'],
    minutes: 6,
    points: 60,
    body: 'Вклад — это когда ты на время отдаёшь деньги банку, а он платит тебе за это проценты. Чем дольше срок, тем обычно выше ставка, но и снять досрочно сложнее.',
    quiz: [
      { question: 'Что такое процент по вкладу?', options: ['Плата банку', 'Плата тебе за хранение денег в банке', 'Штраф'], correct: 1 },
    ],
  },
];

/** Награды (допущения). */
export const REWARDS = {
  goalReached: 100,
  taskDefault: 20,
  /** Кешбэк баллами у партнёров семейных категорий: % от суммы покупки. */
  familyCashbackPercent: 1,
};

export interface LevelInfo {
  level: number;
  title: string;
  from: number;
  to: number | null;
}

const LEVELS: { from: number; title: string }[] = [
  { from: 0, title: 'Новичок' },
  { from: 100, title: 'Копилкин' },
  { from: 300, title: 'Планировщик' },
  { from: 700, title: 'Финансист' },
  { from: 1500, title: 'Инвестор' },
];

export function levelOf(points: number): LevelInfo {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i]!.from) idx = i;
  const cur = LEVELS[idx]!;
  const next = LEVELS[idx + 1];
  return { level: idx + 1, title: cur.title, from: cur.from, to: next ? next.from : null };
}

export function lessonsFor(group: AgeGroup): Lesson[] {
  return LESSONS.filter((l) => l.forGroups.includes(group));
}
