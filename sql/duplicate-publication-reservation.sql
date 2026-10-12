-- Future publishers must reserve once before calling any external delivery API.
-- This RPC does not send anything and does not enable Telegram.
create or replace function public.news_reserve_publication(p_article_id uuid,p_title text,p_body text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare item articles%rowtype; publication_id uuid;
begin
 perform pg_advisory_xact_lock(690012026);
 select * into item from articles where id=p_article_id for update;
 if not found then raise exception 'Article not found'; end if;
 perform public.news_assert_unique(p_article_id);
 if item.status<>'approved' then raise exception 'Article must be approved before reservation'; end if;
 if nullif(btrim(p_title),'') is null or nullif(btrim(p_body),'') is null or length(p_title)>1000 or length(p_body)>100000 then raise exception 'Invalid publication content'; end if;
 insert into publications(article_id,title,body,status) values(p_article_id,p_title,p_body,'approved') returning id into publication_id;
 return jsonb_build_object('id',publication_id,'article_id',p_article_id,'status','approved');
end $$;
revoke all on function public.news_reserve_publication(uuid,text,text) from public,anon,authenticated;
grant execute on function public.news_reserve_publication(uuid,text,text) to service_role;
