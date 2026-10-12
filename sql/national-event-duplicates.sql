CREATE OR REPLACE FUNCTION public.news_detect_duplicates(p_article_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
 (current_article.event_date is not null and a.event_date=current_article.event_date) or
 coalesce(a.published_at,a.discovered_at) between coalesce(current_article.published_at,current_article.discovered_at)-interval '7 days'
 and coalesce(current_article.published_at,current_article.discovered_at)+interval '7 days')
 loop
  match_kind:=null; chosen:=null;
  if candidate.duplicate_url_key=current_article.duplicate_url_key then match_kind:='exact_url';
  elsif current_article.duplicate_body_hash is not null and candidate.duplicate_body_hash=current_article.duplicate_body_hash and not(current_article.event_date is not null and candidate.event_date is not null and current_article.event_date<>candidate.event_date) then match_kind:='exact_text';
  elsif (current_article.event_date is not null and candidate.event_date=current_article.event_date or abs(extract(epoch from (coalesce(candidate.published_at,candidate.discovered_at)-coalesce(current_article.published_at,current_article.discovered_at))))<=604800)
   and not(current_article.event_date is not null and candidate.event_date is not null and current_article.event_date<>candidate.event_date)
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
end $function$

