import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { goBack } from '@/app/router';
import { toast } from '@/app/toast';
import { formatMoney, parseMoney, presetLimits, type Limits as LimitsT, type Money } from '@/domain';
import { Button, Field, Screen, Section } from '@/ui/kit';
import { Load } from '../shared';

type Form = Record<keyof LimitsT, string>;
const toText = (m: Money | null) => (m ? formatMoney(m).replace(/\s?BYN$/, '').replace(/ /g, '') : '');

const FIELDS: { key: keyof LimitsT; label: string; hint: string }[] = [
  { key: 'daily', label: 'В день до', hint: 'Пусто — без лимита' },
  { key: 'monthly', label: 'В месяц до', hint: 'Пусто — без лимита' },
  { key: 'approvalFrom', label: 'Подтверждать покупки от', hint: 'Такие покупки ждут вашего подтверждения' },
];

export function Limits({ id }: { id: string }) {
  const q = useQuery(() => api.childOverview(id), [id]);
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    if (q.data && !form) {
      const l = q.data.settings.limits;
      setForm({ daily: toText(l.daily), monthly: toText(l.monthly), approvalFrom: toText(l.approvalFrom) });
    }
  }, [q.data, form]);

  const [save, saving] = useAction(async (f: Form) => {
    const limits: LimitsT = { daily: null, monthly: null, approvalFrom: null };
    for (const { key, label } of FIELDS) {
      const raw = f[key].trim();
      if (!raw) {
        limits[key] = null;
        continue;
      }
      const m = parseMoney(raw);
      if (!m) throw new Error(`Проверьте поле «${label}»`);
      limits[key] = m;
    }
    await api.setLimits(id, limits);
    toast('Лимиты сохранены');
    goBack(`/child/${id}`);
  });

  return (
    <Load q={q}>
      {(o) => (
        <Screen title="Лимиты" back={`/child/${id}`}>
          {form && (
            <Section>
              {FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label}, BYN`} hint={f.hint} inputMode="decimal" value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} />
              ))}
              <Button block onClick={() => save(form)} disabled={saving}>
                Сохранить
              </Button>
              <Button
                variant="ghost"
                block
                onClick={() => {
                  const p = presetLimits(o.settings.ageGroup);
                  setForm({ daily: toText(p.daily), monthly: toText(p.monthly), approvalFrom: toText(p.approvalFrom) });
                }}
              >
                Рекомендованные для возраста
              </Button>
            </Section>
          )}
        </Screen>
      )}
    </Load>
  );
}
