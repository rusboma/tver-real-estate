-- Manual publication only. No cron, token, public grants or automatic sends.
create table public.telegram_deliveries (
 id uuid primary key default gen_random_uuid(),
 article_id uuid not null references public.articles(id),
 publication_id uuid references public.publications(id),
 draft_revision integer not null,
 kind text not null check(kind in ('test','production')),
 state text not null check(state in ('sending','sent','failed','unknown')),
 bot_id bigint not null, production_chat_id text not null, target_chat_id text not null,
 payload jsonb not null, preview_key text not null,
 created_reservation boolean not null default false,
 telegram_message_id bigint, error_code text, retry_after timestamptz,
 actor_id uuid not null, created_at timestamptz not null default now(), finished_at timestamptz,
 check((state='sent')=(telegram_message_id is not null))
);
create unique index telegram_delivery_production_once on public.telegram_deliveries(article_id)
 where kind='production' and state in ('sending','unknown','sent');
create unique index telegram_delivery_test_inflight on public.telegram_deliveries(article_id)
 where kind='test' and state in ('sending','unknown');
create index telegram_delivery_recent on public.telegram_deliveries(created_at desc);
create index telegram_delivery_publication on public.telegram_deliveries(publication_id);
create index telegram_delivery_test_receipt on public.telegram_deliveries(bot_id,production_chat_id) where kind='test' and state='sent';
alter table public.telegram_deliveries enable row level security;
revoke all on public.telegram_deliveries from public,anon,authenticated;
grant select,insert,update on public.telegram_deliveries to service_role;
alter table public.editorial_actions drop constraint editorial_actions_action_check;
alter table public.editorial_actions add constraint editorial_actions_action_check check(action in
 ('approve','reject','request_review','mark_verified','mark_disputed','dedup_primary','dedup_distinct','draft_generate','draft_save','draft_approve','plan_add','plan_reschedule','plan_cancel','telegram_test','telegram_send','telegram_failure'));

create function public.editorial_telegram_preview(p_article_id uuid,p_kind text,p_bot_id bigint,p_production_chat_id text,p_target_chat_id text,p_with_photo boolean)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a articles%rowtype; d editorial_drafts%rowtype; p publications%rowtype; result jsonb; last_attempt uuid;
begin
 if p_kind is null or p_kind not in ('test','production') or p_bot_id is null or p_production_chat_id is null or p_target_chat_id is null
 or p_with_photo is null or (p_kind='production' and p_target_chat_id<>p_production_chat_id)
 or (p_kind='test' and p_target_chat_id=p_production_chat_id) then raise exception 'TELEGRAM_INVALID_TARGET'; end if;
 select * into a from articles where id=p_article_id;
 if not found then raise exception 'Article not found'; end if;
 select * into d from editorial_drafts where article_id=a.id;
 if d.status is distinct from 'approved' or a.status<>'approved' then raise exception 'DRAFT_APPROVAL_REQUIRED'; end if;
 if d.source_fingerprint is distinct from (editorial_draft_context(a.id)->>'source_fingerprint') then raise exception 'Conflict: source changed'; end if;
 if d.content_kind='event_announcement' and a.event_date is not null and a.event_date<(clock_timestamp() at time zone 'Europe/Moscow')::date then raise exception 'EVENT_DATE_PASSED'; end if;
 if exists(select 1 from telegram_deliveries where article_id=a.id and kind=p_kind and state in ('sending','unknown','sent') and (p_kind='production' or state<>'sent')) then raise exception 'TELEGRAM_DELIVERY_LOCKED'; end if;
 if exists(select 1 from telegram_deliveries where article_id=a.id and kind=p_kind and retry_after>clock_timestamp()) then raise exception 'TELEGRAM_RETRY_LATER'; end if;
 select * into p from publications where article_id=a.id and status='approved' order by created_at limit 1;
 if p.id is not null and (p.draft_revision is distinct from d.revision or p.telegram_message_id is not null or p.published_at is not null) then raise exception 'Conflict: publication changed'; end if;
 perform news_assert_unique(a.id,p.id);
 select id into last_attempt from telegram_deliveries where article_id=a.id and kind=p_kind order by created_at desc,id desc limit 1;
 result:=jsonb_build_object('article_id',a.id,'title',d.title,'lead',d.lead,'body',d.body,'source_url',a.url,
 'image_url',case when p_with_photo then (select image_url from article_content_snapshots where article_id=a.id) end,
 'draft_revision',d.revision,'source_fingerprint',d.source_fingerprint,'publication_id',p.id,'plan_revision',p.plan_revision,
 'kind',p_kind,'bot_id',p_bot_id,'production_chat_id',p_production_chat_id,'target_chat_id',p_target_chat_id,'with_photo',p_with_photo,'last_attempt',last_attempt);
 return result||jsonb_build_object('preview_key',md5(result::text));
