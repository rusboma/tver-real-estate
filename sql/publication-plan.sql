-- Planning reserves approved content but never sends it to Telegram.
alter table public.publications add column if not exists draft_revision integer;
alter table public.publications add column if not exists plan_revision integer not null default 1;
alter table public.publications add column if not exists planned_by uuid;
alter table public.publications add column if not exists cancelled_at timestamptz;
create index if not exists publications_editorial_plan_idx on public.publications(scheduled_at,id)
 where draft_revision is not null and status='approved';
alter table public.editorial_actions drop constraint if exists editorial_actions_action_check;
alter table public.editorial_actions add constraint editorial_actions_action_check check(action in
 ('approve','reject','request_review','mark_verified','mark_disputed','dedup_primary','dedup_distinct','draft_generate','draft_save','draft_approve','plan_add','plan_reschedule','plan_cancel'));

create or replace function public.editorial_publication_queue()
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 with ready as (
 select a.id as article_id,d.title,d.lead,d.body,d.revision as draft_revision,a.url as source_url,s.name as source_name,
 a.event_date,d.updated_at
 from editorial_drafts d join articles a on a.id=d.article_id left join sources s on s.id=a.source_id
 where d.status='approved' and a.status='approved'
 and d.source_fingerprint=editorial_draft_context(a.id)->>'source_fingerprint'
 and not exists(select 1 from publications p where p.article_id=a.id and
  (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null))
 ), planned as (
 select p.id,p.article_id,p.title,p.body,p.scheduled_at,p.plan_revision,p.draft_revision,p.status,p.cancelled_at,
 a.url as source_url,s.name as source_name,a.event_date,
 (d.status is distinct from 'approved' or a.status is distinct from 'approved' or d.revision is distinct from p.draft_revision
 or d.source_fingerprint is distinct from (editorial_draft_context(a.id)->>'source_fingerprint')) as requires_review
 from publications p join articles a on a.id=p.article_id left join sources s on s.id=a.source_id
 left join editorial_drafts d on d.article_id=a.id where p.draft_revision is not null
 )
 select jsonb_build_object('ready',coalesce((select jsonb_agg(x) from (select * from ready order by updated_at desc,article_id limit 500)x),'[]'::jsonb),
 'planned',coalesce((select jsonb_agg(x) from (select * from planned where status='approved' and scheduled_at is not null order by scheduled_at,id limit 500)x),'[]'::jsonb),
 'cancelled',coalesce((select jsonb_agg(x) from (select * from planned where cancelled_at is not null order by cancelled_at desc,id limit 100)x),'[]'::jsonb),
 'stats',jsonb_build_object('ready',(select count(*) from ready),'planned',(select count(*) from planned where status='approved' and scheduled_at is not null),
 'overdue',(select count(*) from planned where status='approved' and scheduled_at<=now()),'cancelled',(select count(*) from planned where cancelled_at is not null)),
 'timezone','Europe/Moscow','publishing_enabled',false);
$$;

create or replace function public.editorial_publication_plan(p_action text,p_article_id uuid,p_publication_id uuid,
 p_draft_revision integer,p_expected_revision integer,p_scheduled_at timestamptz,p_actor_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a articles%rowtype; d editorial_drafts%rowtype; p publications%rowtype; reservation jsonb; action_name text;
begin
 perform pg_advisory_xact_lock(690012026);
 if p_actor_email is distinct from 'rusboma@gmail.com' or p_actor_id is null then raise exception 'Forbidden'; end if;
 if p_action is null or p_action not in ('schedule','reschedule','cancel') then raise exception 'Invalid action'; end if;
 if p_action<>'cancel' and (p_scheduled_at is null or p_scheduled_at<clock_timestamp()+interval '1 minute' or p_scheduled_at>now()+interval '365 days') then raise exception 'INVALID_PLAN_TIME'; end if;
 if p_action='schedule' then
  select * into a from articles where id=p_article_id for update;
  if not found then raise exception 'Article not found'; end if;
 else
  select * into p from publications where id=p_publication_id for update;
  if not found or p.draft_revision is null then raise exception 'Publication not found'; end if;
  if p_expected_revision is null or p.plan_revision<>p_expected_revision then raise exception 'Conflict: plan changed'; end if;
  if p.status<>'approved' or p.telegram_message_id is not null or p.published_at is not null or p.scheduled_at is null then raise exception 'Publication is locked'; end if;
  select * into a from articles where id=p.article_id for update;
 end if;
 if p_action='cancel' then
  update publications set status='rejected',scheduled_at=null,cancelled_at=clock_timestamp(),plan_revision=plan_revision+1 where id=p.id returning * into p;
  action_name:='plan_cancel';
 else
  select * into d from editorial_drafts where article_id=a.id for update;
  if not found or d.status<>'approved' or a.status<>'approved' then raise exception 'DRAFT_APPROVAL_REQUIRED'; end if;
  if p_action='schedule' and (p_draft_revision is null or d.revision<>p_draft_revision) then raise exception 'Conflict: draft changed'; end if;
  if p_action='reschedule' and d.revision<>p.draft_revision then raise exception 'Conflict: reserved draft changed'; end if;
  if d.source_fingerprint is distinct from (editorial_draft_context(a.id)->>'source_fingerprint') then raise exception 'Conflict: source changed'; end if;
  if d.content_kind='event_announcement' and a.event_date is not null and (p_scheduled_at at time zone 'Europe/Moscow')::date>a.event_date then raise exception 'EVENT_DATE_PASSED'; end if;
  if p_action='schedule' then
   perform news_assert_unique(a.id);
   reservation:=news_reserve_publication(a.id,d.title,d.lead||E'\n\n'||d.body||E'\n\nИсточник: '||a.url);
   update publications set scheduled_at=p_scheduled_at,draft_revision=d.revision,planned_by=p_actor_id where id=(reservation->>'id')::uuid returning * into p;
   action_name:='plan_add';
  else
   perform news_assert_unique(a.id,p.id);
   update publications set scheduled_at=p_scheduled_at,plan_revision=plan_revision+1,planned_by=p_actor_id where id=p.id returning * into p;
   action_name:='plan_reschedule';
  end if;
 end if;
 insert into editorial_actions(article_id,action,actor_id,note) values(a.id,action_name,p_actor_id,p_actor_email||' · План #'||p.id||' · Версия черновика '||p.draft_revision||
 case when p_action='cancel' then ' · Снят с плана' else ' · '||to_char(p.scheduled_at at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI')||' МСК · Отправка отключена' end);
 return jsonb_build_object('ok',true,'publication_id',p.id,'plan_revision',p.plan_revision,'publishing_enabled',false);
end $$;
revoke all on function public.editorial_publication_queue() from public,anon,authenticated;
revoke all on function public.editorial_publication_plan(text,uuid,uuid,integer,integer,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.editorial_publication_queue() to service_role;
grant execute on function public.editorial_publication_plan(text,uuid,uuid,integer,integer,timestamptz,uuid,text) to service_role;

-- A reserved material cannot change editorial status until removed from the plan.
create or replace function public.editorial_plan_article_lock()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.status is distinct from old.status and new.status<>'published' and exists(select 1 from publications p where p.article_id=new.id and p.status='approved' and p.scheduled_at is not null) then raise exception 'Article is locked: cancel its publication plan first'; end if;
 return new;
end $$;
drop trigger if exists editorial_plan_article_lock on public.articles;
create trigger editorial_plan_article_lock before update of status on public.articles for each row execute function public.editorial_plan_article_lock();
revoke all on function public.editorial_plan_article_lock() from public,anon,authenticated;
grant execute on function public.editorial_plan_article_lock() to service_role;
