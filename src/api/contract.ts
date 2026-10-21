/**
 * Контракт между приложением и банком. UI знает только этот интерфейс.
 * Сейчас его реализует MockBank (в браузере, localStorage). Для боевого бэкенда
 * достаточно написать HttpBank с теми же методами и подменить в api/index.ts.
 *
 * Правило: любое правило доступа проверяется на стороне реализации (сервера),
 * а не только скрытием кнопок в UI.
 */
import type {
  AccessDecision,
  AccessRequest,
  AccessRequestPayload,
  Account,
  AgeGroup,
  AllocationInput,
  Allowance,
  CapabilityId,
  Card,
  CardForm,
  CategoryId,
  ChildSettings,
  ConsentType,
  Family,
  Goal,
  Id,
  IncomingAllocation,
  InterestAccrual,
  InterestRule,
  Level,
  Limits,
  Member,
  Money,
  Notification,
  PaymentDecision,
  PaymentOp,
  PointsEntry,
  Role,
  Task,
  LessonProgress,
  Transaction,
} from '@/domain';

export interface Session {
  memberId: Id;
  familyId: Id;
  role: Role;
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'NO_MOBY_ACCESS'
  | 'POLICY_DENIED'
  | 'CONFLICT';

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Persona {
  memberId: Id;
  title: string;
  subtitle: string;
  role: Role;
}

export interface ChildSummary {
  member: Member;
  age: number;
  ageGroup: AgeGroup;
  balance: Money;
  card: Card | null;
  moby: ChildSettings['moby'];
  pendingRequests: number;
}

export interface FamilyView {
  family: Family;
  parents: Member[];
  children: ChildSummary[];
}

/** Всё, что нужно экрану «ребёнок» у родителя и главному экрану ребёнка. */
export interface ChildOverview {
  member: Member;
  age: number;
  settings: ChildSettings;
  /** Права, уже посчитанные движком политик. */
  access: Record<CapabilityId, AccessDecision>;
  account: Account;
  card: Card | null;
  goals: Goal[];
  deposit: Account | null;
  spentToday: Money;
  spentMonth: Money;
  allowance: Allowance | null;
  pendingAllocation: IncomingAllocation | null;
  points: number;
  pendingRequests: AccessRequest[];
}

export interface PayInput extends PaymentOp {
  merchant: string;
}

/** Перевод другому человеку по имени или номеру телефона. */
export interface TransferInput {
  amount: Money;
  recipient: string;
  /** Для ребёнка до 14 лет обязателен: родитель или брат/сестра. */
  recipientId?: Id;
  comment?: string;
}

export interface DepositMoveInput {
  amount: Money;
  /** null — на свой основной счёт, иначе — id члена семьи. */
  recipientId: Id | null;
  recipient: string;
}

export interface TransferRecipient {
  memberId: Id;
  title: string;
  subtitle: string;
  role: Role;
}

export interface TransferResult {
  /** Для ребёнка до 14 лет — созданный запрос родителю. */
  requestId: Id | null;
  /** Для подростка или после одобрения — сразу проведённая операция. */
  transaction: Transaction | null;
}

export interface PayResult {
  decision: PaymentDecision;
  transaction: Transaction;
  /** Создан ли автоматически запрос родителю (при needs_approval). */
  requestId: Id | null;
}

export interface EnrollInput {
  child: { firstName: string; lastName: string; birthDate: string };
  cardForm: CardForm;
  consents: ConsentType[];
}

export interface BankApi {
  // --- Сессия (в демо — выбор персонажа) ---
  personas(): Promise<Persona[]>;
  signIn(memberId: Id): Promise<Session>;
  signOut(): Promise<void>;
  session(): Session | null;
  /** Ребёнок вводит код приглашения от родителя. Не требует сессии. */
  redeemInvite(code: string): Promise<{ childId: Id; firstName: string }>;
  // --- Чтение ---
  me(): Promise<Member>;
  familyView(): Promise<FamilyView>;
  childOverview(childId: Id): Promise<ChildOverview>;
  accounts(memberId: Id): Promise<Account[]>;
  cards(memberId: Id): Promise<Card[]>;
  transactions(memberId: Id, opts?: { limit?: number }): Promise<Transaction[]>;
  requests(opts?: { status?: AccessRequest['status'] }): Promise<AccessRequest[]>;
  tasks(childId?: Id): Promise<Task[]>;
  points(memberId: Id): Promise<{ balance: number; entries: PointsEntry[] }>;
  lessonProgress(memberId: Id): Promise<LessonProgress[]>;
  notifications(): Promise<Notification[]>;

