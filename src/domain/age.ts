/**
 * Возрастные группы продукта. От группы зависят состав пакета и права ребёнка (см. capabilities.ts).
 *
 * Юридическая основа (ТРЕБУЕТ ЮРИДИЧЕСКОЙ ПРОВЕРКИ):
 *  - ГК РБ, ст. 27 — малолетние 6–14 лет самостоятельно совершают мелкие бытовые сделки
 *    и сделки по распоряжению средствами, предоставленными законным представителем.
 *  - ГК РБ, ст. 25 — несовершеннолетние 14–18 лет совершают сделки с письменного согласия
 *    законных представителей, самостоятельно распоряжаются заработком, стипендией,
 *    вправе вносить вклады и распоряжаться ими.
 * Номера статей и формулировки сверить с актуальной редакцией.
 */
export type AgeGroup = 'junior' | 'teen';

export const AGE_GROUPS: Record<AgeGroup, { label: string; min: number; max: number }> = {
  junior: { label: '7–13 лет', min: 7, max: 13 },
  teen: { label: '14–17 лет', min: 14, max: 17 },
};

export function ageAt(birthDate: string, now: Date): number {
  const b = new Date(birthDate + 'T00:00:00');
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/** null — возраст вне продукта (младше 7 или уже 18+). */
export function ageGroupOf(birthDate: string, now: Date): AgeGroup | null {
  const age = ageAt(birthDate, now);
  if (age >= AGE_GROUPS.junior.min && age <= AGE_GROUPS.junior.max) return 'junior';
  if (age >= AGE_GROUPS.teen.min && age <= AGE_GROUPS.teen.max) return 'teen';
  return null;
}
