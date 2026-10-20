/** Уроки финграмотности: у ребёнка — по возрасту, у родителя — свои. Баллы у каждого отдельно. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { navigate } from '@/app/router';
import { lessonsFor, LESSONS, type AgeGroup } from '@/domain';
import { Button, Card, Empty, Row, Screen, Section } from '@/ui/kit';
import { Load } from '../shared';

async function myGroup(): Promise<{ memberId: string; group: AgeGroup | 'parents' }> {
  const me = await api.me();
  if (me.role === 'parent') return { memberId: me.id, group: 'parents' };
  const o = await api.childOverview(me.id);
  return { memberId: me.id, group: o.settings.ageGroup };
}

export function Learn() {
  const q = useQuery(async () => {
    const { memberId, group } = await myGroup();
    const progress = await api.lessonProgress(memberId);
    return { lessons: lessonsFor(group), done: new Set(progress.map((p) => p.lessonId)), group };
  }, []);
  return (
    <Screen title="Уроки" back="/">
      <Load q={q}>
        {({ lessons, done, group }) => (
          <>
            <p className="t-body muted" style={{ margin: 0 }}>
              {group === 'parents' ? 'Короткие советы, как говорить с ребёнком о деньгах.' : 'Проходи уроки, отвечай на вопросы и получай баллы.'}
            </p>
            <Card flush>
              {lessons.map((l) => (
                <Row
                  key={l.id}
                  icon={done.has(l.id) ? 'check' : 'book'}
                  iconTone={done.has(l.id) ? 'brand' : 'muted'}
                  title={l.title}
                  subtitle={`${l.minutes} мин · ${done.has(l.id) ? 'пройдено' : `+${l.points} баллов`}`}
                  to={`/learn/${l.id}`}
                  chevron
                />
              ))}
            </Card>
            {lessons.length === 0 && <Empty>Уроков пока нет</Empty>}
          </>
        )}
      </Load>
    </Screen>
  );
}

export function Lesson({ id }: { id: string }) {
  const lesson = LESSONS.find((l) => l.id === id);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<{ score: number; points: number } | null>(null);
  const [finish, busy] = useAction(async () => setResult(await api.completeLesson(id, answers)));

  if (!lesson) return <Screen title="Урок" back="/learn"><Empty>Урок не найден</Empty></Screen>;
  const complete = lesson.quiz.every((_, i) => answers[i] !== undefined);

  return (
    <Screen title={lesson.title} back="/learn">
      <Card>
        <p className="t-body" style={{ margin: 0 }}>{lesson.body}</p>
      </Card>
      {lesson.quiz.map((qz, qi) => (
        <Section key={qi} title={qz.question}>
          <div className="ui-chips">
            {qz.options.map((opt, oi) => {
              const chosen = answers[qi] === oi;
              const reveal = result !== null;
              return (
                <button
                  key={oi}
                  className="ui-chip"
                  aria-pressed={chosen}
                  disabled={reveal}
                  onClick={() => {
                    const next = [...answers];
                    next[qi] = oi;
                    setAnswers(next);
                  }}
                >
                  {opt}
                  {reveal && oi === qz.correct ? ' — верно' : ''}
                </button>
              );
            })}
          </div>
        </Section>
      ))}
      {!result ? (
        <Button block onClick={() => finish()} disabled={!complete || busy}>
          Проверить
        </Button>
      ) : (
        <Card>
          <div className="ui-stack">
            <div className="t-heading">{result.score >= 0.5 ? 'Урок пройден' : 'Попробуй ещё раз'}</div>
            <div className="t-body">
              Правильных ответов: {Math.round(result.score * lesson.quiz.length)} из {lesson.quiz.length}
              {result.points ? `. Начислено ${result.points} баллов` : ''}
            </div>
            <Button variant="secondary" onClick={() => (result.score >= 0.5 ? navigate('/learn', { replace: true }) : (setResult(null), setAnswers([])))}>
              {result.score >= 0.5 ? 'К урокам' : 'Заново'}
            </Button>
          </div>
        </Card>
      )}
    </Screen>
  );
}
