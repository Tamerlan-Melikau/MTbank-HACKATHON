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
  Allowance,
  CapabilityId,
  Card,
  CardForm,
  CategoryId,
  ChildSettings,
  ConsentType,
  Family,
  Id,
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
  goals: Account[];
  deposit: Account | null;
  spentToday: Money;
  spentMonth: Money;
  allowance: Allowance | null;
  points: number;
  pendingRequests: AccessRequest[];
}

export interface PayInput extends PaymentOp {
  merchant: string;
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
  /** Ребёнок без доступа просит родителя. Не требует сессии (в бою — по номеру телефона). */
  requestMobyAccess(childId: Id): Promise<void>;

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
  enroll(input: EnrollInput): Promise<{ childId: Id }>;
  setCapability(childId: Id, id: CapabilityId, level: Level): Promise<void>;
  setLimits(childId: Id, limits: Limits): Promise<void>;
  setBlockedCategories(childId: Id, categories: CategoryId[]): Promise<void>;
  setNotifyEveryOperation(childId: Id, value: boolean): Promise<void>;
  setCardBlocked(cardId: Id, blocked: boolean): Promise<void>;
  reportCardLost(cardId: Id): Promise<{ newCardId: Id }>;
  inviteToMoby(childId: Id): Promise<{ code: string }>;
  confirmMoby(childId: Id): Promise<void>;
  setMobySuspended(childId: Id, suspended: boolean): Promise<void>;
  topUpChild(childId: Id, amount: Money): Promise<void>;
  setAllowance(childId: Id, value: { amount: Money; period: Allowance['period'] } | null): Promise<void>;
  resolveRequest(requestId: Id, approve: boolean): Promise<void>;
  createTask(childId: Id, title: string, reward: { points: number; money: Money | null }): Promise<void>;
  reviewTask(taskId: Id, accept: boolean): Promise<void>;

  // --- Ребёнок ---
  pay(input: PayInput): Promise<PayResult>;
  createRequest(payload: AccessRequestPayload, comment?: string): Promise<{ requestId: Id }>;
  submitTask(taskId: Id): Promise<void>;
  createGoal(title: string, target: Money): Promise<{ accountId: Id }>;
  moveToGoal(goalId: Id, amount: Money, direction: 'in' | 'out'): Promise<void>;

  // --- Общее ---
  completeLesson(lessonId: string, answers: number[]): Promise<{ score: number; points: number }>;
  markNotificationsRead(): Promise<void>;

  // --- Инфраструктура ---
  /** Подписка на изменения данных: UI перечитывает запросы. */
  subscribe(listener: () => void): () => void;
  resetDemo(): Promise<void>;
}
