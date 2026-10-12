-- Drafts are private, versioned and separate from source articles and publications.
create table if not exists public.editorial_drafts (
 article_id uuid primary key references public.articles(id) on delete cascade,
 title text not null, lead text not null, body text not null, tver_note text not null,
 verification_notes text not null default '', content_kind text not null check(content_kind in ('news','practice','event_announcement')),
 facts jsonb not null default '[]'::jsonb,
 status text not null default 'draft' check(status in ('draft','approved')),
 revision integer not null default 1, source_fingerprint text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 generated_at timestamptz, modified_by uuid not null, approved_at timestamptz, approved_by uuid
);
create table if not exists public.editorial_draft_versions (
 article_id uuid not null references public.articles(id) on delete cascade,
 revision integer not null, content jsonb not null, action text not null,
 actor_id uuid not null, created_at timestamptz not null default now(), primary key(article_id,revision)
);
alter table public.editorial_drafts enable row level security;
alter table public.editorial_draft_versions enable row level security;
revoke all on public.editorial_drafts,public.editorial_draft_versions from public,anon,authenticated;
grant select,insert,update,delete on public.editorial_drafts,public.editorial_draft_versions to service_role;
alter table public.editorial_actions drop constraint if exists editorial_actions_action_check;
alter table public.editorial_actions add constraint editorial_actions_action_check check(action in
 ('approve','reject','request_review','mark_verified','mark_disputed','dedup_primary','dedup_distinct','draft_generate','draft_save','draft_approve'));

create or replace function public.editorial_draft_context(p_article_id uuid)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('article',jsonb_build_object('id',a.id,'title',a.title,'url',a.url,'status',a.status,
  'updated_at',a.updated_at,'event_date',a.event_date,'published_at',a.published_at,'stream_key',s.editorial_stream,
  'source_name',s.name,'source_type',s.source_type),
  'has_full_text',c.full_text is not null,
  'source_text',coalesce(c.full_text,nullif(a.body,''),a.summary,''),
  'source_fingerprint',md5(a.title||a.url||coalesce(a.event_date::text,'')||coalesce(c.full_text,nullif(a.body,''),a.summary,'')),
  'draft',to_jsonb(d)-'tver_note')
 from articles a left join sources s on s.id=a.source_id
 left join article_content_snapshots c on c.article_id=a.id
 left join editorial_drafts d on d.article_id=a.id where a.id=p_article_id;
$$;

