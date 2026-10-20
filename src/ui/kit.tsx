/**
 * UI-кит на токенах дизайн-системы «Семейный кошелёк».
 * Компоненты «глупые»: получают готовые строки и колбэки, ничего не знают про API.
 * При редизайне заменяется этот файл и kit.css; экраны меняются минимально.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { formatMoney, type Money } from '@/domain';
import { goBack, Link } from '@/app/router';
import { onToasts, type ToastMsg } from '@/app/toast';
import { Icon, type IconName } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- каркас

export function AppFrame({ tabs, children }: { tabs: boolean; children: ReactNode }) {
  return <div className={cx('ui-app', !tabs && 'ui-app--no-tabs')}>{children}</div>;
}

export function Page({ children }: { children: ReactNode }) {
  return <main className="ui-page">{children}</main>;
}

export function TopBar({ title, back = '/', end }: { title: string; back?: string | false; end?: ReactNode }) {
  return (
    <header className="ui-topbar">
      {back !== false ? (
        <button className="ui-iconbtn" onClick={() => goBack(back)} aria-label="Назад">
          <Icon name="back" />
        </button>
      ) : (
        <span className="ui-topbar__spacer" />
      )}
      <h1 className="ui-topbar__title t-title">{title}</h1>
      {end ?? <span className="ui-topbar__spacer" />}
    </header>
  );
}

/** Экран без вкладок: шапка с «Назад» + содержимое. */
export function Screen({ title, back, end, children }: { title: string; back?: string | false; end?: ReactNode; children: ReactNode }) {
  return (
    <>
      <TopBar title={title} back={back} end={end} />
      <Page>{children}</Page>
    </>
  );
}

// ---------------------------------------------------------------- шапка с балансом

export interface QuickAction {
  icon: IconName;
  label: string;
  onClick: () => void;
}

