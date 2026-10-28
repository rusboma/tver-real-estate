import { useEffect, useState } from 'react';
import { api } from '@appdeploy/client';
import TelegramPublisher from './TelegramPublisher';

type Item = {
  article_id: string;
  id?: string;
  title: string;
  lead?: string;
  body: string;
  source_url: string;
  source_name: string | null;
  draft_revision: number;
  plan_revision?: number;
  scheduled_at?: string;
  cancelled_at?: string;
  requires_review?: boolean;
};
type Queue = {
  ready: Item[];
  planned: Item[];
  cancelled: Item[];
  stats: { ready: number; planned: number; overdue: number; cancelled: number };
};
const displayTime = (value?: string) =>
  value
    ? new Date(value).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Время не задано';
const localTime = (value?: string) =>
  value
    ? new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 16)
    : '';
function errorMessage(cause: unknown) {
  const value = cause as {
    response?: { data?: { error?: string; message?: string } };
  };
  return (
    value.response?.data?.error ||
    value.response?.data?.message ||
    'Не удалось загрузить план. Повторите попытку.'
  );
}

export default function PublicationQueue({
  onChanged,
}: {
  onChanged: () => void;
}) {
  const [data, setData] = useState<Queue | null>(null);
  const [tab, setTab] = useState<'ready' | 'planned' | 'cancelled'>('ready');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [time, setTime] = useState('');
  const [confirm, setConfirm] = useState<
    'schedule' | 'reschedule' | 'cancel' | ''
  >('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get('/api/publication-queue')
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  async function changePlan() {
    if (!selected || !confirm) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/publication-plan', {
        action: confirm,
        article_id: selected.article_id,
        publication_id: selected.id,
        draft_revision: selected.draft_revision,
        expected_revision: selected.plan_revision,
        scheduled_moscow: time,
      });
      setNotice(
        confirm === 'cancel'
          ? 'Материал снят с плана. Черновик сохранён.'
          : 'Время выхода сохранено по Москве. Автоматическая отправка по расписанию отключена.',
      );
      setSelected(null);
      setConfirm('');
      setRetry((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const items = data?.[tab] || [];
  return (
    <section className="publication-queue">
      <div className="plan-note">
        <strong>Планирование · время Москвы</strong>
        <p>
          В очереди только одобренные черновики. Автоматическая отправка по
          расписанию отключена. Ручная публикация доступна после настройки и
          проверки Telegram.
        </p>
      </div>
      <div className="plan-stats">
        <span>
          Готовы: <strong>{data?.stats.ready ?? '—'}</strong>
        </span>
        <span>
          В плане: <strong>{data?.stats.planned ?? '—'}</strong>
        </span>
        <span>
          Время наступило: <strong>{data?.stats.overdue ?? '—'}</strong>
        </span>
        <button
          disabled={busy || loading}
          onClick={() => {
            setSelected(null);
            setConfirm('');
            setRetry((value) => value + 1);
          }}
        >
          Обновить план
        </button>
      </div>
      <div className="plan-tabs">
        <button
          className={tab === 'ready' ? 'active' : ''}
          onClick={() => {
            setTab('ready');
            setSelected(null);
            setConfirm('');
          }}
        >
          Готовы к выходу
        </button>
        <button
          className={tab === 'planned' ? 'active' : ''}
          onClick={() => {
            setTab('planned');
            setSelected(null);
            setConfirm('');
          }}
        >
          Запланированы
        </button>
        <button
          className={tab === 'cancelled' ? 'active' : ''}
          onClick={() => {
            setTab('cancelled');
            setSelected(null);
            setConfirm('');
          }}
        >
          Сняты с плана
        </button>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Загружаем очередь публикаций…</p>
      ) : !items.length ? (
        <div className="empty">
          <h3>
            {tab === 'ready'
              ? 'Нет готовых черновиков'
              : tab === 'planned'
                ? 'План пока пуст'
                : 'Снятых материалов пока нет'}
          </h3>
          <p>
            {tab === 'ready'
              ? 'Подготовьте черновик в карточке новости, проверьте факты и одобрите его.'
              : 'Материалы появятся здесь после действий с планом.'}
          </p>
        </div>
      ) : (
        <div className="plan-list">
          {items.map((item, index) => (
            <article className="plan-card" key={item.id || item.article_id}>
              <div className="plan-card-meta">
                <span>
                  {tab === 'planned'
                    ? '#' +
                      (index + 1) +
                      ' · ' +
                      displayTime(item.scheduled_at) +
                      ' МСК'
                    : tab === 'cancelled'
                      ? 'Снят · ' + displayTime(item.cancelled_at) + ' МСК'
                      : 'Одобренный черновик'}
                </span>
                <small>Версия {item.draft_revision}</small>
              </div>
              <h3>{item.title}</h3>
              <p>{item.lead || item.body.slice(0, 250)}</p>
              <small>{item.source_name || 'Источник'}</small>
              {item.requires_review && tab === 'planned' && (
                <p className="alert">
                  Источник или решение изменились. Снимите материал с плана и
                  проверьте заново.
                </p>
              )}
              <button
                disabled={busy}
                onClick={() => {
                  setSelected(item);
                  setTime(localTime(item.scheduled_at));
                  setConfirm('');
                }}
              >
                Текст и время выхода
              </button>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <section className="plan-detail" aria-label="План материала">
          <div className="draft-heading">
            <h3>{selected.title}</h3>
            <button
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setConfirm('');
              }}
            >
              Закрыть
            </button>
          </div>
          {selected.lead && <p>{selected.lead}</p>}
          {selected.body
            .split(/\n\n+/)
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          <a
            href={selected.source_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Оригинальная публикация
          </a>
          {tab !== 'cancelled' && (
            <>
              <label className="plan-time">
                Дата и время выхода (Москва, UTC+3)
                <input
                  type="datetime-local"
                  value={time}
                  disabled={busy}
                  onChange={(event) => {
                    setTime(event.target.value);
                    setConfirm('');
                  }}
                />
              </label>
              <small>
                Для правок запланированного текста сначала снимите материал с
                плана.
              </small>
              <div className="decision-buttons">
                <button
                  className="primary"
                  disabled={busy || !time || selected.requires_review}
                  onClick={() =>
                    setConfirm(tab === 'ready' ? 'schedule' : 'reschedule')
                  }
                >
                  {tab === 'ready' ? 'Поставить в план' : 'Изменить время'}
                </button>
                {tab === 'planned' && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => setConfirm('cancel')}
                  >
                    Снять с плана
                  </button>
                )}
              </div>
              {confirm && (
                <div className="draft-confirm">
                  <p>
                    {confirm === 'cancel'
                      ? 'Снять материал с плана? Черновик и история сохранятся.'
                      : 'Сохранить время ' +
                        time.replace('T', ' ') +
                        ' по Москве? Автоматическая отправка по расписанию отключена.'}
                  </p>
                  <div className="decision-buttons">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void changePlan()}
                    >
                      {busy ? 'Сохраняем…' : 'Подтвердить'}
                    </button>
                    <button disabled={busy} onClick={() => setConfirm('')}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
      <TelegramPublisher
        articleId={tab === 'cancelled' ? undefined : selected?.article_id}
        onChanged={() => {
          setSelected(null);
          setConfirm('');
          setRetry((value) => value + 1);
          onChanged();
        }}
      />
    </section>
  );
}
