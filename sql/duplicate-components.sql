-- Treat connected source reports as one event, including transitive matches.
alter table public.article_duplicate_links drop constraint if exists article_duplicate_links_check1;
alter table public.article_duplicate_links drop constraint if exists article_duplicate_links_check;
alter table public.article_duplicate_links add constraint duplicate_pair_order check(article_id<other_id);
create or replace function public.news_component(p_article_id uuid)
returns table(article_id uuid) language sql stable security invoker set search_path=public,pg_temp as $$
 with recursive connected(id) as (
 select p_article_id union
 select case when d.article_id=c.id then d.other_id else d.article_id end
 from connected c join article_duplicate_links d on (d.article_id=c.id or d.other_id=c.id) where not d.dismissed)
 select id from connected
$$;
revoke all on function public.news_component(uuid) from public,anon,authenticated;
grant execute on function public.news_component(uuid) to service_role;
create or replace function public.news_assert_unique(p_article_id uuid,p_publication_id uuid default null)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(690012026);
 if p_article_id is null then raise exception 'DUPLICATE_REVIEW_REQUIRED: publication requires an article'; end if;
 if exists(select 1 from news_component(p_article_id) c join articles a on a.id=c.article_id where a.id<>p_article_id and (a.status in ('approved','published')
 or exists(select 1 from publications p where p.article_id=a.id and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null))))
 then raise exception 'DUPLICATE_BLOCKED: another material in this event is approved or published'; end if;
 if exists(select 1 from article_duplicate_links d where not dismissed and d.article_id in (select article_id from news_component(p_article_id)) and (d.primary_id is null or d.primary_id<>p_article_id))
 then raise exception 'DUPLICATE_REVIEW_REQUIRED: choose the primary material or confirm a significant update'; end if;
 if exists(select 1 from publications p where p.article_id=p_article_id and p.id is distinct from p_publication_id and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null))
 then raise exception 'DUPLICATE_BLOCKED: this article already has a publication'; end if;
end $$;
create or replace function public.editorial_console_duplicates(p_article_id uuid)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'url',a.url,'source_name',s.name,
 'status',a.status,'published_at',a.published_at,'kind',coalesce(d.kind,'possible_event'),'score',coalesce(d.score,0.5),
 'primary_id',coalesce(d.primary_id,(select primary_id from article_duplicate_links where not dismissed and article_id in (select article_id from news_component(p_article_id)) and primary_id is not null limit 1)),
 'reserved',a.status in ('approved','published') or exists(select 1 from publications p where p.article_id=a.id and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null))) order by a.discovered_at),'[]'::jsonb)
 from news_component(p_article_id) c join articles a on a.id=c.article_id
 left join sources s on s.id=a.source_id
 left join article_duplicate_links d on d.article_id=least(p_article_id,a.id) and d.other_id=greatest(p_article_id,a.id) and not d.dismissed
 where a.id<>p_article_id
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
 if p_action='primary' and exists(select 1 from news_component(p_article_id) c join articles a on a.id=c.article_id where a.id<>p_article_id and (a.status in ('approved','published') or exists(select 1 from publications p where p.article_id=a.id and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null)))) then raise exception 'DUPLICATE_BLOCKED: primary material is already approved or published'; end if;
 if p_action='primary' then
 update article_duplicate_links set primary_id=p_article_id,note=btrim(p_note) where not dismissed and article_id in (select article_id from news_component(p_article_id));
 else
 update article_duplicate_links set dismissed=true,note=btrim(p_note) where not dismissed and (article_id=p_article_id or other_id=p_article_id);
 end if;
 if not found then raise exception 'Conflict: duplicates already resolved'; end if;
 update articles set updated_at=clock_timestamp() where id=p_article_id;
 insert into editorial_actions(article_id,action,actor_id,note) values(p_article_id,case when p_action='primary' then 'dedup_primary' else 'dedup_distinct' end,p_actor_id,p_actor_email||' · '||btrim(p_note));
 return jsonb_build_object('ok',true,'updated_at',(select updated_at from articles where id=p_article_id),'duplicates',public.editorial_console_duplicates(p_article_id));
end $$;
create or replace function public.news_reconcile_primary(p_article_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare approved_ids uuid[];
begin
 select array_agg(a.id) into approved_ids from news_component(p_article_id) c join articles a on a.id=c.article_id
 where a.status in ('approved','published') or exists(select 1 from publications p where p.article_id=a.id and (p.status in ('approved','published') or p.scheduled_at is not null or p.telegram_message_id is not null));
 if cardinality(approved_ids)=1 then update article_duplicate_links set primary_id=approved_ids[1]
 where not dismissed and article_id in (select article_id from news_component(p_article_id)); end if;
end $$;
revoke all on function public.news_reconcile_primary(uuid) from public,anon,authenticated;
grant execute on function public.news_reconcile_primary(uuid) to service_role;
create or replace function public.news_duplicate_scan_trigger()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin perform public.news_detect_duplicates(new.id); perform public.news_reconcile_primary(new.id); return new; end $$;
DO $backfill$ declare item record; begin
 for item in select id from articles loop perform news_reconcile_primary(item.id); end loop;
end $backfill$;
