import {
  json,
  error,
  requireAuth,
  requireAdminEmailAllowlist,
  secrets,
} from '@appdeploy/sdk';
import type { RouterMiddleware, RouterRoutes } from '@appdeploy/sdk';
import {
  formatTelegramPost,
  telegramTransport,
  checkTelegramConnection,
  deliverTelegramAttempt,
} from './telegram-publish';
type Rpc = (name: string, payload: Record<string, unknown>) => Promise<any>;
const messages: Record<string, string> = {
  TELEGRAM_NOT_CONFIGURED:
    'Добавьте токен бота и идентификаторы основного и тестового каналов через защищённую форму AppDeploy.',
  TELEGRAM_TOKEN_INVALID:
    'Telegram отклонил токен бота. Проверьте защищённые настройки.',
  TELEGRAM_FORBIDDEN:
    'Боту нужен доступ администратора с правом публикации в обоих каналах.',
  TELEGRAM_CHANNEL_REQUIRED:
    'Укажите канал Telegram: личные чаты и группы не поддерживаются.',
  TELEGRAM_TEST_CHANNEL_REQUIRED:
    'Тестовый и основной каналы должны быть разными.',
  TELEGRAM_INVALID_TARGET:
    'Настройки канала изменились. Повторите проверку подключения.',
  TELEGRAM_TEST_REQUIRED:
    'Сначала успешно отправьте пост в тестовый канал этим ботом.',
  TELEGRAM_DELIVERY_LOCKED:
    'Отправка уже начата или её результат требует проверки. Не отправляйте повторно; проверьте канал и журнал.',
  TELEGRAM_RETRY_LATER:
    'Telegram попросил подождать. Время следующей попытки указано в журнале.',
  TELEGRAM_INVALID_CONTENT:
    'Проверьте текст и ссылку на источник в одобренном черновике.',
  TELEGRAM_TEXT_TOO_LONG:
    'Пост длиннее 4096 знаков. Сократите черновик и одобрите его заново.',
  TELEGRAM_CAPTION_TOO_LONG:
    'Для поста с изображением доступно до 1024 знаков. Сократите текст или выберите отправку без изображения.',
  TELEGRAM_IMAGE_MISSING:
    'У новости нет доступного изображения. Выберите отправку без изображения.',
  TELEGRAM_NETWORK:
    'Telegram не ответил. Повторите проверку подключения позже.',
  TELEGRAM_REJECTED:
    'Telegram отклонил запрос. Проверьте права бота и настройки канала.',
  TELEGRAM_RATE_LIMIT: 'Telegram временно ограничил запросы. Повторите позже.',
  TELEGRAM_RESPONSE:
    'Не удалось подтвердить ответ Telegram. Проверьте подключение позже.',
};
export function telegramRoutes(
  rpc: Rpc,
  safe: (fn: RouterMiddleware) => RouterMiddleware,
  admins: string[],
): RouterRoutes {
  const guard = (fn: RouterMiddleware) => [
    requireAuth(),
    requireAdminEmailAllowlist(admins),
    safe(async (ctx) => {
      try {
        return await fn(ctx);
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        if (messages[code])
          return error(
            messages[code],
            code === 'TELEGRAM_NOT_CONFIGURED'
              ? 503
              : code === 'TELEGRAM_TEXT_TOO_LONG' ||
                  code === 'TELEGRAM_CAPTION_TOO_LONG' ||
                  code === 'TELEGRAM_INVALID_CONTENT' ||
                  code === 'TELEGRAM_IMAGE_MISSING'
                ? 422
                : 409,
          );
        throw cause;
      }
    }),
  ];
  async function connection() {
    let token: string, production: string, test: string;
    try {
      [token, production, test] = await Promise.all(
        [
          'TELEGRAM_BOT_TOKEN',
          'TELEGRAM_CHANNEL_ID',
          'TELEGRAM_TEST_CHANNEL_ID',
        ].map((name) => secrets.readSecret(name)),
      );
    } catch {
      throw new Error('TELEGRAM_NOT_CONFIGURED');
    }
    const call = telegramTransport(token.trim());
    const status = await checkTelegramConnection(
      call,
      production.trim(),
      test.trim(),
    );
    return { call, status };
  }
  function request(body: unknown) {
    const value = body as {
      article_id?: string;
      kind?: string;
      with_photo?: boolean;
      preview_key?: string;
    } | null;
    if (
      !value ||
      typeof value.article_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.article_id,
      ) ||
      !['test', 'production'].includes(value.kind || '') ||
      typeof value.with_photo !== 'boolean'
    )
      return null;
    return value;
  }
  function argumentsFor(
    value: NonNullable<ReturnType<typeof request>>,
    status: any,
  ) {
    return {
      p_article_id: value.article_id,
      p_kind: value.kind,
      p_bot_id: status.bot_id,
      p_production_chat_id: status.production.id,
      p_target_chat_id:
        value.kind === 'test' ? status.test.id : status.production.id,
      p_with_photo: value.with_photo,
    };
  }
  return {
    'GET /api/telegram/status': guard(async () => {
      const names = await secrets.listSecretNames();
      const configured = [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_CHANNEL_ID',
        'TELEGRAM_TEST_CHANNEL_ID',
      ].every((name) => names.includes(name));
      return json({
        configured,
        scheduled_publishing: false,
        history: await rpc('editorial_telegram_history', {}),
      });
    }),
    'POST /api/telegram/check': guard(async () => {
      const { status } = await connection();
      return json({ ...status, configured: true, scheduled_publishing: false });
    }),
    'POST /api/telegram/preview': guard(async (ctx) => {
      const value = request(ctx.body);
      if (!value)
        return error('Выберите одобренный материал и вид отправки.', 400);
      const { status } = await connection();
      const snapshot = await rpc(
        'editorial_telegram_preview',
        argumentsFor(value, status),
      );
      const post = formatTelegramPost(snapshot, value.with_photo);
      return json({
        article_id: value.article_id,
        kind: value.kind,
        with_photo: value.with_photo,
        preview_key: snapshot.preview_key,
        draft_revision: snapshot.draft_revision,
        target: value.kind === 'test' ? status.test : status.production,
        post,
      });
    }),
    'POST /api/telegram/send': guard(async (ctx) => {
      const value = request(ctx.body);
      if (
        !value ||
        typeof value.preview_key !== 'string' ||
        !/^[a-f0-9]{32}$/.test(value.preview_key)
      )
        return error('Сначала откройте актуальный предпросмотр.', 400);
      const { call, status } = await connection();
      const args = argumentsFor(value, status);
      const snapshot = await rpc('editorial_telegram_preview', args);
      if (snapshot.preview_key !== value.preview_key)
        return error(
          'Текст, версия или канал изменились. Откройте предпросмотр заново.',
          409,
        );
      const payload = formatTelegramPost(snapshot, value.with_photo);
      const attempt = await rpc('editorial_telegram_claim', {
        ...args,
        p_preview_key: value.preview_key,
        p_payload: payload,
        p_actor_id: ctx.user!.userId,
        p_actor_email: ctx.user!.email,
      });
      const result = await deliverTelegramAttempt(
        attempt,
        call,
        (id, outcome) =>
          rpc('editorial_telegram_finish', {
            p_attempt_id: id,
            p_state: outcome.state,
            p_message_id: outcome.message_id,
            p_error_code: outcome.error_code,
            p_retry_after: outcome.retry_after,
          }),
      );
      const target = value.kind === 'test' ? status.test : status.production;
      const messageUrl =
        result.state === 'sent' && result.message_id
          ? target.username
            ? 'https://t.me/' + target.username + '/' + result.message_id
            : 'https://t.me/c/' +
              target.id.replace(/^-100/, '') +
              '/' +
              result.message_id
          : null;
      return json({
        ...result,
        kind: value.kind,
        message_url: messageUrl,
        attempt_id: attempt.id,
        notice:
          result.state === 'sent'
            ? value.kind === 'test'
              ? 'Пост отправлен в тестовый канал. Основная очередь не изменена.'
              : 'Пост опубликован в основном канале.'
            : result.state === 'unknown'
              ? 'Результат отправки не подтверждён. Повторная отправка заблокирована: проверьте канал и журнал.'
              : 'Telegram отклонил отправку. Текст сохранён; повторите после проверки ошибки в журнале.',
      });
    }),
  };
}
