/** Задания: родитель создаёт и принимает, ребёнок выполняет. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery, useSession } from '@/app/data';
import { usePath } from '@/app/router';
import { toast } from '@/app/toast';
import { formatMoney, parseMoney, REWARDS, type Task } from '@/domain';
import { Button, ButtonRow, Card, Chip, Empty, Field, Screen, Section } from '@/ui/kit';
import { Load } from '../shared';

const STATUS: Record<Task['status'], string> = {
  assigned: 'Нужно сделать',
  submitted: 'На проверке',
  done: 'Выполнено',
  rejected: 'Не принято',
};

export function Tasks() {
  const session = useSession();
  const isParent = session?.role === 'parent';
  const path = usePath();
  const initialChild = new URLSearchParams(path.split('?')[1] ?? '').get('child');

  const q = useQuery(async () => {
    const [tasks, family] = await Promise.all([api.tasks(), isParent ? api.familyView() : Promise.resolve(null)]);
    return { tasks, children: family?.children.map((c) => c.member) ?? [] };
  }, [isParent]);

  const [childId, setChildId] = useState<string | null>(initialChild);
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState(String(REWARDS.taskDefault));
  const [money, setMoney] = useState('');

  const [create, creating] = useAction(async (cid: string) => {
    const pts = Number(points) || 0;
    const m = money.trim() ? parseMoney(money) : null;
    if (money.trim() && !m) throw new Error('Проверьте сумму награды');
    await api.createTask(cid, title, { points: pts, money: m });
    setTitle('');
    setMoney('');
    toast('Задание отправлено');
  });
  const [submit, submitting] = useAction(async (id: string) => {
    await api.submitTask(id);
    toast('Отправили родителю на проверку');
  });
  const [review, reviewing] = useAction((id: string, ok: boolean) => api.reviewTask(id, ok));

  return (
    <Screen title="Задания" back="/">
      <Load q={q}>
        {({ tasks, children }) => {
          const selected = childId ?? children[0]?.id ?? null;
          const visible = isParent ? tasks.filter((t) => !selected || t.childId === selected) : tasks;
          const active = visible.filter((t) => t.status !== 'done');
          const done = visible.filter((t) => t.status === 'done');
          return (
            <>
              {isParent && children.length > 1 && (
                <div className="ui-chips">
                  {children.map((c) => (
                    <Chip key={c.id} selected={selected === c.id} onClick={() => setChildId(c.id)}>
                      {c.firstName}
                    </Chip>
                  ))}
                </div>
              )}
              <Section title="Текущие">
                {active.length === 0 && <Empty>{isParent ? 'Заданий нет — придумайте первое' : 'Пока заданий нет'}</Empty>}
                {active.map((t) => (
                  <Card key={t.id}>
                    <div className="ui-stack">
                      <div>
                        <div className="t-heading">{t.title}</div>
                        <div className="t-caption muted">
                          {STATUS[t.status]} · {t.reward.points} Маничек{t.reward.money ? ` + ${formatMoney(t.reward.money)}` : ''}
                        </div>
                      </div>
                      {!isParent && t.status === 'assigned' && (
                        <Button onClick={() => submit(t.id)} disabled={submitting} icon="check">
                          Сделано
                        </Button>
                      )}
                      {isParent && t.status === 'submitted' && (
                        <ButtonRow>
                          <Button variant="secondary" onClick={() => review(t.id, false)} disabled={reviewing}>
                            Вернуть
                          </Button>
                          <Button onClick={() => review(t.id, true)} disabled={reviewing}>
                            Принять
                          </Button>
                        </ButtonRow>
                      )}
                    </div>
                  </Card>
                ))}
              </Section>

              {isParent && selected && (
                <Section title="Новое задание">
                  <Field label="Что сделать" value={title} onChange={setTitle} placeholder="Например, полить цветы" />
                  <Field label="Манички" value={points} onChange={setPoints} inputMode="numeric" />
                  <Field label="Деньги, BYN" value={money} onChange={setMoney} inputMode="decimal" hint="Необязательно. Спишем с вашего счёта, когда примете задание" />
                  <Button block onClick={() => create(selected)} disabled={creating || !title.trim()}>
                    Отправить задание
                  </Button>
                </Section>
              )}

              {done.length > 0 && (
                <Section title="Выполненные">
                  <Card flush>
                    {done.slice(0, 10).map((t) => (
                      <div key={t.id} className="ui-row">
                        <span className="ui-row__body t-body">{t.title}</span>
                        <span className="t-label positive">+{t.reward.points} Маничек</span>
                      </div>
                    ))}
                  </Card>
                </Section>
              )}
            </>
          );
        }}
      </Load>
    </Screen>
  );
}
