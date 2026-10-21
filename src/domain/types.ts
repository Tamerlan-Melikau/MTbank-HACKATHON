/**
 * Доменные сущности. Это контракт данных между UI, API и «сервером».
 * Здесь нет React и нет хранилища: только форма данных.
 */
import type { AgeGroup } from './age';
import type { CapabilityId, Level } from './capabilities';
import type { CategoryId } from './categories';
import type { Money } from './money';

export type Id = string;
export type IsoDateTime = string;
export type IsoDate = string;

export type Role = 'parent' | 'child';

export interface Member {
  id: Id;
  familyId: Id;
  role: Role;
  firstName: string;
  lastName: string;
  /** Только у ребёнка обязательна: от неё считается возрастная группа. */
  birthDate?: IsoDate;
}

export interface Family {
  id: Id;
  name: string;
  packageId: PackageId | null;
  createdAt: IsoDateTime;
}

export type PackageId = 'family-start';

/** Статус личного доступа ребёнка в Moby. */
export type MobyAccess =
  | 'none' // не выдан
  | 'invited' // родитель выдал код, ребёнок ещё не вошёл
  | 'pending_confirm' // ребёнок ввёл код, ждём подтверждения родителя в приложении
  | 'active'
  | 'suspended'; // родитель временно закрыл доступ

export interface Limits {
  perTransaction: Money | null;
  daily: Money | null;
  monthly: Money | null;
  /** Операции от этой суммы уходят родителю на подтверждение. null — не требуется. */
  approvalFrom: Money | null;
}

/** Настройки ребёнка, которыми управляет родитель. */
export interface ChildSettings {
  childId: Id;
  /** Группа фиксируется при выпуске и пересчитывается при смене возраста. */
  ageGroup: AgeGroup;
  levels: Record<CapabilityId, Level>;
  limits: Limits;
  /** Категории, запрещённые родителем (поверх всегда запрещённых). */
  blockedCategories: CategoryId[];
  moby: MobyAccess;
  inviteCode: string | null;
  notifyParentOnEveryOperation: boolean;
}

export type ConsentType =
  | 'package-offer' // договор на пакет
  | 'child-card' // выпуск карты на ребёнка
  | 'child-pd' // обработка персональных данных ребёнка
  | 'child-moby-access'; // личный доступ ребёнка в Moby

export interface Consent {
  id: Id;
  parentId: Id;
  childId: Id;
  type: ConsentType;
  givenAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
}

export type AccountKind = 'current' | 'deposit';
export type AccountStatus = 'active' | 'blocked';

/** Какую часть начисленных процентов направлять в копилки. */
export interface InterestRule {
  /** 0–100: доля процентов, которая уходит в выбранные копилки. */
  percent: number;
  /** Копилки, между которыми делится эта доля. */
  goalIds: Id[];
}

export interface InterestRuleRecord extends InterestRule {
  childId: Id;
}

export interface InterestAccrual {
  interest: Money;
  toGoals: Money;
  toFree: Money;
}

export interface Account {
  id: Id;
  ownerId: Id;
  kind: AccountKind;
  title: string;
  balance: Money;
  /** Блокировка счёта останавливает списания, но не мешает поступлениям. */
  status: AccountStatus;
  createdAt: IsoDateTime;
}

