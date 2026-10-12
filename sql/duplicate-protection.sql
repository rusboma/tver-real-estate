-- Private duplicate detection and publication reservation; no Telegram sending.
create extension if not exists pg_trgm with schema extensions;

create or replace function public.news_normalize(p_text text)
returns text language sql immutable parallel safe set search_path=public,pg_temp as $$
 select btrim(regexp_replace(replace(lower(coalesce(p_text,'')),'ё','е'),'[^[:alnum:]]+',' ','g'))
$$;
create or replace function public.news_url_key(p_url text)
returns text language sql immutable parallel safe set search_path=public,pg_temp as $$
 with parts as (select split_part(split_part(coalesce(p_url,''),'#',1),'?',1) as base,
 split_part(split_part(coalesce(p_url,''),'#',1),'?',2) as query), cleaned as (
 select regexp_replace(regexp_replace(base,'^https?://www\.','https://'),'/$','') as base,
 (select string_agg(value,'&' order by value) from regexp_split_to_table(query,'&') value
 where value<>'' and lower(value) !~ '^(utm_[^=]*|fbclid|gclid|yclid|_openstat)=') as query from parts)
 select base||case when query is null then '' else '?'||query end from cleaned
$$;
create or replace function public.news_words(p_text text)
returns text[] language sql immutable parallel safe set search_path=public,pg_temp as $$
 select tsvector_to_array(to_tsvector('pg_catalog.russian',left(coalesce(p_text,''),20000)))
$$;
create or replace function public.news_overlap(p_left text[],p_right text[])
returns real language sql immutable parallel safe set search_path=public,pg_temp as $$
 select count(*)::real / greatest(1,least(cardinality(p_left),cardinality(p_right)))
 from (select unnest(p_left) intersect select unnest(p_right)) shared
$$;
alter table public.articles
 add column if not exists duplicate_url_key text generated always as (public.news_url_key(url)) stored,
 add column if not exists duplicate_title_key text generated always as (public.news_normalize(title)) stored,
 add column if not exists duplicate_body_hash text generated always as (
 case when length(public.news_normalize(body))>=350 and body not like 'Источник разместил%'
 then md5(public.news_normalize(body)) else null end) stored,
 add column if not exists duplicate_title_words text[] generated always as (public.news_words(title)) stored,
 add column if not exists duplicate_body_words text[] generated always as (public.news_words(coalesce(body,summary))) stored;
create index if not exists articles_duplicate_url_idx on public.articles(duplicate_url_key);
create index if not exists articles_duplicate_body_idx on public.articles(duplicate_body_hash) where duplicate_body_hash is not null;
create index if not exists articles_duplicate_title_idx on public.articles(duplicate_title_key);
create table if not exists public.article_duplicate_links (
 article_id uuid not null references public.articles(id) on delete cascade,
 other_id uuid not null references public.articles(id) on delete cascade,
 kind text not null check(kind in ('exact_url','exact_text','possible_event')),
 score real not null check(score between 0 and 1),
 primary_id uuid references public.articles(id),
 dismissed boolean not null default false,
 note text not null default '',
 created_at timestamptz not null default now(),
 primary key(article_id,other_id),
 check(article_id<other_id), check(primary_id is null or primary_id in (article_id,other_id))
);
create index if not exists article_duplicate_other_idx on public.article_duplicate_links(other_id);
alter table public.article_duplicate_links enable row level security;
revoke all on public.article_duplicate_links from public,anon,authenticated;
grant select,insert,update,delete on public.article_duplicate_links to service_role;