create or replace function public.editorial_draft_write(p_article_id uuid,p_action text,p_content jsonb,
 p_expected_revision integer,p_source_fingerprint text,p_expected_article_updated_at timestamptz,
 p_actor_id uuid,p_actor_email text,p_verified boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a articles%rowtype; d editorial_drafts%rowtype; context jsonb; key text; fact jsonb;
begin
 perform pg_advisory_xact_lock(690012026);
 if p_actor_email is distinct from 'rusboma@gmail.com' or p_actor_id is null then raise exception 'Forbidden'; end if;
 if p_action is null or p_action not in ('generate','save','approve') then raise exception 'Invalid action'; end if;
 select * into a from articles where id=p_article_id for update;
 if not found then raise exception 'Article not found'; end if;
 if a.status in ('published','archived') or exists(select 1 from publications where article_id=a.id and
  (status in ('approved','published') or scheduled_at is not null or telegram_message_id is not null)) then raise exception 'Article is locked'; end if;
 if p_expected_article_updated_at is null or a.updated_at is distinct from p_expected_article_updated_at then raise exception 'Conflict: source changed'; end if;
 context:=editorial_draft_context(a.id);
 if p_source_fingerprint is null or context->>'source_fingerprint' is distinct from p_source_fingerprint then raise exception 'Conflict: source text changed'; end if;
 select * into d from editorial_drafts where article_id=a.id for update;
 if p_expected_revision is null or coalesce(d.revision,0)<>p_expected_revision then raise exception 'Conflict: draft changed'; end if;
 if p_action='approve' then
  if d.article_id is null then raise exception 'Draft not found'; end if;
  if not coalesce(p_verified,false) then raise exception 'FACT_CHECK_REQUIRED'; end if;
  if d.source_fingerprint is distinct from p_source_fingerprint then raise exception 'Conflict: regenerate or update draft'; end if;
  perform news_assert_unique(a.id);
  perform editorial_console_decide(a.id,'approve',p_actor_id,p_actor_email,a.updated_at,'Одобрен проверенный черновик, версия '||d.revision);
  update editorial_drafts set status='approved',approved_at=clock_timestamp(),approved_by=p_actor_id,
   revision=revision+1,updated_at=clock_timestamp(),modified_by=p_actor_id where article_id=a.id returning * into d;
 else
  if jsonb_typeof(p_content) is distinct from 'object' then raise exception 'Invalid draft'; end if;
  foreach key in array array['title','lead','body','verification_notes','content_kind'] loop
   if jsonb_typeof(p_content->key) is distinct from 'string' then raise exception 'Invalid draft field'; end if;
  end loop;
  if length(btrim(p_content->>'title')) not between 5 and 240 or length(btrim(p_content->>'lead')) not between 20 and 1200
   or length(btrim(p_content->>'body')) not between 80 and 12000
   or length(p_content->>'verification_notes')>3000 or p_content->>'content_kind' not in ('news','practice','event_announcement') then raise exception 'Invalid draft lengths'; end if;
  if jsonb_typeof(p_content->'facts') is distinct from 'array' or jsonb_array_length(p_content->'facts')>5 then raise exception 'Invalid facts'; end if;
  if p_action='generate' and jsonb_array_length(p_content->'facts')=0 then raise exception 'Invalid empty evidence'; end if;
  for fact in select value from jsonb_array_elements(p_content->'facts') loop
   if jsonb_typeof(fact->'quote') is distinct from 'string' or jsonb_typeof(fact->'claim') is distinct from 'string'
    or length(fact->>'quote') not between 12 and 500 or length(fact->>'claim') not between 5 and 500 then raise exception 'Invalid evidence'; end if;
   if strpos(regexp_replace(context->>'source_text','[[:space:]]+',' ','g'),regexp_replace(fact->>'quote','[[:space:]]+',' ','g'))=0 then raise exception 'Invalid unsupported evidence'; end if;
  end loop;
  if d.status='approved' then perform editorial_console_decide(a.id,'request_review',p_actor_id,p_actor_email,a.updated_at,'Черновик изменён; требуется повторная проверка'); end if;
  insert into editorial_drafts(article_id,title,lead,body,tver_note,verification_notes,content_kind,facts,source_fingerprint,revision,modified_by,generated_at)
  values(a.id,btrim(p_content->>'title'),btrim(p_content->>'lead'),btrim(p_content->>'body'),'',
   btrim(p_content->>'verification_notes'),p_content->>'content_kind',p_content->'facts',p_source_fingerprint,1,p_actor_id,
   case when p_action='generate' then clock_timestamp() end)
  on conflict(article_id) do update set title=excluded.title,lead=excluded.lead,body=excluded.body,tver_note=excluded.tver_note,
   verification_notes=excluded.verification_notes,content_kind=excluded.content_kind,facts=excluded.facts,
   source_fingerprint=excluded.source_fingerprint,revision=editorial_drafts.revision+1,status='draft',approved_at=null,approved_by=null,
   updated_at=clock_timestamp(),modified_by=p_actor_id,
   generated_at=case when p_action='generate' then clock_timestamp() else editorial_drafts.generated_at end returning * into d;
 end if;
 insert into editorial_draft_versions(article_id,revision,content,action,actor_id) values(a.id,d.revision,to_jsonb(d),p_action,p_actor_id);
 insert into editorial_actions(article_id,action,actor_id,note) values(a.id,'draft_'||case p_action when 'generate' then 'generate' when 'save' then 'save' else 'approve' end,
  p_actor_id,p_actor_email||' · Черновик, версия '||d.revision||case when p_action='approve' then ' · Факты и источник проверены редактором' else '' end);
 return editorial_draft_context(a.id)-'source_text';
end $$;
revoke all on function public.editorial_draft_context(uuid) from public,anon,authenticated;
revoke all on function public.editorial_draft_write(uuid,text,jsonb,integer,text,timestamptz,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.editorial_draft_context(uuid) to service_role;
grant execute on function public.editorial_draft_write(uuid,text,jsonb,integer,text,timestamptz,uuid,text,boolean) to service_role;
