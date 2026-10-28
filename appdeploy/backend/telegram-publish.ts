// No SDK or secrets here: shared deterministic formatting and a dependency-injected transport.
export function formatTelegramPost(content: any, withPhoto = false) {
  const title = String(content.title || '').trim();
  const lead = String(content.lead || '').trim();
  const body = String(content.body || '').trim();
  const source = publicUrl(content.source_url);
  if (!title || !lead || !body || !source)
    throw new Error('TELEGRAM_INVALID_CONTENT');
  const plain =
    title + '\n\n' + lead + '\n\n' + body + '\n\nИсточник: ' + source;
  const limit = withPhoto ? 1024 : 4096;
  // Conservative UTF-16 count also protects emoji boundaries; never silently truncate approved text.
  if (plain.length > limit)
    throw new Error(
      withPhoto ? 'TELEGRAM_CAPTION_TOO_LONG' : 'TELEGRAM_TEXT_TOO_LONG',
    );
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const html =
    '<b>' +
    escape(title) +
    '</b>\n\n' +
    escape(lead) +
    '\n\n' +
    escape(body) +
    '\n\nИсточник: <a href="' +
    escape(source) +
    '">' +
    escape(source) +
    '</a>';
  const photo = withPhoto ? publicUrl(content.image_url) : null;
  if (withPhoto && !photo) throw new Error('TELEGRAM_IMAGE_MISSING');
  return {
    plain,
    html,
    length: plain.length,
    limit,
    photo,
    method: photo ? 'sendPhoto' : 'sendMessage',
  };
}
function publicUrl(value: any) {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes('.')
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export class TelegramFailure extends Error {
  uncertain: boolean;
  retryAfter: number | null;
  constructor(
    code: string,
    uncertain = false,
    retryAfter: number | null = null,
  ) {
    super(code);
    this.name = 'TelegramFailure';
    this.uncertain = uncertain;
    this.retryAfter = retryAfter;
  }
}
export function telegramTransport(
  token: string,
  fetcher: typeof fetch = fetch,
) {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token))
    throw new Error('TELEGRAM_NOT_CONFIGURED');
  return async function call(
    method: string,
    payload: Record<string, unknown> = {},
  ) {
    if (
      ![
        'getMe',
        'getChat',
        'getChatMember',
        'sendMessage',
        'sendPhoto',
      ].includes(method)
    )
      throw new Error('TELEGRAM_METHOD');
    const sending = method === 'sendMessage' || method === 'sendPhoto';
    let response;
    try {
      response = await fetcher(
        'https://api.telegram.org/bot' + token + '/' + method,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000),
          redirect: 'error',
        },
      );
    } catch {
      throw new TelegramFailure('TELEGRAM_NETWORK', sending);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new TelegramFailure('TELEGRAM_RESPONSE', sending);
    }
    if (!data || typeof data !== 'object')
      throw new TelegramFailure('TELEGRAM_RESPONSE', sending);
    if (!response.ok || data.ok !== true) {
      const code = Number(data.error_code || response.status);
      const retryAfter = Number(data.parameters?.retry_after);
      throw new TelegramFailure(
        code === 429
          ? 'TELEGRAM_RATE_LIMIT'
          : code === 401
            ? 'TELEGRAM_TOKEN_INVALID'
            : code === 403
              ? 'TELEGRAM_FORBIDDEN'
              : 'TELEGRAM_REJECTED',
        sending &&
          (response.status >= 500 ||
            !Number.isInteger(code) ||
            code >= 500 ||
            code < 400),
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.ceil(retryAfter)
          : null,
      );
    }
    return data.result;
  };
}
export async function checkTelegramConnection(
  call: (method: string, payload?: Record<string, unknown>) => Promise<any>,
  productionChat: string,
  testChat: string,
) {
  if (!productionChat || !testChat) throw new Error('TELEGRAM_NOT_CONFIGURED');
  const bot = await call('getMe');
  if (!Number.isSafeInteger(bot?.id) || !bot.is_bot)
    throw new Error('TELEGRAM_TOKEN_INVALID');
  async function channel(chatId: string) {
    const chat = await call('getChat', { chat_id: chatId });
    if (chat?.type !== 'channel' || !Number.isSafeInteger(chat.id))
      throw new Error('TELEGRAM_CHANNEL_REQUIRED');
    const member = await call('getChatMember', {
      chat_id: chat.id,
      user_id: bot.id,
    });
    if (
      member?.status !== 'creator' &&
      !(member?.status === 'administrator' && member.can_post_messages === true)
    )
      throw new Error('TELEGRAM_FORBIDDEN');
    return {
      id: String(chat.id),
      title: String(chat.title || 'Канал'),
      username: chat.username || null,
    };
  }
  const production = await channel(productionChat);
  const test = await channel(testChat);
  if (production.id === test.id)
    throw new Error('TELEGRAM_TEST_CHANNEL_REQUIRED');
  return {
    bot_id: bot.id,
    bot_username: bot.username || null,
    production,
    test,
  };
}
export async function deliverTelegramAttempt(
  attempt: any,
  call: (method: string, payload: Record<string, unknown>) => Promise<any>,
  finish: (id: string, outcome: any) => Promise<unknown>,
) {
  const payload: Record<string, unknown> = {
    chat_id: attempt.target_chat_id,
    parse_mode: 'HTML',
  };
  if (attempt.payload.method === 'sendPhoto') {
    payload.photo = attempt.payload.photo;
    payload.caption = attempt.payload.html;
  } else {
    payload.text = attempt.payload.html;
    payload.link_preview_options = { is_disabled: true };
  }
  let sent;
  try {
    sent = await call(attempt.payload.method, payload);
    if (
      !Number.isSafeInteger(sent?.message_id) ||
      String(sent.chat?.id) !== String(attempt.target_chat_id)
    )
      throw new TelegramFailure('TELEGRAM_RESPONSE', true);
  } catch (cause) {
    // Unknown failures are never safe to retry: the remote post might already exist.
    const known = cause instanceof TelegramFailure;
    const state = known && !cause.uncertain ? 'failed' : 'unknown';
    const outcome = {
      state,
      message_id: null,
      error_code: known ? cause.message : 'TELEGRAM_UNKNOWN',
      retry_after: known ? cause.retryAfter : null,
    };
    try {
      await finish(attempt.id, outcome);
    } catch {
      return { state: 'unknown', error_code: 'TELEGRAM_RECORD_FAILED' };
    }
    return outcome;
  }
  try {
    await finish(attempt.id, {
      state: 'sent',
      message_id: sent.message_id,
      error_code: null,
      retry_after: null,
    });
  } catch {
    return { state: 'unknown', error_code: 'TELEGRAM_RECORD_FAILED' };
  }
  return { state: 'sent', message_id: sent.message_id };
}
