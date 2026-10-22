import {
  router,
  json,
  error,
  requireAuth,
  requireAdminEmailAllowlist,
  secrets,
  ai,
} from '@appdeploy/sdk';
import type { RouterMiddleware } from '@appdeploy/sdk';
import { cleanEditorialText } from './editorial-text';
import { fetchSourceContent } from './extract';
import type { SourceContent } from './extract';
import { dateRange } from './editorial-dates';
import { moscowSchedule } from './publication-time';
import { DRAFT_SYSTEM, validateGeneratedDraft } from './draft-validation';

import { buildSourceDraft } from './source-draft';

import { telegramRoutes } from './telegram-routes';

const ADMIN_EMAILS = ['rusboma@gmail.com'];
const SUPABASE_URL = 'https://nlvwxpjhpulmxjvibbye.supabase.co';

async function rpc(name: string, payload: Record<string, unknown>) {
  let key: string;
  try {
    key = await secrets.readSecret('SUPABASE_SERVICE_ROLE_KEY');
  } catch {
    throw new Error('NOT_CONFIGURED');
  }
  const headers: Record<string, string> = {
    apikey: key,
    'Content-Type': 'application/json',
  };
  if (!key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + key;
  const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    for (const code of ['TELEGRAM_INVALID_TARGET','TELEGRAM_TEST_REQUIRED','TELEGRAM_DELIVERY_LOCKED','TELEGRAM_RETRY_LATER','TELEGRAM_INVALID_CONTENT']) {
      if(result.message?.includes(code)) throw new Error(code);
    }
    if (result.message?.includes('DUPLICATE_BLOCKED')) throw new Error('DUPLICATE_BLOCKED');
    if (result.message?.includes('DUPLICATE_REVIEW_REQUIRED')) throw new Error('DUPLICATE_REVIEW_REQUIRED');
    if (result.message?.includes('EXACT_DUPLICATE')) throw new Error('EXACT_DUPLICATE');
    if (result.message?.includes('INVALID_DATE_RANGE')) throw new Error('INVALID_DATE_RANGE');
    if (result.message?.includes('INVALID_PLAN_TIME')) throw new Error('INVALID_PLAN_TIME');
    if (result.message?.includes('EVENT_DATE_PASSED')) throw new Error('EVENT_DATE_PASSED');
    if (result.message?.includes('DRAFT_APPROVAL_REQUIRED')) throw new Error('DRAFT_APPROVAL_REQUIRED');
    if (result.message?.includes('FACT_CHECK_REQUIRED')) throw new Error('FACT_CHECK_REQUIRED');
    if (result.message?.includes('Invalid')) throw new Error('INVALID_DRAFT');
    if (result.message?.includes('Conflict')) throw new Error('CONFLICT');
    if (result.message?.includes('locked')) throw new Error('LOCKED');
    if (result.message?.includes('not found')) throw new Error('NOT_FOUND');
    throw new Error('DATABASE_ERROR');
  }
  return response.json();
}