create or replace function public.news_detect_duplicates(p_article_id uuid)
returns void language plpgsql security invoker set search_path=public,extensions,pg_temp as $$
declare current_article public.articles%rowtype; candidate record; match_kind text; chosen uuid; score_value real;
begin
 perform pg_advisory_xact_lock(690012026);
 select * into current_article from public.articles where id=p_article_id;
 if not found then return; end if;
 for candidate in
 select a.*,extensions.similarity(a.duplicate_title_key,current_article.duplicate_title_key) as title_similarity,
 public.news_overlap(a.duplicate_title_words,current_article.duplicate_title_words) as title_overlap,
 public.news_overlap(a.duplicate_body_words,current_article.duplicate_body_words) as body_overlap
 from public.articles a where a.id<>p_article_id and (
 a.duplicate_url_key=current_article.duplicate_url_key or
 (current_article.duplicate_body_hash is not null and a.duplicate_body_hash=current_article.duplicate_body_hash) or
 coalesce(a.published_at,a.discovered_at) between coalesce(current_article.published_at,current_article.discovered_at)-interval '7 days'
 and coalesce(current_article.published_at,current_article.discovered_at)+interval '7 days')
 loop
  match_kind:=null; chosen:=null;
  if candidate.duplicate_url_key=current_article.duplicate_url_key then match_kind:='exact_url';
  elsif current_article.duplicate_body_hash is not null and candidate.duplicate_body_hash=current_article.duplicate_body_hash then match_kind:='exact_text';
  elsif abs(extract(epoch from (coalesce(candidate.published_at,candidate.discovered_at)-coalesce(current_article.published_at,current_article.discovered_at))))<=604800
   and length(current_article.duplicate_title_key)>=25 and length(candidate.duplicate_title_key)>=25
   and (candidate.duplicate_title_key=current_article.duplicate_title_key
    or (candidate.title_similarity>=0.68 and candidate.body_overlap>=0.35)
    or (candidate.title_overlap>=0.4 and candidate.body_overlap>=0.85
      and cardinality(current_article.duplicate_body_words)>=12 and cardinality(candidate.duplicate_body_words)>=12
      and cardinality(current_article.duplicate_title_words)>=4 and cardinality(candidate.duplicate_title_words)>=4)
    or (candidate.title_overlap>=0.6 and candidate.body_overlap>=0.55
      and cardinality(current_article.duplicate_title_words)>=4 and cardinality(candidate.duplicate_title_words)>=4))
   then match_kind:='possible_event';
  end if;
  if match_kind is null then continue; end if;
  score_value:=case when match_kind<>'possible_event' then 1 else greatest(candidate.title_similarity,candidate.title_overlap) end;
  if candidate.status in ('approved','published') or exists(select 1 from publications p where p.article_id=candidate.id and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null)) then chosen:=candidate.id;
  elsif current_article.status in ('approved','published') then chosen:=p_article_id;
  elsif match_kind<>'possible_event' then
   chosen:=case when (candidate.discovered_at,candidate.id)<(current_article.discovered_at,current_article.id) then candidate.id else p_article_id end;
  end if;
  insert into public.article_duplicate_links(article_id,other_id,kind,score,primary_id)
  values(least(p_article_id,candidate.id),greatest(p_article_id,candidate.id),match_kind,score_value,chosen)
  on conflict(article_id,other_id) do nothing;
 end loop;
end $$;

create or replace function public.news_duplicate_serial()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin perform pg_advisory_xact_lock(690012026); return new; end $$;
create or replace function public.news_duplicate_scan_trigger()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin perform public.news_detect_duplicates(new.id); return new; end $$;
create trigger news_duplicate_serial before insert or update of title,body,summary,url,published_at,status on public.articles for each row execute function public.news_duplicate_serial();
create trigger a_news_duplicate_scan after insert or update of title,body,summary,url,published_at on public.articles for each row execute function public.news_duplicate_scan_trigger();

create or replace function public.news_assert_unique(p_article_id uuid,p_publication_id uuid default null)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare link record; other_article uuid;
begin
 perform pg_advisory_xact_lock(690012026);
 if p_article_id is null then raise exception 'DUPLICATE_REVIEW_REQUIRED: publication requires an article'; end if;
 for link in select * from article_duplicate_links where not dismissed and (article_id=p_article_id or other_id=p_article_id)
 loop
  other_article:=case when link.article_id=p_article_id then link.other_id else link.article_id end;
  if exists(select 1 from articles a where a.id=other_article and a.status in ('approved','published'))
   or exists(select 1 from publications p where p.article_id=other_article and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null))
   then raise exception 'DUPLICATE_BLOCKED: another material is approved or published'; end if;
  if link.primary_id is null or link.primary_id<>p_article_id then raise exception 'DUPLICATE_REVIEW_REQUIRED: choose the primary material or confirm a significant update'; end if;
 end loop;
 if exists(select 1 from publications p where p.article_id=p_article_id and p.id is distinct from p_publication_id and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null))
 then raise exception 'DUPLICATE_BLOCKED: this article already has a publication'; end if;
