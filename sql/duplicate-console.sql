CREATE OR REPLACE FUNCTION public.editorial_console_decide(p_article_id uuid, p_action text, p_actor_id uuid, p_actor_email text, p_expected_updated_at timestamp with time zone, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare current_article public.articles%rowtype; next_status public.content_status; next_decision text;
begin
 perform pg_advisory_xact_lock(690012026);
 if p_actor_email <> 'rusboma@gmail.com' or p_actor_email is null or p_actor_id is null then raise exception 'Forbidden'; end if;
 if p_action not in ('approve','reject','request_review') then raise exception 'Invalid action'; end if;
 select * into current_article from public.articles where id=p_article_id for update;
 if not found then raise exception 'Article not found'; end if;
 if current_article.status in ('published','archived') then raise exception 'Article is locked'; end if;
 if p_expected_updated_at is null or current_article.updated_at is distinct from p_expected_updated_at then raise exception 'Conflict: refresh article'; end if;
 next_status := case p_action when 'approve' then 'approved'::public.content_status when 'reject' then 'rejected'::public.content_status else 'review'::public.content_status end;
 next_decision := case p_action when 'approve' then 'candidate' when 'reject' then 'out_of_scope' else 'needs_review' end;
 update public.articles set status=next_status,reviewed_at=now() where id=p_article_id;
 insert into public.article_reviews(article_id,relevance_score,decision,reviewer)
 values(p_article_id,0,next_decision,'editor:'||p_actor_email)
 on conflict(article_id) do update set decision=excluded.decision,reviewer=excluded.reviewer,updated_at=now();
 insert into public.editorial_actions(article_id,action,actor_id,note)
 values(p_article_id,p_action,p_actor_id,p_actor_email||case when btrim(p_note)='' then '' else ' · '||left(btrim(p_note),2000) end);
 return jsonb_build_object('ok',true,'status',next_status);
end $function$
;
CREATE OR REPLACE FUNCTION public.editorial_console_snapshot(p_filter text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result jsonb;
begin
 if p_filter not in ('all','candidate','needs_review','out_of_scope','approved','rejected','duplicates') then raise exception 'Invalid filter'; end if;
 if p_page < 1 or p_page > 100000 then raise exception 'Invalid page'; end if;
 with enriched as (
 select a.id,a.title,a.url,a.summary,a.body,a.status,a.published_at,a.discovered_at,a.updated_at,
 s.name as source_name,r.relevance_score,r.decision,r.reasons,
 public.editorial_console_duplicates(a.id) as duplicates,
 case when a.status='approved' then 'approved' when a.status='rejected' then 'rejected'
 when exists(select 1 from public.article_duplicate_links d where not d.dismissed and (d.article_id=a.id or d.other_id=a.id) and (d.primary_id is null or d.primary_id<>a.id)) then 'duplicates'
 when a.status='review' then 'needs_review' else coalesce(r.decision,'needs_review') end as queue
 from public.articles a left join public.sources s on s.id=a.source_id
 left join public.article_reviews r on r.article_id=a.id
 ), filtered as (
 select * from enriched where (p_filter='all' or queue=p_filter)
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

