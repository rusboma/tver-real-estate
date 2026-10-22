-- High-priority scope exclusions for all ingestion adapters.
create or replace function public.editorial_exclusion_reason(p_title text,p_summary text,p_body text,p_source_id uuid)
returns text language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare t text; source_kind text; source_name text; death_text text;
begin
 t:=coalesce(p_title,'')||' '||left(coalesce(nullif(p_summary,''),p_body,''),600);
 select s.source_type,s.name into source_kind,source_name from sources s where s.id=p_source_id;
 if source_kind in ('blogger','personal_blog','personal_channel')
  or coalesce(source_name,'') ~* '(блог[г]?ер|личный блог|авторский канал)'
  or t ~* '(блог[г]?ер|личный блог|авторский блог)'
 then return 'Публикация блогера или материал с явным авторством блогера'; end if;
 if t ~* '(преступник|розыск|наркотик|взятк|обвинительн.{0,20}заключен|криминал|убийств|убит[а-яё]*|мошеннич|ограб|краж[а-яё]*|приговор|осужд[её]н|уголовн.{0,30}(дел|преследован)|разбой|вымогател|изнасилован)'
 then return 'Происшествия: криминал и уголовные дела'; end if;
 death_text:=regexp_replace(t,'(погибших нет|без погибших|предотвращени[яею] гибели|предотвратить гибель)',' ','gi');
 if death_text ~* '(^|[^а-яё])(погиб(ла|ли|ло|ших|шие|ший|шая|шего|шем|шим|шую|шей)?|гибел[ьи]|смертельн[а-яё]*)([^а-яё]|$)'
 then return 'Происшествия: погибшие и сообщения о гибели людей'; end if;
 if t ~* '(^|[^а-яёa-z])(дтп|автоавари[а-яё]*)([^а-яёa-z]|$)'
  or t ~* '(автомобильн.{0,20}авари|дорожн.{0,20}транспортн.{0,20}происшеств|наезд.{0,30}(пешеход|человек)|сбил[а-яё]*.{0,30}(пешеход|человек))'
  or (t ~* '(авари|столкновен|столкнул|врезал)' and t ~* '(автомобил|легковуш|грузовик|мотоцикл|водител|трасс[аеу])')
 then return 'Происшествия: автомобильные аварии и ДТП'; end if;
 return null;
end $$;

create or replace function public.editorial_apply_exclusion(p_article_id uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare a articles%rowtype; reason text;
begin
 perform pg_advisory_xact_lock(690012026);
 select * into a from articles where id=p_article_id for update;
 if not found or a.status not in ('new','review','rejected') then return false; end if;
 -- Do not rewrite a human decision or anything reserved for publication.
 if exists(select 1 from editorial_actions where article_id=a.id)
  or exists(select 1 from article_reviews where article_id=a.id and (reviewer like 'editor:%' or verification_status<>'not_verified'))
  or exists(select 1 from publications where article_id=a.id and (status in ('approved','published') or scheduled_at is not null or telegram_message_id is not null)) then return false; end if;
 reason:=editorial_exclusion_reason(a.title,a.summary,a.body,a.source_id);
 if reason is null then return false; end if;
 if a.status<>'rejected' then update articles set status='rejected' where id=a.id; end if;
 insert into article_reviews(article_id,relevance_score,decision,reasons,verification_status,reviewer)
 values(a.id,0,'out_of_scope',jsonb_build_array(reason,'Автоматическое отклонение по редакционным критериям'),'not_verified','db_editorial_policy_v1')
 on conflict(article_id) do update set relevance_score=0,decision='out_of_scope',reasons=excluded.reasons,
  reviewer=excluded.reviewer,updated_at=now();
 return true;
end $$;
create or replace function public.editorial_exclusion_trigger()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform editorial_apply_exclusion(new.id);
 return new;
end $$;
revoke all on function public.editorial_exclusion_reason(text,text,text,uuid),public.editorial_apply_exclusion(uuid),public.editorial_exclusion_trigger() from public,anon,authenticated;
grant execute on function public.editorial_exclusion_reason(text,text,text,uuid),public.editorial_apply_exclusion(uuid),public.editorial_exclusion_trigger() to service_role;
drop trigger if exists zz_editorial_exclusions on public.articles;
create trigger zz_editorial_exclusions after insert or update of title,summary,body,source_id on public.articles
 for each row execute function public.editorial_exclusion_trigger();