end $$;

create function public.editorial_telegram_claim(p_article_id uuid,p_kind text,p_bot_id bigint,p_production_chat_id text,p_target_chat_id text,p_with_photo boolean,
 p_preview_key text,p_payload jsonb,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare preview jsonb; reservation jsonb; publication_id uuid; attempt telegram_deliveries%rowtype; created_reservation boolean:=false;
begin
 perform pg_advisory_xact_lock(690012026);
 if p_actor_id is null or p_actor_email is distinct from 'rusboma@gmail.com' then raise exception 'Forbidden'; end if;
 perform 1 from articles where id=p_article_id for update;
 perform 1 from editorial_drafts where article_id=p_article_id for update;
 preview:=editorial_telegram_preview(p_article_id,p_kind,p_bot_id,p_production_chat_id,p_target_chat_id,p_with_photo);
 if p_preview_key is null or p_preview_key is distinct from preview->>'preview_key' then raise exception 'Conflict: preview changed'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or nullif(p_payload->>'html','') is null or nullif(p_payload->>'plain','') is null
 or p_payload->>'method' is distinct from (case when p_with_photo then 'sendPhoto' else 'sendMessage' end)
 or length(p_payload->>'plain')>(case when p_with_photo then 1024 else 4096 end) then raise exception 'TELEGRAM_INVALID_CONTENT'; end if;
 if p_kind='production' then
  if not exists(select 1 from telegram_deliveries where kind='test' and state='sent' and bot_id=p_bot_id and production_chat_id=p_production_chat_id) then raise exception 'TELEGRAM_TEST_REQUIRED'; end if;
  publication_id:=(preview->>'publication_id')::uuid;
  if publication_id is null then
   reservation:=news_reserve_publication(p_article_id,preview->>'title',(preview->>'lead')||E'\n\n'||(preview->>'body')||E'\n\nИсточник: '||(preview->>'source_url'));
   publication_id:=(reservation->>'id')::uuid;created_reservation:=true;
   update publications set draft_revision=(preview->>'draft_revision')::integer,planned_by=p_actor_id where id=publication_id;
  end if;
 end if;
 insert into telegram_deliveries(article_id,publication_id,draft_revision,kind,state,bot_id,production_chat_id,target_chat_id,payload,preview_key,created_reservation,actor_id)
 values(p_article_id,publication_id,(preview->>'draft_revision')::integer,p_kind,'sending',p_bot_id,p_production_chat_id,p_target_chat_id,p_payload,p_preview_key,created_reservation,p_actor_id) returning * into attempt;
 insert into editorial_actions(article_id,action,actor_id,note) values(p_article_id,case when p_kind='test' then 'telegram_test' else 'telegram_send' end,p_actor_id,p_actor_email||' · Начата ручная отправка · Попытка '||attempt.id||' · Канал '||p_target_chat_id);
 return to_jsonb(attempt);
end $$;

create function public.editorial_telegram_finish(p_attempt_id uuid,p_state text,p_message_id bigint,p_error_code text,p_retry_after integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare attempt telegram_deliveries%rowtype;
begin
 perform pg_advisory_xact_lock(690012026);
 select * into attempt from telegram_deliveries where id=p_attempt_id for update;
 if not found then raise exception 'Attempt not found'; end if;
 if attempt.state='sent' and p_state='sent' and attempt.telegram_message_id=p_message_id then return jsonb_build_object('ok',true); end if;
 if attempt.state not in ('sending','unknown') then raise exception 'Conflict: delivery completed'; end if;
 if p_state is null or p_state not in ('sent','failed','unknown') or (p_state='sent' and (p_message_id is null or p_message_id<=0))
 or (p_state<>'sent' and p_message_id is not null) then raise exception 'Invalid delivery result'; end if;
 -- An ambiguous send can only be resolved to sent, never blindly unlocked for another send.
 if attempt.state='unknown' and p_state='failed' then raise exception 'TELEGRAM_DELIVERY_LOCKED'; end if;
 update telegram_deliveries set state=p_state,telegram_message_id=p_message_id,error_code=left(p_error_code,100),
 retry_after=case when p_state='failed' and p_retry_after>0 then clock_timestamp()+make_interval(secs=>least(p_retry_after,604800)) end,
 finished_at=clock_timestamp() where id=attempt.id;
 if attempt.kind='production' then
  if p_state='sent' then
   update publications set status='published',telegram_message_id=p_message_id,published_at=clock_timestamp(),scheduled_at=null where id=attempt.publication_id;
   update articles set status='published' where id=attempt.article_id;
  elsif p_state='failed' and attempt.created_reservation then
   update publications set status='rejected' where id=attempt.publication_id;
  end if;
 end if;
 insert into editorial_actions(article_id,action,actor_id,note) values(attempt.article_id,
 case when p_state='sent' then case when attempt.kind='test' then 'telegram_test' else 'telegram_send' end else 'telegram_failure' end,
 attempt.actor_id,'Попытка '||attempt.id||' · '||p_state||coalesce(' · message_id='||p_message_id,'')||coalesce(' · '||left(p_error_code,100),''));
 return jsonb_build_object('ok',true,'state',p_state);
end $$;

create function public.editorial_telegram_history()
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
 select t.id,t.article_id,t.kind,t.state,t.target_chat_id,t.created_at,t.finished_at,t.telegram_message_id,t.error_code,t.retry_after,
 t.bot_id,t.production_chat_id,t.draft_revision,a.title
 from telegram_deliveries t join articles a on a.id=t.article_id order by t.created_at desc,t.id desc limit 100
 )x;
$$;

-- Preserve a reservation even if Telegram timed out and may have accepted the post.
create function public.editorial_telegram_publication_lock()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if exists(select 1 from telegram_deliveries where publication_id=old.id and state in ('sending','unknown'))
 and (new.status is distinct from old.status or new.scheduled_at is distinct from old.scheduled_at or new.body is distinct from old.body or new.title is distinct from old.title or new.article_id is distinct from old.article_id) then raise exception 'TELEGRAM_DELIVERY_LOCKED'; end if;
 return new;
end $$;
create trigger editorial_telegram_publication_lock before update on public.publications for each row execute function public.editorial_telegram_publication_lock();
create function public.editorial_telegram_article_lock()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.status is distinct from old.status and exists(select 1 from telegram_deliveries where article_id=old.id and kind='production' and state in ('sending','unknown')) then raise exception 'TELEGRAM_DELIVERY_LOCKED'; end if;
 return new;
end $$;
create trigger editorial_telegram_article_lock before update of status on public.articles for each row execute function public.editorial_telegram_article_lock();

revoke all on function public.editorial_telegram_preview(uuid,text,bigint,text,text,boolean),public.editorial_telegram_claim(uuid,text,bigint,text,text,boolean,text,jsonb,uuid,text),public.editorial_telegram_finish(uuid,text,bigint,text,integer),public.editorial_telegram_history(),public.editorial_telegram_publication_lock(),public.editorial_telegram_article_lock() from public,anon,authenticated;
grant execute on function public.editorial_telegram_preview(uuid,text,bigint,text,text,boolean),public.editorial_telegram_claim(uuid,text,bigint,text,text,boolean,text,jsonb,uuid,text),public.editorial_telegram_finish(uuid,text,bigint,text,integer),public.editorial_telegram_history(),public.editorial_telegram_publication_lock(),public.editorial_telegram_article_lock() to service_role;