export function BalanceHeader(props: {
  title: string;
  caption: string;
  amount: Money;
  actions: [QuickAction, QuickAction, QuickAction, QuickAction];
  badge?: number;
  onAvatar?: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const text = formatMoney(props.amount);
  return (
    <header className="ui-balance">
      <div className="ui-balance__row">
        <button className="ui-balance__avatar" onClick={props.onAvatar} aria-label="Уведомления">
          <Icon name="user" />
          {props.badge ? <span className="ui-badge">{props.badge > 99 ? '99+' : props.badge}</span> : null}
        </button>
        <div className="ui-balance__name t-title">{props.title}</div>
      </div>
      <div className="ui-balance__caption t-caption">{props.caption}</div>
      <div className="ui-balance__sum">
        <button className="t-display ui-amount" onClick={() => setHidden((h) => !h)} aria-label={hidden ? 'Показать сумму' : 'Скрыть сумму'}>
          {hidden ? `•••• ${props.amount.currency}` : text}
        </button>
        <button className="ui-iconbtn" onClick={() => setHidden((h) => !h)} aria-label={hidden ? 'Показать сумму' : 'Скрыть сумму'} title={hidden ? 'Показать сумму' : 'Скрыть сумму'}>
          <Icon name={hidden ? 'eye-off' : 'eye'} size={22} />
        </button>
      </div>
      <QuickActions actions={props.actions} />
    </header>
  );
}

export function QuickActions({ actions }: { actions: [QuickAction, QuickAction, QuickAction, QuickAction] }) {
  return (
    <nav className="ui-actions" aria-label="Быстрые действия">
      {actions.map((a) => (
        <button key={a.label} className="ui-action t-label" onClick={a.onClick}>
          <span className="ui-action__icon">
            <Icon name={a.icon} size={26} />
          </span>
          <span className="ui-action__label">{a.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- вкладки

export type TabId = 'home' | 'products' | 'chat' | 'more';
const TABS: { id: TabId; label: string; icon: IconName; to: string }[] = [
  { id: 'home', label: 'Главная', icon: 'home', to: '/' },
  { id: 'products', label: 'Продукты', icon: 'products', to: '/products' },
  { id: 'chat', label: 'Чат', icon: 'chat', to: '/chat' },
  { id: 'more', label: 'Ещё', icon: 'more', to: '/more' },
];

export function TabBar({ active, moreBadge, hidden = [] }: { active: TabId | null; moreBadge?: number; hidden?: TabId[] }) {
  const tabs = TABS.filter((t) => !hidden.includes(t.id));
  return (
    <nav className="ui-tabbar" aria-label="Разделы" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
      {tabs.map((t) => (
        <Link key={t.id} to={t.to} className="ui-tab t-label" aria-current={active === t.id ? 'page' : undefined}>
          <Icon name={t.icon} />
          {t.label}
          {t.id === 'more' && moreBadge ? <span className="ui-badge">{moreBadge > 99 ? '99+' : moreBadge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- блоки

export function PromoBanner(props: { tone?: 'accent' | 'brand'; title: string; text: string; action: string; onClick: () => void }) {
  return (
    <section className={cx('ui-banner', `ui-banner--${props.tone ?? 'accent'}`)}>
      <div className="t-heading">{props.title}</div>
      <div className="t-body">{props.text}</div>
      <button className="ui-banner__action t-label" onClick={props.onClick}>
        {props.action}
        <Icon name="chevron" size={18} />
      </button>
    </section>
  );
}

/** Цветная заставка вверху экрана без шапки баланса (вход, онбординг). */
export function Hero({ tag, title, text }: { tag?: string; title: string; text?: string }) {
  return (
    <header className="ui-hero">
      {tag && <span className="ui-hero__tag t-label">{tag}</span>}
      <h1 className="t-title" style={{ margin: 0 }}>{title}</h1>
      {text && <p className="t-body" style={{ margin: 0 }}>{text}</p>}
    </header>
  );
}

export function Section({ title, end, children }: { title?: string; end?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-section">
      {(title || end) && (
        <div className="ui-section__head">
          {title && <h2 className="t-heading" style={{ margin: 0 }}>{title}</h2>}
          {end}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({ children, flush }: { children: ReactNode; flush?: boolean }) {
  return <div className={cx('ui-card', flush && 'ui-card--flush')}>{children}</div>;
}

export function Row(props: {
  icon?: IconName;
  iconTone?: 'brand' | 'muted' | 'accent';
  title: ReactNode;
  subtitle?: ReactNode;
  end?: ReactNode;
  to?: string;
  onClick?: () => void;
  chevron?: boolean;
}) {
  const inner = (
    <>
      {props.icon && (
        <span className={cx('ui-row__icon', props.iconTone === 'muted' && 'ui-row__icon--muted', props.iconTone === 'accent' && 'ui-row__icon--accent')}>
          <Icon name={props.icon} size={22} />
        </span>
      )}
      <span className="ui-row__body">
        <span className="ui-row__title t-body" style={{ display: 'block' }}>{props.title}</span>
        {props.subtitle && <span className="t-caption muted" style={{ display: 'block' }}>{props.subtitle}</span>}
      </span>
      {(props.end || props.chevron) && (
        <span className="ui-row__end">
          {props.end}
          {props.chevron && <Icon name="chevron" size={18} className="ui-row__chev" />}
        </span>
      )}
    </>
  );
  if (props.to) return <Link to={props.to} className="ui-row">{inner}</Link>;
  if (props.onClick) return <button className="ui-row" onClick={props.onClick}>{inner}</button>;
  return <div className="ui-row">{inner}</div>;
}

/** Сумма операции: «+» синим, «−» оранжевым. sign='auto' — остаток/баланс, без цвета. */
export function Amount({ value, sign = 'always', className }: { value: Money; sign?: 'always' | 'auto'; className?: string }) {
  const tone = sign === 'auto' ? '' : value.minor > 0 ? 'positive' : value.minor < 0 ? 'negative' : '';
  return <span className={cx('ui-amount t-body', tone, className)}>{formatMoney(value, { sign })}</span>;
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  block?: boolean;
  small?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  icon?: IconName;
}) {
  return (
    <button
      type={props.type ?? 'button'}
      className={cx('ui-btn', `ui-btn--${props.variant ?? 'primary'}`, props.block && 'ui-btn--block', props.small && 'ui-btn--small')}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.icon && <Icon name={props.icon} size={20} />}
      {props.children}
    </button>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="ui-btnrow">{children}</div>;
}

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date' | 'tel';
  inputMode?: 'decimal' | 'numeric' | 'text';
  placeholder?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="ui-field">
      <span className="t-label">{props.label}</span>
      <input
        className="ui-input"
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        value={props.value}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <span className="t-caption muted">{props.hint}</span>}
    </label>
  );
}

export function Select<T extends string>(props: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="ui-field">
      <span className="t-label">{props.label}</span>
      <select className="ui-input" value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="ui-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="t-body">{children}</span>
    </label>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="ui-segmented" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} aria-pressed={props.value === o.value} disabled={o.disabled} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="ui-chip" aria-pressed={selected} onClick={onClick}>
      {selected && <Icon name="check" size={16} />}
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="ui-switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="ui-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Состояние «доступ запрещён → запросить у родителя». Обязательно для каждого экрана ребёнка. */
export function Locked(props: { title: string; text: string; action?: { label: string; onClick: () => void; disabled?: boolean } }) {
  return (
    <div className="ui-locked">
      <span className="ui-locked__icon">
        <Icon name="lock" />
      </span>
      <div className="ui-stack ui-stack--tight" style={{ flex: 1 }}>
        <div className="t-heading">{props.title}</div>
        <div className="t-body muted">{props.text}</div>
        {props.action && (
          <div style={{ marginTop: 8 }}>
            <Button small onClick={props.action.onClick} disabled={props.action.disabled} icon="ask">
              {props.action.label}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ui-empty t-body">{children}</div>;
}

export function Skeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="ui-stack" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ui-skeleton" />
      ))}
    </div>
  );
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="ui-locked" role="alert">
      <span className="ui-locked__icon">
        <Icon name="alert" />
      </span>
      <div className="ui-stack ui-stack--tight" style={{ flex: 1 }}>
        <div className="t-body">{text}</div>
        {onRetry && (
          <Button small variant="secondary" onClick={onRetry}>
            Повторить
          </Button>
        )}
      </div>
    </div>
  );
}

export function DemoNote({ children }: { children: ReactNode }) {
  return <div className="ui-demo-note t-caption">{children}</div>;
}

export function Toaster() {
  const [list, setList] = useState<ToastMsg[]>([]);
  useEffect(() => onToasts(setList), []);
  return (
    <div className="ui-toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('ui-toast t-body', t.kind === 'error' && 'ui-toast--error')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