/** Копилка — цель внутри накопительного счёта, а не отдельный банковский счёт. */
export interface Goal {
  id: Id;
  ownerId: Id;
  depositId: Id;
  title: string;
  /** Сколько закреплено за целью внутри остатка накопительного счёта. */
  balance: Money;
  target: Money;
  reachedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export type CardStatus = 'active' | 'blocked' | 'lost';
export type CardForm = 'physical' | 'digital';

export interface Card {
  id: Id;
  accountId: Id;
  holderId: Id;
  form: CardForm;
  last4: string;
  status: CardStatus;
  /** Карта заблокирована автоматически вместе со счётом (а не родителем вручную). */
  blockedByAccount: boolean;
  /** Если родитель «перевыпустил» карту после утери — ссылка на новую. */
  replacedBy: Id | null;
}

export type Channel = 'offline' | 'online' | 'atm' | 'p2p' | 'internal';

export type TxStatus = 'completed' | 'declined' | 'pending_approval';

export type TxKind =
  | 'purchase'
  | 'cash'
  | 'transfer_out'
  | 'transfer_in'
  | 'pocket_money'
  | 'topup'
  | 'goal_in'
  | 'goal_out'
  | 'reward'
  | 'cashback'
  | 'interest';

export interface Transaction {
  id: Id;
  accountId: Id;
  memberId: Id;
  kind: TxKind;
  /** Знак: + поступление, − списание. */
  amount: Money;
  title: string;
  category: CategoryId | null;
  channel: Channel;
  status: TxStatus;
  /** Код причины отказа (см. payments.ts). */
  declineReason: string | null;
  createdAt: IsoDateTime;
}

/** Регулярный перевод «карманных денег». */
export interface Allowance {
  id: Id;
  parentId: Id;
  childId: Id;
  amount: Money;
  period: 'monthly';
  nextRunAt: IsoDateTime;
  active: boolean;
}

/** Запрос ребёнка родителю: «доступ запрещён → запросить». */
export type AccessRequestPayload =
  | { type: 'capability'; capabilityId: CapabilityId; level: Level }
  | { type: 'purchase'; transactionId: Id }
  | { type: 'transfer'; recipient: string; recipientId?: Id; amount: Money }
  | { type: 'money'; amount: Money }
  | { type: 'limit'; limit: keyof Limits; amount: Money }
  | { type: 'moby-access' }
  | { type: 'product'; productId: string }
  | { type: 'goal_withdraw'; goalId: Id; amount: Money }
  | { type: 'goal_close'; goalId: Id }
  | { type: 'deposit_close' }
  | { type: 'deposit_withdraw'; amount: Money }
  | { type: 'deposit_transfer'; amount: Money; recipientId: Id; recipient: string };

/** Часть входящего поступления, которую можно отложить на цель. */
export interface IncomingAllocation {
  id: Id;
  familyId: Id;
  childId: Id;
  amount: Money;
  title: string;
  status: 'pending' | 'done' | 'skipped';
  goalId: Id | null;
  allocated: Money;
  createdAt: IsoDateTime;
  resolvedAt: IsoDateTime | null;
  resolvedBy: Id | null;
}

export type AllocationInput =
  | { unit: 'percent'; percent: number }
  | { unit: 'amount'; amount: Money }
  | { unit: 'skip' };

export interface AccessRequest {
  id: Id;
  familyId: Id;
  childId: Id;
  payload: AccessRequestPayload;
  comment: string;
  status: 'pending' | 'approved' | 'declined' | 'expired';
  createdAt: IsoDateTime;
  resolvedAt: IsoDateTime | null;
  resolvedBy: Id | null;
}

/** Геймификация */
export interface Task {
  id: Id;
  familyId: Id;
  childId: Id;
  createdBy: Id;
  title: string;
  reward: { points: number; money: Money | null };
  status: 'assigned' | 'submitted' | 'done' | 'rejected';
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface LessonProgress {
  memberId: Id;
  lessonId: string;
  completedAt: IsoDateTime;
  score: number;
}

/** Баллы копятся отдельно у каждого участника семьи (требование ТЗ). */
export interface PointsEntry {
  id: Id;
  memberId: Id;
  delta: number;
  reason: string;
  createdAt: IsoDateTime;
}

export interface Notification {
  id: Id;
  memberId: Id;
  title: string;
  body: string;
  /** Внутренняя ссылка (маршрут), куда ведёт уведомление. */
  link: string | null;
  read: boolean;
  createdAt: IsoDateTime;
}
