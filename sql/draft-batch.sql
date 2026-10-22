-- Bulk preparation uses exactly the review queue, across all streams and pages.
create or replace function public.editorial_draft_batch_items()
returns table(article_id uuid,title text,has_draft boolean) language sql stable security invoker set search_path=public,pg_temp as $$
 select a.id,a.title,exists(select 1 from editorial_drafts d where d.article_id=a.id)
 from articles a left join article_reviews r on r.article_id=a.id
 where a.status in ('new','review') and (a.status='review' or coalesce(r.decision,'needs_review')='needs_review')
 and (coalesce(a.published_at,a.discovered_at)>=now()-interval '7 days' or editorial_article_in_publication(a.id))
 and not editorial_article_in_publication(a.id)
 and not exists(select 1 from article_duplicate_links d where not d.dismissed and
  (d.article_id=a.id or d.other_id=a.id) and (d.primary_id is null or d.primary_id<>a.id))
 order by a.discovered_at desc,a.id;
$$;
create or replace function public.editorial_draft_batch_candidate(p_article_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from editorial_draft_batch_items() where article_id=p_article_id and not has_draft);
$$;
create or replace function public.editorial_draft_batch_list()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with review_items as materialized (select * from editorial_draft_batch_items())
 select jsonb_build_object('review_total',(select count(*) from review_items),
 'existing_drafts',(select count(*) from review_items where has_draft),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',article_id,'title',title)) from review_items where not has_draft),'[]'::jsonb));
$$;
revoke all on function public.editorial_draft_batch_items(),public.editorial_draft_batch_candidate(uuid),public.editorial_draft_batch_list() from public,anon,authenticated;
grant execute on function public.editorial_draft_batch_items(),public.editorial_draft_batch_candidate(uuid),public.editorial_draft_batch_list() to service_role;
