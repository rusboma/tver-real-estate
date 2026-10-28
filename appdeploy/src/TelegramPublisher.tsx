import { useEffect, useState } from 'react';
import { api } from '@appdeploy/client';
type Receipt = {
  id: string;
  article_id: string;
  title: string;
  kind: 'test' | 'production';
  state: string;
  bot_id: number;
  production_chat_id: string;
  target_chat_id: string;
  created_at: string;
  retry_after?: string;
  telegram_message_id?: number;
  error_code?: string;
};
type Connection = {
  bot_id: number;
  bot_username: string | null;
  production: { id: string; title: string };
  test: { id: string; title: string };
};
type Preview = {
  article_id: string;
  kind: 'test' | 'production';
  with_photo: boolean;
  preview_key: string;
  draft_revision: number;
  target: { id: string; title: string };
  post: { plain: string; length: number; limit: number; photo: string | null };
};
const time = (value: string) =>
  new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
const message = (cause: unknown) => {
  const value = cause as { response?: { data?: { error?: string } } };
  return (
    value.response?.data?.error ||
    'Нет подтверждения операции. Обновите журнал перед повторной отправкой.'
  );
};
const stateLabel = (row: Receipt) =>
  row.state === 'sent'
    ? 'Отправлено'
    : row.state === 'failed'
      ? 'Не отправлено'
      : row.state === 'unknown' ||
          Date.now() - Date.parse(row.created_at) > 60000
        ? 'Нужно проверить канал'
        : 'Отправляем…';