end $$;
create or replace function public.news_guard_article()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.status in ('approved','published') and (tg_op='INSERT' or new.status is distinct from old.status) then perform public.news_assert_unique(new.id,case when new.status='published' then (select id from public.publications where article_id=new.id and status in ('approved','published') order by created_at limit 1) else null end); end if;
 return new;
end $$;
create trigger z_news_duplicate_guard after insert or update of status on public.articles for each row execute function public.news_guard_article();
create or replace function public.news_guard_publication()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.status in ('approved','published') or new.scheduled_at is not null or new.telegram_message_id is not null then
  perform public.news_assert_unique(new.article_id,new.id);
 end if; return new;
end $$;
create trigger news_publication_guard before insert or update of article_id,status,scheduled_at,telegram_message_id on public.publications for each row execute function public.news_guard_publication();
create index if not exists publications_duplicate_article_idx on public.publications(article_id);

create or replace function public.editorial_console_duplicates(p_article_id uuid)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'url',a.url,'source_name',s.name,
 'status',a.status,'published_at',a.published_at,'kind',d.kind,'score',d.score,'primary_id',d.primary_id,
 'reserved',a.status in ('approved','published') or exists(select 1 from publications p where p.article_id=a.id and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null))) order by d.score desc,a.discovered_at),'[]'::jsonb)
 from article_duplicate_links d join articles a on a.id=case when d.article_id=p_article_id then d.other_id else d.article_id end
 left join sources s on s.id=a.source_id where not d.dismissed and (d.article_id=p_article_id or d.other_id=p_article_id)
$$;
create or replace function public.editorial_console_resolve_duplicate(p_article_id uuid,p_action text,p_actor_id uuid,p_actor_email text,p_expected_updated_at timestamptz,p_note text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare current_article articles%rowtype;
begin
 if p_actor_email is distinct from 'rusboma@gmail.com' or p_actor_id is null then raise exception 'Forbidden'; end if;
 if p_action not in ('primary','distinct') then raise exception 'Invalid action'; end if;
 if length(btrim(coalesce(p_note,'')))<20 or length(p_note)>2000 then raise exception 'A reason of at least 20 characters is required'; end if;
 perform pg_advisory_xact_lock(690012026);
 select * into current_article from articles where id=p_article_id for update;
 if not found then raise exception 'Article not found'; end if;
 if current_article.status in ('published','archived') then raise exception 'Article is locked'; end if;
 if p_expected_updated_at is null or current_article.updated_at is distinct from p_expected_updated_at then raise exception 'Conflict: refresh article'; end if;
 if p_action='distinct' and exists(select 1 from article_duplicate_links where not dismissed and (article_id=p_article_id or other_id=p_article_id) and kind<>'possible_event') then raise exception 'EXACT_DUPLICATE: an identical material cannot be a significant update'; end if;
 if p_action='primary' and exists(select 1 from article_duplicate_links d join articles a on a.id=case when d.article_id=p_article_id then d.other_id else d.article_id end where not d.dismissed and (d.article_id=p_article_id or d.other_id=p_article_id) and (a.status in ('approved','published') or exists(select 1 from publications p where p.article_id=a.id and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null)))) then raise exception 'DUPLICATE_BLOCKED: primary material is already approved or published'; end if;
 update article_duplicate_links set dismissed=(p_action='distinct'),primary_id=case when p_action='primary' then p_article_id else primary_id end,note=btrim(p_note)
 where not dismissed and (article_id=p_article_id or other_id=p_article_id);
 if not found then raise exception 'Conflict: duplicates already resolved'; end if;
 update articles set updated_at=clock_timestamp() where id=p_article_id;
 insert into editorial_actions(article_id,action,actor_id,note) values(p_article_id,case when p_action='primary' then 'dedup_primary' else 'dedup_distinct' end,p_actor_id,p_actor_email||' · '||btrim(p_note));
 return jsonb_build_object('ok',true);
end $$;
-- Restrict every new function, including helpers used by the triggers.
DO $permissions$ declare fn record; begin
 for fn in select p.oid::regprocedure as signature from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'news_%' or p.proname in ('editorial_console_duplicates','editorial_console_resolve_duplicate')) loop
 execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
 execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $permissions$;
-- Reconcile existing records without changing statuses, decisions, or deleting any material.
DO $backfill$ declare item record; begin
 for item in select id from public.articles order by discovered_at,id loop perform public.news_detect_duplicates(item.id); end loop;
end $backfill$;
