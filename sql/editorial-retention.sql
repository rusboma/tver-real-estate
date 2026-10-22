-- Retention hides stale unplanned news; source texts and editorial history are retained.
alter table public.articles add column if not exists archived_at timestamptz;
alter table public.articles add column if not exists archive_reason text;
create or replace function public.editorial_article_in_publication(p_article_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from articles where id=p_article_id and status='published') or exists(
 select 1 from publications p where p.article_id=p_article_id and
 (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null or p.published_at is not null));
$$;
create or replace function public.editorial_archive_stale()
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare count_archived integer;
begin
 perform pg_advisory_xact_lock(690012026);
 update articles a set status='archived',archived_at=clock_timestamp(),
 archive_reason='Старше 7 дней; материал не стоит в плане и не опубликован'
 where a.status not in ('archived','published') and coalesce(a.published_at,a.discovered_at)<now()-interval '7 days'
 and not editorial_article_in_publication(a.id);
 get diagnostics count_archived=row_count;
 return jsonb_build_object('archived',count_archived,'retention_days',7);
end $$;
CREATE OR REPLACE FUNCTION public.editorial_console_snapshot_by_date(p_filter text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1, p_date_from date DEFAULT null, p_date_to date DEFAULT null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result jsonb; stream_filter text:='all'; queue_filter text:=p_filter;
begin
 if p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then raise exception 'INVALID_DATE_RANGE'; end if;
 if p_filter like 'rf:%' then stream_filter:='national';queue_filter:=substring(p_filter from 4);
 elsif p_filter like 'tver:%' then stream_filter:='tver';queue_filter:=substring(p_filter from 6); end if;
 if queue_filter not in ('all','candidate','needs_review','out_of_scope','approved','rejected','duplicates') then raise exception 'Invalid filter'; end if;
 if p_page < 1 or p_page > 100000 then raise exception 'Invalid page'; end if;
 with enriched as (
 select a.id,a.title,a.url,a.summary,a.body,a.status,a.published_at,a.discovered_at,a.updated_at,
 coalesce(s.editorial_stream,'tver') as stream_key,a.event_date,
 s.name as source_name,r.relevance_score,r.decision,r.reasons,
 public.editorial_console_duplicates(a.id) as duplicates,
 case when a.status='approved' then 'approved' when a.status='rejected' then 'rejected'
 when exists(select 1 from public.article_duplicate_links d where not d.dismissed and (d.article_id=a.id or d.other_id=a.id) and (d.primary_id is null or d.primary_id<>a.id)) then 'duplicates'
 when a.status='review' then 'needs_review' else coalesce(r.decision,'needs_review') end as queue
 from public.articles a left join public.sources s on s.id=a.source_id
 left join public.article_reviews r on r.article_id=a.id
 where (stream_filter='all' or coalesce(s.editorial_stream,'tver')=stream_filter)
 and a.status<>'archived'
 and (coalesce(a.published_at,a.discovered_at)>=now()-interval '7 days' or public.editorial_article_in_publication(a.id))
 and (p_date_from is null or coalesce(a.published_at,a.discovered_at)>=(p_date_from::timestamp at time zone 'Europe/Moscow'))
 and (p_date_to is null or coalesce(a.published_at,a.discovered_at)<((p_date_to+1)::timestamp at time zone 'Europe/Moscow'))
 ), filtered as (
 select * from enriched where (queue_filter='all' or queue=queue_filter)
 and (p_search='' or title ilike '%'||left(p_search,200)||'%')
 ), page_rows as (
 select * from filtered order by discovered_at desc,id limit 20 offset (p_page-1)*20
 )
 select jsonb_build_object(
 'items',coalesce((select jsonb_agg(x) from page_rows x),'[]'::jsonb),
 'total',(select count(*) from filtered),
 'stats',jsonb_build_object('total',(select count(*) from enriched),
 'candidate',(select count(*) from enriched where queue='candidate'),
 'needs_review',(select count(*) from enriched where queue='needs_review'),
 'out_of_scope',(select count(*) from enriched where queue='out_of_scope'),
 'duplicates',(select count(*) from enriched where queue='duplicates'),
 'approved',(select count(*) from enriched where queue='approved'),
 'rejected',(select count(*) from enriched where queue='rejected')),
 'history',coalesce((select jsonb_agg(x) from (
 select ea.id,ea.action,ea.note,ea.created_at,a.title,ea.article_id
 from public.editorial_actions ea join public.articles a on a.id=ea.article_id
 order by ea.created_at desc,ea.id limit 100
 )x),'[]'::jsonb)
 ) into result;
 return result;
end $function$
;
create or replace function public.editorial_console_snapshot(p_filter text default 'all',p_search text default '',p_page integer default 1)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select editorial_console_snapshot_by_date(p_filter,p_search,p_page,null,null);
$$;
revoke all on function public.editorial_article_in_publication(uuid),public.editorial_archive_stale(),public.editorial_console_snapshot_by_date(text,text,integer,date,date) from public,anon,authenticated;
grant execute on function public.editorial_article_in_publication(uuid),public.editorial_archive_stale(),public.editorial_console_snapshot_by_date(text,text,integer,date,date) to service_role;