export default function TelegramPublisher({
  articleId,
  onChanged,
}: {
  articleId?: string;
  onChanged: () => void;
}) {
  const [configured, setConfigured] = useState(false),
    [connection, setConnection] = useState<Connection | null>(null);
  const [history, setHistory] = useState<Receipt[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null),
    [withPhoto, setWithPhoto] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  async function refresh() {
    const response = await api.get('/api/telegram/status');
    setConfigured(response.data.configured);
    setHistory(response.data.history);
  }
  useEffect(() => {
    let active = true;
    api
      .get('/api/telegram/status')
      .then(({ data }) => {
        if (active) {
          setConfigured(data.configured);
          setHistory(data.history);
        }
      })
      .catch((cause) => {
        if (active) setError(message(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setPreview(null);
    setConfirmed(false);
    setWithPhoto(false);
  }, [articleId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (busy) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  async function check() {
    setBusy(true);
    setError('');
    setPreview(null);
    setConnection(null);
    try {
      const { data } = await api.post('/api/telegram/check', {});
      setConnection(data);
      await refresh();
      setNotice('Бот может публиковать в обоих каналах.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function prepare(kind: 'test' | 'production') {
    if (!articleId) return;
    setBusy(true);
    setError('');
    setNotice('');
    setPreview(null);
    setConfirmed(false);
    try {
      const { data } = await api.post('/api/telegram/preview', {
        article_id: articleId,
        kind,
        with_photo: withPhoto,
      });
      setPreview(data);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!preview || !confirmed) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/api/telegram/send', {
        article_id: preview.article_id,
        kind: preview.kind,
        with_photo: preview.with_photo,
        preview_key: preview.preview_key,
      });
      setNotice(data.notice);
      setPreview(null);
      setConfirmed(false);
      onChanged();
    } catch (cause) {
      setError(message(cause));
      setPreview(null);
      setConfirmed(false);
    } finally {
      try {
        await refresh();
      } catch {
        setError(
          'Не удалось обновить журнал. Перед повторной отправкой проверьте канал и обновите страницу.',
        );
      }
      setBusy(false);
    }
  }
  const tested =
    !!connection &&
    history.some(
      (row) =>
        row.kind === 'test' &&
        row.state === 'sent' &&
        row.bot_id === connection.bot_id &&
        row.production_chat_id === connection.production.id,
    );
  return (
    <section className="plan-detail" aria-label="Публикация в Telegram">
      <h3>Публикация в Telegram</h3>
      <p>
        Ручная отправка одобренного текста. Публикация по расписанию пока
        отключена.
      </p>
      {!configured && (
        <p className="alert">
          Бот не настроен. Нужны токен и идентификаторы основного и отдельного
          тестового каналов. Токен добавляется через защищённую форму AppDeploy.
        </p>
      )}
      <div className="decision-buttons">
        <button disabled={busy || !configured} onClick={() => void check()}>
          Проверить подключение
        </button>
        <button
          disabled={busy}
          onClick={() => {
            void refresh().catch((cause) => setError(message(cause)));
          }}
        >
          Обновить журнал
        </button>
      </div>
      {connection && (
        <p>
          Бот: @{connection.bot_username || connection.bot_id}. Основной канал:{' '}
          <strong>{connection.production.title}</strong>. Тестовый:{' '}
          <strong>{connection.test.title}</strong>.
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!articleId ? (
        <p>
          Откройте «Текст и время выхода» у одобренного материала выше, чтобы
          подготовить отправку.
        </p>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              checked={withPhoto}
              disabled={busy}
              onChange={(event) => {
                setWithPhoto(event.target.checked);
                setPreview(null);
                setConfirmed(false);
              }}
            />{' '}
            Прикрепить изображение источника (проверьте право использования;
            текст до 1024 знаков)
          </label>
          <div className="decision-buttons">
            <button
              disabled={busy || !connection}
              onClick={() => void prepare('test')}
            >
              Предпросмотр для тестового канала
            </button>
            <button
              className="primary"
              disabled={busy || !connection || !tested}
              onClick={() => void prepare('production')}
            >
              Предпросмотр публикации
            </button>
          </div>
          {!tested && (
            <p>
              Перед основной публикацией нужна успешная отправка в тестовый
              канал.
            </p>
          )}
        </>
      )}
      {preview && (
        <section className="draft-confirm" aria-label="Предпросмотр поста">
          <p>
            <strong>
              {preview.kind === 'test'
                ? 'Тестовая отправка'
                : 'Основная публикация'}
            </strong>{' '}
            · {preview.target.title} · версия {preview.draft_revision}
          </p>
          {preview.post.photo && (
            <img
              src={preview.post.photo}
              alt="Изображение из источника"
              style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }}
            />
          )}
          <div
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              padding: '1rem',
              border: '1px solid #dbe3ea',
              borderRadius: 12,
            }}
          >
            {preview.post.plain}
          </div>
          <small>
            {preview.post.length} из {preview.post.limit} знаков. Заголовок
            будет выделен жирным.
          </small>
          <p>
            {preview.kind === 'production'
              ? 'Отправка произойдёт сейчас, независимо от времени в редакционном плане.'
              : 'Основной канал и статус публикации не изменятся.'}
          </p>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{' '}
            Текст, источник, изображение и выбранный канал проверены.
          </label>
          <div className="decision-buttons">
            <button
              className="primary"
              disabled={busy || !confirmed}
              onClick={() => void send()}
            >
              {busy
                ? 'Отправляем…'
                : preview.kind === 'test'
                  ? 'Отправить в тестовый канал'
                  : 'Опубликовать в Telegram'}
            </button>
            <button disabled={busy} onClick={() => setPreview(null)}>
              Отмена
            </button>
          </div>
        </section>
      )}
      <details>
        <summary>Журнал отправок ({history.length})</summary>
        {!history.length ? (
          <p>Отправок ещё не было.</p>
        ) : (
          history.slice(0, 30).map((row) => (
            <article key={row.id} className="plan-card">
              <strong>{row.title}</strong>
              <p>
                {row.kind === 'test' ? 'Тестовый канал' : 'Основной канал'} ·{' '}
                {stateLabel(row)} · {time(row.created_at)} МСК
              </p>
              {row.telegram_message_id && (
                <a
                  href={
                    'https://t.me/c/' +
                    row.target_chat_id.replace(/^-100/, '') +
                    '/' +
                    row.telegram_message_id
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть пост
                </a>
              )}
              {row.retry_after && (
                <p>Повторить не раньше {time(row.retry_after)} МСК.</p>
              )}
              {['sending', 'unknown'].includes(row.state) && (
                <p>
                  Повторная отправка заблокирована до подтверждения результата.
                  Проверьте, появился ли пост в канале. Код попытки: {row.id}.
                </p>
              )}
              {row.state === 'failed' && (
                <p>
                  Telegram отклонил запрос. Проверьте подключение и подготовьте
                  новый предпросмотр материала.
                </p>
              )}
            </article>
          ))
        )}
      </details>
    </section>
  );
}