  // --- Родитель ---
  enroll(input: EnrollInput): Promise<{ childId: Id; inviteCode: string }>;
  /** Удаляет профиль ребёнка и все связанные данные без возможности восстановления. */
  deleteChild(childId: Id): Promise<void>;
  setCapability(childId: Id, id: CapabilityId, level: Level): Promise<void>;
  setLimits(childId: Id, limits: Limits): Promise<void>;
  setBlockedCategories(childId: Id, categories: CategoryId[]): Promise<void>;
  setNotifyEveryOperation(childId: Id, value: boolean): Promise<void>;
  setCardBlocked(cardId: Id, blocked: boolean): Promise<void>;
  setAccountBlocked(accountId: Id, blocked: boolean): Promise<void>;
  reportCardLost(cardId: Id): Promise<{ newCardId: Id }>;
  inviteToMoby(childId: Id): Promise<{ code: string }>;
  /** Подтверждение доступа ребёнка в Moby после ввода одноразового кода. */
  confirmMoby(childId: Id): Promise<void>;
  setMobySuspended(childId: Id, suspended: boolean): Promise<void>;
  topUpChild(childId: Id, amount: Money, targetAccountId?: Id): Promise<{ allocation: IncomingAllocation | null }>;
  openDeposit(childId: Id): Promise<void>;
  closeDeposit(childId: Id): Promise<void>;
  /** Правило распределения процентов. Ребёнку до 14 лет недоступно. */
  interestRule(childId: Id): Promise<InterestRule | null>;
  setInterestRule(childId: Id, rule: InterestRule): Promise<void>;
  /** Демо-начисление процентов на весь остаток счёта. */
  accrueInterest(childId: Id): Promise<InterestAccrual>;
  /** Ставка, которую текущий родитель дополнительно платит ребёнку. */
  parentInterestRate(childId: Id): Promise<number>;
  setParentInterestRate(childId: Id, percent: number): Promise<void>;
  /** Демо-начисление процентов от родителя с его основного счёта. */
  accrueParentInterest(childId: Id): Promise<Money>;
  moveDeposit(input: DepositMoveInput): Promise<{ requestId: Id | null }>;
  setAllowance(childId: Id, value: { amount: Money } | null): Promise<void>;
  resolveRequest(requestId: Id, approve: boolean): Promise<void>;
  allocations(): Promise<IncomingAllocation[]>;
  allocateIncoming(allocationId: Id, input: AllocationInput, goalId?: Id): Promise<void>;
  createTask(childId: Id, title: string, reward: { points: number; money: Money | null }): Promise<void>;
  reviewTask(taskId: Id, accept: boolean): Promise<void>;

  // --- Ребёнок ---
  pay(input: PayInput): Promise<PayResult>;
  /** Дети: кому можно перевести — родители и братья/сёстры. */
  transferRecipients(): Promise<TransferRecipient[]>;
  transferMoney(input: TransferInput): Promise<TransferResult>;
  createRequest(payload: AccessRequestPayload, comment?: string): Promise<{ requestId: Id }>;
  submitTask(taskId: Id): Promise<void>;
  /** Для ребёнка — своя копилка; родитель передаёт childId (только до 14 лет). */
  createGoal(title: string, target: Money, childId?: Id): Promise<{ goalId: Id }>;
  deleteGoal(goalId: Id, childId?: Id): Promise<{ requestId: Id | null }>;
  moveToGoal(goalId: Id, amount: Money, direction: 'in' | 'out', childId?: Id): Promise<{ requestId: Id | null }>;

  // --- Общее ---
  completeLesson(lessonId: string, answers: number[]): Promise<{ score: number; points: number }>;
  markNotificationsRead(): Promise<void>;

  // --- Инфраструктура ---
  /** Подписка на изменения данных: UI перечитывает запросы. */
  subscribe(listener: () => void): () => void;
  resetDemo(): Promise<void>;
}