const safe =
  (fn: RouterMiddleware): RouterMiddleware =>
  async ctx => {
    try {
      return await fn(ctx);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      if (code === 'INVALID_DATE_RANGE') return error('Укажите корректный период: дата начала не может быть позже даты окончания.', 400);
      if (code === 'INVALID_PLAN_TIME') return error('Выберите корректное время по Москве: не раньше чем через минуту и не дальше года.', 400);
      if (code === 'EVENT_DATE_PASSED') return error('Анонс нельзя запланировать после даты мероприятия.', 400);
      if (code === 'DRAFT_APPROVAL_REQUIRED') return error('Сначала сохраните и одобрите черновик.', 409);
      if (code === 'FACT_CHECK_REQUIRED') return error('Подтвердите проверку фактов и источника.', 400);
      if (code === 'INVALID_DRAFT') return error('Проверьте обязательные поля и цитаты из источника.', 400);
      if (code === 'AI_INVALID_OUTPUT' || code === 'AI_UNSUPPORTED_EVIDENCE') return error('Не удалось получить черновик с подтверждёнными цитатами. Повторите подготовку; предыдущая версия сохранена.', 422);
      if (code === 'SOURCE_DRAFT_INSUFFICIENT') return error('В источнике недостаточно текста для резервного черновика. Загрузите полный оригинал.',422);
      if (code === 'AI_RATE_LIMIT') return error('Достигнут лимит подготовки черновиков. Повторите запуск позже; готовые тексты сохранены.', 429);
      if (code === 'AI_UNAVAILABLE') return error('Подготовка черновика сейчас недоступна. Повторите позже; сохранённый текст не изменён.', 502);
      if (code === 'NOT_CONFIGURED')
        return error(
          'Подключение Supabase ещё не настроено. Добавьте серверный ключ в AppDeploy.',
          503
        );
      if (code === 'CONFLICT')
        return error(
          'Новость уже изменена. Обновите очередь и повторите решение.',
          409
        );
      if (code === 'LOCKED')
        return error(
          'Опубликованный или архивный материал нельзя изменить.',
          409
        );
      if (code === 'DUPLICATE_BLOCKED') return error('Повтор заблокирован: другой материал об этом событии уже одобрен, запланирован или опубликован.', 409);
      if (code === 'DUPLICATE_REVIEW_REQUIRED') return error('Сначала выберите основной материал среди совпадений или подтвердите существенное обновление с пояснением.', 409);
      if (code === 'EXACT_DUPLICATE') return error('Одинаковый текст или ссылка не могут считаться существенным обновлением.', 409);
      if (code === 'NOT_FOUND') return error('Новость не найдена.', 404);
      if (code === 'UNSUPPORTED_SOURCE') return error('Полный текст этого источника пока не поддерживается. Откройте оригинал.', 422);
      if (code === 'CONTENT_NOT_FOUND') return error('На странице источника не найден полный текст. Откройте оригинал или повторите загрузку.', 422);
      if (code === 'SOURCE_UNAVAILABLE' || (cause instanceof Error && cause.name === 'AbortError')) {
        return error('Источник сейчас недоступен. Повторите загрузку или откройте оригинал.', 502);
      }
      return error(
        'Не удалось выполнить запрос к базе. Попробуйте ещё раз.',
        502
      );
    }
  };


type DraftRequest = {
  expected_revision: number;
  source_fingerprint: string;
  article_updated_at: string;
  confirm_replace?: boolean;
  batch?: boolean;
  prefer_source_excerpt?: boolean;
  verified?: boolean;
  content?: unknown;
};
const validArticleId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function validDraftRequest(value: DraftRequest | null): boolean {
  return !!value && Number.isInteger(value.expected_revision) && value.expected_revision >= 0 &&
    typeof value.source_fingerprint === 'string' && /^[0-9a-f]{32}$/.test(value.source_fingerprint) &&
    typeof value.article_updated_at === 'string' && Number.isFinite(Date.parse(value.article_updated_at));
}
function isEventContext(context: any): boolean {
  return !!context.article.event_date || context.article.source_type === 'national_training' ||
    /Программа (?:семинара|вебинара|курса)\s*:/i.test(context.source_text || '');
}
const draftSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {type:'string'}, lead:{type:'string'}, body:{type:'string'},
    verification_notes:{type:'string'},
    content_kind:{type:'string',enum:['news','practice','event_announcement']},
    facts:{type:'array',minItems:1,maxItems:5,items:{type:'object',additionalProperties:false,
      properties:{claim:{type:'string'},quote:{type:'string'}},required:['claim','quote']}},
  },
  required:['title','lead','body','verification_notes','content_kind','facts'],
};
async function writeDraft(ctx: Parameters<RouterMiddleware>[0], request: DraftRequest, action: string, content: unknown) {
  return rpc('editorial_draft_write', {
    p_article_id: ctx.params.id, p_action: action, p_content: content,
    p_expected_revision: request.expected_revision, p_source_fingerprint: request.source_fingerprint,
    p_expected_article_updated_at: request.article_updated_at,
    p_actor_id: ctx.user!.userId, p_actor_email: ctx.user!.email, p_verified: request.verified === true,
  });
}

