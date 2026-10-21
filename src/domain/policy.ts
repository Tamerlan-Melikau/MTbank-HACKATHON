/**
 * Движок прав ребёнка. Единственное место, где решается «можно / нельзя / по подтверждению».
 * Используется и «сервером» (обязательная проверка), и UI (чтобы показать замок
 * и кнопку «Запросить у родителя»). UI никогда не решает сам.
 */
import type { AgeGroup } from './age';
import { CAPABILITIES, LEVEL_ORDER, type CapabilityId, type Ceiling, type Level } from './capabilities';
import type { ChildSettings, Role } from './types';

export type DenyReason = 'parent' | 'age';

export type AccessDecision =
  | { kind: 'allowed' }
  | { kind: 'approval' }
  | { kind: 'denied'; reason: DenyReason; canRequest: boolean; requestLevel: Level | null };

export function ceilingOf(group: AgeGroup, id: CapabilityId): Ceiling {
  return CAPABILITIES[id].rules[group].ceiling;
}

export function capabilityAccess(settings: Pick<ChildSettings, 'ageGroup' | 'levels'>, id: CapabilityId): AccessDecision {
  const ceiling = ceilingOf(settings.ageGroup, id);
  if (ceiling === 'none' || ceiling === 'off') {
    return { kind: 'denied', reason: 'age', canRequest: false, requestLevel: null };
  }
  const level = settings.levels[id];
  if (level === 'on') return { kind: 'allowed' };
  if (level === 'approval') return { kind: 'approval' };
  return { kind: 'denied', reason: 'parent', canRequest: true, requestLevel: ceiling };
}

/** Может ли родитель выставить такой уровень для возрастной группы. */
export function canParentSet(group: AgeGroup, id: CapabilityId, level: Level): boolean {
  const ceiling = ceilingOf(group, id);
  if (ceiling === 'none') return level === 'off';
  return LEVEL_ORDER[level] <= LEVEL_ORDER[ceiling];
}

/** Уровни, которые родитель может выбрать в UI. */
export function allowedLevels(group: AgeGroup, id: CapabilityId): Level[] {
  return (['off', 'approval', 'on'] as Level[]).filter((l) => canParentSet(group, id, l));
}

/** До 14 лет копилками управляет родитель; ребёнок снимает и удаляет их только через запрос. */
export function parentManagesSavings(group: AgeGroup): boolean {
  return group === 'junior';
}

/** Правило процентов задаёт родитель ребёнка до 14 лет, а с 14 лет — сам подросток. */
export function managesInterestRule(role: Role, group: AgeGroup): boolean {
  return role === 'parent' ? parentManagesSavings(group) : !parentManagesSavings(group);
}
