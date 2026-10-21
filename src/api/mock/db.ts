/**
 * «База данных» мок-сервера: плоские таблицы, как в реальном бэкенде.
 * Меняя форму, увеличьте DB_VERSION — старые данные в браузере сбросятся на сид.
 */
import type {
  AccessRequest,
  Account,
  Allowance,
  Card,
  ChildSettings,
  Consent,
  Family,
  Goal,
  IncomingAllocation,
  InterestRuleRecord,
  LessonProgress,
  Member,
  Notification,
  PointsEntry,
  Task,
  Transaction,
} from '@/domain';

export const DB_VERSION = 9;

export interface Db {
  version: number;
  seq: number;
  families: Family[];
  members: Member[];
  childSettings: ChildSettings[];
  consents: Consent[];
  accounts: Account[];
  goals: Goal[];
  interestRules: InterestRuleRecord[];
  cards: Card[];
  transactions: Transaction[];
  allowances: Allowance[];
  allocations: IncomingAllocation[];
  requests: AccessRequest[];
  tasks: Task[];
  lessons: LessonProgress[];
  points: PointsEntry[];
  notifications: Notification[];
}

export function emptyDb(): Db {
  return {
    version: DB_VERSION,
    seq: 1,
    families: [],
    members: [],
    childSettings: [],
    consents: [],
    accounts: [],
    goals: [],
    interestRules: [],
    cards: [],
    transactions: [],
    allowances: [],
    allocations: [],
    requests: [],
    tasks: [],
    lessons: [],
    points: [],
    notifications: [],
  };
}

export function nextId(db: Db, prefix: string): string {
  return `${prefix}_${(db.seq++).toString(36)}`;
}
