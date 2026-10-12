alter table public.sources add column if not exists editorial_stream text not null default 'tver' check(editorial_stream in ('tver','national'));
alter table public.articles add column if not exists event_date date;
CREATE OR REPLACE FUNCTION public.editorial_console_snapshot(p_filter text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result jsonb; stream_filter text:='all'; queue_filter text:=p_filter;
begin
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
 where stream_filter='all' or coalesce(s.editorial_stream,'tver')=stream_filter
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
CREATE OR REPLACE FUNCTION public.triage_article_on_ingest()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 t text := coalesce(new.title,'') || ' ' || coalesce(new.summary,'');
 housing boolean;
 land boolean;
 unrelated boolean;
 local_match boolean;
 score integer;
 verdict text;
 why jsonb;
begin
 housing := t ~* '(водоснабжен|теплоснабжен|отопительн|питьев.{0,15}вод|управляющ.{0,20}организац|квартир|жил(ой|ого|ых|ые|ых домов)|новостро|ипотек|недвижим|застройщик|многоквартир|управляющ.{0,12}компан|жкх|коммунальн|расселен|аренд.{0,20}(жиль|квартир))';
 land := t ~* '(земельн.{0,20}участ|земл.{0,15}(под строительств|ижс))';
 unrelated := t ~* '(колледж|школ|больниц|поликлиник|стадион|спортзал)';
 local_match := t ~* '(^|[^а-яёa-z])(твер|верхневолж|калининск|торжок|конаков|ржев|кимр|бежецк|кашин|осташков|лихослав|торопец|болого|удомл|нелидов|андреапол|зубцов|стариц|весьегон|калязин|максатих|рамешк|спиров|молоков|сонков|сандов|пенов|селижар|фиров|жарков|вышн.{0,10}волоч)';
 score := case when housing then 70 when land then 45 else 15 end + case when local_match then 15 else 0 end - case when unrelated then 55 else 0 end;
 score := greatest(0,least(100,score));
 verdict := case when exists(select 1 from public.sources s where s.id=new.source_id and (s.editorial_stream='national' or s.source_type='telegram' or s.url in ('https://illidium.com/','https://dsktver.com/','https://www.tvervodokanal.ru/','https://www.oes-tver.ru/','https://uk-zvezda.ru/','https://tsjtver.kvado.ru/','https://www.tver.ru/','https://vedtver.ru/','https://kimvestnik.ru/','https://bzgazeta.ru/','https://seliger-news.ru/','https://gazeta-konakovo.ru/','https://www.kashin.info/','https://v-volok.ru/','https://lihoslavl69.ru/','https://toropecadm.ru/','https://xn----8sbgnuc0acykh9d.xn--p1ai/','https://presska.ru/','https://max.ru/id6901093516_gos'))) then 'needs_review' when exists(select 1 from public.sources s where s.id=new.source_id and s.url='https://epp.genproc.gov.ru/ru/proc_69/') then 'needs_review' when housing and not unrelated and local_match then 'candidate' when score < 35 then 'out_of_scope' else 'needs_review' end;
 why := jsonb_build_array(case when housing then 'housing-related headline' when land then 'land-related headline; manual scope check needed' else 'no clear housing relevance' end, case when unrelated then 'institutional topic detected' else 'no institutional exclusion' end,case when local_match then 'Tver region mentioned' else 'locality not established' end);
 if exists(select 1 from sources s where s.id=new.source_id and s.editorial_stream='national') then why:=jsonb_build_array('Федеральная практика ЖКХ: география не ограничена','Требуется редакторская проверка новизны, применимости и коммерческих заявлений'); end if;
 insert into public.article_reviews(article_id,relevance_score,decision,reasons,verification_status,reviewer)
 values(new.id,score,verdict,why,'not_verified','db_triage_v1')
 on conflict(article_id) do update set relevance_score=excluded.relevance_score,decision=excluded.decision,reasons=excluded.reasons,updated_at=now()
 where public.article_reviews.reviewer='db_triage_v1' and public.article_reviews.verification_status='not_verified';
 return new;
end $function$
;

