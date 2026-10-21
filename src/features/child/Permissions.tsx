/** Права ребёнка и запрет категорий. Возможные уровни берутся из движка политик. */
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import {
  AGE_GROUPS,
  allowedLevels,
  CAPABILITY_LIST,
  CATEGORY_LIST,
  PARENT_CONTROLLABLE_CATEGORIES,
  type CapabilityDef,
  type CategoryId,
  type ChildSettings,
  type Level,
} from '@/domain';
import { Card, Chip, Locked, Screen, Section, Segmented } from '@/ui/kit';
import { Load } from '../shared';

const LEVEL_LABEL: Record<Level, string> = { off: 'Нет', approval: 'С вашим ОК', on: 'Да' };
const GROUP_TITLE: Record<CapabilityDef['group'], string> = {
  access: 'Доступ',
  payments: 'Платежи',
  savings: 'Накопления',
  extras: 'Дополнительно',
};

export function Permissions({ id }: { id: string }) {
  const q = useQuery(() => api.childOverview(id), [id]);
  const [setLevel] = useAction((cap: CapabilityDef['id'], level: Level) => api.setCapability(id, cap, level));
  const [setCats] = useAction((cats: CategoryId[]) => api.setBlockedCategories(id, cats));

  return (
    <Load q={q} skeleton={5}>
      {(o) => {
        const canEdit = o.settings.ageGroup === 'junior';
        const groups = (['payments', 'savings', 'extras'] as const)
          .map((g) => ({ g, items: CAPABILITY_LIST.filter((c) => c.group === g && isAvailable(o.settings.ageGroup, c)) }))
          .filter(({ items }) => items.length > 0);
        return (
          <Screen title="Права" back={`/child/${id}`}>
            <p className="t-body muted" style={{ margin: 0 }}>
              {o.member.firstName}, {AGE_GROUPS[o.settings.ageGroup].label}.{' '}
              {canEdit
                ? 'Часть возможностей зависит от возраста — их нельзя включить раньше времени.'
                : 'С 14 лет подросток сам решает, как пользоваться картой, счётом и накоплениями.'}
            </p>
            {!canEdit && (
              <Locked
                title="Права настраивает подросток"
                text="Родитель видит текущие настройки, но не может их менять. Лимиты, блокировки и запрещённые категории остаются у вас."
              />
            )}
            {groups.map(({ g, items }) => (
              <Section key={g} title={GROUP_TITLE[g]}>
                {items.map((c) => (
                  <CapabilityControl key={c.id} def={c} settings={o.settings} readOnly={!canEdit} onChange={(l) => setLevel(c.id, l)} />
                ))}
              </Section>
            ))}
            <Section title="Запрещённые категории">
              <p className="t-caption muted" style={{ margin: 0 }}>
                Отметьте, где покупки запрещены.
              </p>
              <div className="ui-chips">
                {PARENT_CONTROLLABLE_CATEGORIES.map((c) => {
                  const on = o.settings.blockedCategories.includes(c.id);
                  return (
                    <Chip key={c.id} selected={on} onClick={() => setCats(on ? o.settings.blockedCategories.filter((x) => x !== c.id) : [...o.settings.blockedCategories, c.id])}>
                      {c.title}
                    </Chip>
                  );
                })}
              </div>
              <Locked
                title="Запрещено всегда"
                text={`${CATEGORY_LIST.filter((c) => c.hardBlocked)
                  .map((c) => c.title)
                  .join(', ')}. Эти покупки не пройдут ни при каких настройках.`}
              />
            </Section>
          </Screen>
        );
      }}
    </Load>
  );
}

function isAvailable(group: ChildSettings['ageGroup'], def: CapabilityDef) {
  const ceiling = def.rules[group].ceiling;
  return ceiling !== 'none' && ceiling !== 'off';
}

function CapabilityControl({ def, settings, readOnly, onChange }: { def: CapabilityDef; settings: ChildSettings; readOnly: boolean; onChange: (l: Level) => void }) {
  const allowed = allowedLevels(settings.ageGroup, def.id);
  return (
    <Card>
      <div className="ui-stack">
        <div>
          <div className="t-body" style={{ fontWeight: 600 }}>{def.title}</div>
          <div className="t-caption muted">{def.parentHint}</div>
        </div>
        {readOnly ? (
          <div className="t-body">Сейчас: {LEVEL_LABEL[settings.levels[def.id]]}</div>
        ) : (
          <Segmented
            label={def.title}
            value={settings.levels[def.id]}
            onChange={onChange}
            options={(['off', 'approval', 'on'] as Level[]).map((l) => ({ value: l, label: LEVEL_LABEL[l], disabled: !allowed.includes(l) }))}
          />
        )}
      </div>
    </Card>
  );
}
