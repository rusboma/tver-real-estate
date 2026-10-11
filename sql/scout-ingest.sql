create or replace function public.scout_ingest_item(p_item jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 source_record public.sources%rowtype;
 article_record public.articles%rowtype;
 is_duplicate boolean := false;
 full_text_value text := nullif(p_item->>'full_text','');
begin
 if jsonb_typeof(p_item) <> 'object' or nullif(btrim(p_item->>'title'),'') is null
 or length(p_item->>'title') > 1000 or length(coalesce(p_item->>'body','')) > 100000
 or coalesce(p_item->>'url','') !~ '^https://' then raise exception 'Invalid article'; end if;
 select * into source_record from public.sources where url=p_item->>'source_url' and is_active;
 if not found then raise exception 'Unknown source'; end if;
 -- Accept the same HTTPS host with or without www, retaining source path boundaries.
 if not starts_with(
   regexp_replace(p_item->>'url','^https://www\.','https://'),
   regexp_replace(source_record.url,'^https://www\.','https://') ||
   case when right(source_record.url,1)='/' then '' else '/' end
 ) then raise exception 'Article URL does not match source'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_item->>'url',0));
 select * into article_record from public.articles where url=p_item->>'url' limit 1;
 if found then
   is_duplicate := true;
   if article_record.source_id is null then
     update public.articles set source_id=source_record.id where id=article_record.id;
   end if;
 else
   insert into public.articles(source_id,external_id,title,url,published_at,content_type,status,summary,body,confidence)
   values(source_record.id,p_item->>'external_id',p_item->>'title',p_item->>'url',
     nullif(p_item->>'published_at','')::timestamptz,'news','new',
     p_item->>'summary',p_item->>'body',nullif(p_item->>'confidence','')::numeric)
   returning * into article_record;
 end if;
 if full_text_value is not null and length(full_text_value) between 100 and 100000 then
   insert into public.article_content_snapshots(article_id,source_url,full_text,excerpt,image_url,image_caption)
   values(article_record.id,p_item->>'url',full_text_value,p_item->>'summary',
     case when coalesce(p_item->>'image_url','') ~ '^https://' then p_item->>'image_url' else null end,null)
   on conflict(article_id) do nothing;
 end if;
 update public.sources set last_checked_at=now() where id=source_record.id;
 return jsonb_build_object('id',article_record.id,'url',article_record.url,'title',article_record.title,
   'status',case when is_duplicate then 'duplicate' else 'inserted' end);
end $$;
revoke all on function public.scout_ingest_item(jsonb) from public,anon,authenticated;
grant execute on function public.scout_ingest_item(jsonb) to service_role;
