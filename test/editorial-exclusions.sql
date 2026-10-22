begin;
set local role service_role;
do $tests$
declare sid uuid; bid uuid; aid uuid; actor uuid:=gen_random_uuid(); row record;
begin
 insert into sources(name,url,tier,source_type) values('QA policy news','https://policy-test.invalid/'||actor,'B','local_media') returning id into sid;
 insert into sources(name,url,tier,source_type) values('QA personal writer','https://policy-blog.invalid/'||actor,'B','blogger') returning id into bid;
 for row in select * from (values
  ('В Твери строитель погиб при падении',true),
  ('На трассе столкнулись два автомобиля',true),
  ('Возле жилого комплекса произошло ДТП',true),
  ('Возбуждено уголовное дело о мошенничестве с квартирами',true),
  ('Известный блогер рассказал о ремонте квартиры',true),
  ('В Твери устранили аварию на водопроводе',false),
  ('Суд обязал УК отремонтировать крышу',false),
  ('Новые противопожарные системы для предотвращения гибели людей',false),
  ('Ремонт теплосетей после аварии, погибших нет',false),
  ('Блог Домов: новые правила управления МКД',false)
 ) as cases(title,reject) loop
  if (editorial_exclusion_reason(row.title,'','',sid) is not null)<>row.reject then raise exception 'Policy classification failed: %',row.title;end if;
 end loop;
 if editorial_exclusion_reason('Расчёт платы за содержание МКД','','',bid) is null then raise exception 'Blogger source not excluded';end if;
 insert into articles(source_id,title,url,body) values(sid,'В Твери жилец погиб при пожаре','https://policy-test.invalid/'||actor||'/1','QA fixture for editorial exclusion') returning id into aid;
 if (select status from articles where id=aid)<>'rejected' or not exists(select 1 from article_reviews where article_id=aid and relevance_score=0 and decision='out_of_scope' and reviewer='db_editorial_policy_v1') then raise exception 'Automatic rejection not applied';end if;
 insert into articles(source_id,title,url,body) values(sid,'В Твери обновили тепловые сети','https://policy-test.invalid/'||actor||'/2','QA fixture different maintenance news') returning id into aid;
 perform editorial_console_decide(aid,'request_review',actor,'rusboma@gmail.com',(select updated_at from articles where id=aid),'Редактор уже проверяет материал');
 update articles set title='В Твери блогер обсуждает тепловые сети' where id=aid;
 if (select status from articles where id=aid)<>'review' then raise exception 'Human decision overwritten';end if;
 if has_function_privilege('anon','public.editorial_apply_exclusion(uuid)','execute') then raise exception 'Public policy mutation allowed';end if;
end $tests$;
rollback;