export const handler = router({
  ...telegramRoutes(rpc,safe,ADMIN_EMAILS),
  'GET /api/draft-batch': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async () => json(await rpc('editorial_draft_batch_list', {}))),
  ],
  'GET /api/publication-queue': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async () => json(await rpc('editorial_publication_queue', {}))),
  ],
  'POST /api/publication-plan': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ctx => {
      const body = ctx.body as {
        action?: string; article_id?: string; publication_id?: string;
        draft_revision?: number; expected_revision?: number; scheduled_moscow?: string;
      } | null;
      if (!body || !['schedule','reschedule','cancel'].includes(body.action || '')) return error('Некорректное действие с планом.',400);
      const schedule = body.action === 'schedule';
      if ((schedule && (!body.article_id || !validArticleId(body.article_id) || !Number.isInteger(body.draft_revision) || body.draft_revision! < 1)) ||
        (!schedule && (!body.publication_id || !validArticleId(body.publication_id) || !Number.isInteger(body.expected_revision) || body.expected_revision! < 1))) return error('Обновите очередь перед изменением плана.',400);
      const scheduled = body.action === 'cancel' ? null : moscowSchedule(body.scheduled_moscow);
      return json(await rpc('editorial_publication_plan',{
        p_action: body.action, p_article_id: body.article_id || null, p_publication_id: body.publication_id || null,
        p_draft_revision: body.draft_revision || null, p_expected_revision: body.expected_revision || null,
        p_scheduled_at: scheduled, p_actor_id: ctx.user!.userId, p_actor_email: ctx.user!.email,
      }));
    }),
  ],

  'GET /api/articles/:id/draft': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ({ params }) => {
      if (!validArticleId(params.id)) return error('Некорректный идентификатор новости.', 400);
      const context = await rpc('editorial_draft_context', {p_article_id: params.id});
      if (!context) return error('Новость не найдена.', 404);
      const {source_text, ...visible} = context;
      return json({...visible, event_only: isEventContext(context), source_length: cleanEditorialText(source_text, {url: context.article.url}).length});
    }),
  ],
  'POST /api/articles/:id/draft/generate': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ctx => {
      if (!validArticleId(ctx.params.id)) return error('Некорректный идентификатор новости.', 400);
      const request = ctx.body as DraftRequest | null;
      if (!validDraftRequest(request)) return error('Обновите карточку перед подготовкой черновика.', 400);
      const context = await rpc('editorial_draft_context', {p_article_id: ctx.params.id});
      if (!context) return error('Новость не найдена.', 404);
      if (request!.batch === true) {
        if (request!.expected_revision !== 0) return error('Пакет не заменяет существующие черновики.', 400);
        if (context.draft || !await rpc('editorial_draft_batch_candidate', {p_article_id: ctx.params.id})) {
          return json({skipped:true,reason:'Уже есть черновик или материал больше не находится на проверке'});
        }
      }
      if (['published','archived'].includes(context.article.status)) throw new Error('LOCKED');
      if ((context.draft?.revision || 0) !== request!.expected_revision ||
          context.source_fingerprint !== request!.source_fingerprint || context.article.updated_at !== request!.article_updated_at) throw new Error('CONFLICT');
      if (context.draft && request!.confirm_replace !== true) return error('Подтвердите замену существующего черновика.', 409);
      const cleaned = cleanEditorialText(context.source_text, {title: context.article.title, url: context.article.url});
      if (cleaned.length < 100) return error('Для черновика недостаточно содержательного текста. Загрузите оригинал в карточке и повторите.', 422);
      const sourceText = cleaned.slice(0, 20000);
      let parsed: unknown;
      let generationMode = 'ai';
      if(request!.batch === true && request!.prefer_source_excerpt === true) {
        parsed = buildSourceDraft(context.article,sourceText,isEventContext(context));
        generationMode = 'source_excerpt';
      } else {
      let result;
      try {
        result = await ai.generate({
          system: DRAFT_SYSTEM,
          prompt: JSON.stringify({
            today_moscow: new Date().toLocaleDateString('ru-RU', {timeZone:'Europe/Moscow',year:'numeric',month:'long',day:'numeric'}),
            article: context.article,
            event_only: isEventContext(context),
            source_incomplete: !context.has_full_text || cleaned.length > sourceText.length || /только фрагмент|полная версия.*подписчик/i.test(cleaned),
            source_text: sourceText,
          }),
          schema: draftSchema,
          temperature: 0.2,
          thinkingMode: 'FAST',
          maxTokens: 2200,
          cache: true,
        });
      } catch (cause) {
        if ((cause as {statusCode?:number})?.statusCode === 429) {
          parsed = buildSourceDraft(context.article,sourceText,isEventContext(context));
          generationMode = 'source_excerpt';
        } else throw new Error('AI_UNAVAILABLE');
      }
      if (result) {try { parsed = JSON.parse(result.text); } catch { throw new Error('AI_INVALID_OUTPUT'); }}
      }
      const content = validateGeneratedDraft(parsed, sourceText, isEventContext(context));
      if (!context.has_full_text) content.verification_notes = ('Доступен анонс или фрагмент: сверьте полный оригинал перед одобрением. ' + content.verification_notes).slice(0,3000);
      if (cleaned.length > sourceText.length) content.verification_notes = ('Источник сокращён для подготовки черновика. ' + content.verification_notes).slice(0,3000);
      if (request!.batch === true && !await rpc('editorial_draft_batch_candidate', {p_article_id: ctx.params.id})) {
        return json({skipped:true,reason:'За время подготовки материал изменился или уже получил черновик'});
      }
      const saved = await writeDraft(ctx, request!, 'generate', content);
      return json({...saved,generation_mode:generationMode,reason:generationMode === 'source_excerpt' ? 'Резервный черновик по источнику (без AI); требуется редактура' : 'Черновик сохранён'});
    }),
  ],
  'PUT /api/articles/:id/draft': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ctx => {
      if (!validArticleId(ctx.params.id)) return error('Некорректный идентификатор новости.', 400);
      const request = ctx.body as DraftRequest | null;
      if (!validDraftRequest(request)) return error('Некорректная версия черновика.', 400);
      const context = await rpc('editorial_draft_context', {p_article_id: ctx.params.id});
      if (!context) return error('Новость не найдена.', 404);
      const content = validateGeneratedDraft(request!.content, context.source_text, isEventContext(context));
      return json(await writeDraft(ctx, request!, 'save', content));
    }),
  ],
  'POST /api/articles/:id/draft/approve': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ctx => {
      if (!validArticleId(ctx.params.id)) return error('Некорректный идентификатор новости.', 400);
      const request = ctx.body as DraftRequest | null;
      if (!validDraftRequest(request)) return error('Некорректная версия черновика.', 400);
      if (request!.verified !== true) throw new Error('FACT_CHECK_REQUIRED');
      return json(await writeDraft(ctx, request!, 'approve', null));
    }),
  ],

  'GET /api/articles/:id/content': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ({ params }) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
        return error('Некорректный идентификатор новости.', 400);
      }
      const stored = await rpc('editorial_console_content', { p_article_id: params.id }) as {
        url: string;
        content: (SourceContent & { fetched_at: string }) | null;
      } | null;
      if (!stored) return error('Новость не найдена.', 404);
      if (stored.content && stored.content.source_url === stored.url.split(/[?#]/)[0]) {
        return json({ ...stored.content, full_text: cleanEditorialText(stored.content.full_text, {url: stored.url}), excerpt: cleanEditorialText(stored.content.full_text, {url: stored.url}).slice(0, 600) });
      }
      const content = await fetchSourceContent(stored.url);
      const saved = await rpc('editorial_console_save_content', {
        p_article_id: params.id, p_content: content,
      });
      const text = cleanEditorialText(saved.full_text, {url: stored.url});
      return json({ ...saved, full_text: text, excerpt: text.slice(0,600) });
    }),
  ],
  'GET /api/session': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ctx => {
      const names = await secrets.listSecretNames();
      return json({
        email: ctx.user!.email,
        configured: names.includes('SUPABASE_SERVICE_ROLE_KEY'),
      });
    }),
  ],
  'GET /api/editorial': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ({ query }) => {
      const filter = query.filter || 'all';
      const stream = query.stream || 'all';
      const page = Number(query.page || '1');
      if (
        ![
          'all',
          'candidate',
          'needs_review',
          'out_of_scope',
          'approved',
          'rejected',
          'duplicates',
        ].includes(filter) ||
        !['all', 'tver', 'national'].includes(stream) ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 100000
      )
        return error('Некорректный фильтр или страница.', 400);
      const range = dateRange(query.date_from || '', query.date_to || '');
      const snapshot = await rpc('editorial_console_snapshot_by_date', {
          p_filter: (stream === 'national' ? 'rf:' : stream === 'tver' ? 'tver:' : '') + filter,
          p_search: (query.search || '').slice(0, 200),
          p_page: page,
          p_date_from: range.from,
          p_date_to: range.to,
        });
      return json({ ...snapshot, items: snapshot.items.map((item: any) => {
        const text = cleanEditorialText(item.body || item.summary, {title: item.title, url: item.url});
        return { ...item, body: text || null, summary: text ? text.slice(0,600) : null };
      }) });
    }),
  ],
  'POST /api/articles/:id/duplicates': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ctx => {
      const body = ctx.body as { action?: string; note?: string; updated_at?: string } | null;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.params.id) ||
        !body || !['primary', 'distinct'].includes(body.action || '') ||
        typeof body.updated_at !== 'string' || Number.isNaN(Date.parse(body.updated_at)) ||
        typeof body.note !== 'string' || body.note.trim().length < 20 || body.note.length > 2000) {
        return error('Укажите решение по совпадениям и пояснение от 20 до 2000 знаков.', 400);
      }
      return json(await rpc('editorial_console_resolve_duplicate', {
        p_article_id: ctx.params.id,
        p_action: body.action,
        p_actor_id: ctx.user!.userId,
        p_actor_email: ctx.user!.email,
        p_expected_updated_at: body.updated_at,
        p_note: body.note.trim(),
      }));
    }),
  ],
  'POST /api/articles/:id/decision': [
    requireAuth(),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    safe(async ctx => {
      const body = ctx.body as {
        action?: string;
        note?: string;
        updated_at?: string;
      } | null;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          ctx.params.id
        ) ||
        !body ||
        !['approve', 'reject', 'request_review'].includes(body.action || '') ||
        typeof body.updated_at !== 'string' ||
        Number.isNaN(Date.parse(body.updated_at)) ||
        (body.note !== undefined &&
          (typeof body.note !== 'string' || body.note.length > 2000))
      ) {
        return error('Некорректное решение редактора.', 400);
      }
      return json(
        await rpc('editorial_console_decide', {
          p_article_id: ctx.params.id,
          p_action: body.action,
          p_actor_id: ctx.user!.userId,
          p_actor_email: ctx.user!.email,
          p_expected_updated_at: body.updated_at,
          p_note: body.note || '',
        })
      );
    }),
  ],
});
