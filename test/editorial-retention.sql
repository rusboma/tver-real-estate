begin;
set local role service_role;
do $tests$
declare sid uuid; old_id uuid; undated_id uuid; fresh_id uuid; plan_id uuid; published_id uuid; actor uuid:=gen_random_uuid();
 day date:=(now() at time zone 'Europe/Moscow')::date; start_day timestamptz; result jsonb;
begin
 insert into sources(name,url,tier,source_type) values('QA retention source','https://retention-test.invalid/'||actor,'B','local_media') returning id into sid;
 insert into articles(source_id,title,url,body,published_at) values(sid,'Retention old','https://retention-test.invalid/'||actor||'/old','QA old content retained',now()-interval '8 days') returning id into old_id;
 insert into articles(source_id,title,url,body,published_at,discovered_at) values(sid,'Retention undated','https://retention-test.invalid/'||actor||'/unknown','QA old undated content',null,now()-interval '8 days') returning id into undated_id;
 insert into articles(source_id,title,url,body,published_at) values(sid,'Retention fresh','https://retention-test.invalid/'||actor||'/fresh','QA fresh content retained',now()-interval '1 day') returning id into fresh_id;
 insert into articles(source_id,title,url,body,published_at,status) values(sid,'Retention planned','https://retention-test.invalid/'||actor||'/planned','QA planned content retained',now()-interval '9 days','approved') returning id into plan_id;
 perform news_reserve_publication(plan_id,'QA plan title','QA approved body retained');
 insert into articles(source_id,title,url,body,published_at,status) values(sid,'Retention published','https://retention-test.invalid/'||actor||'/published','QA published content retained',now()-interval '9 days','published') returning id into published_id;
 result:=editorial_console_snapshot('all','Retention old',1);
 if (result->>'total')::int<>0 then raise exception 'Stale row visible before sweep';end if;
 perform editorial_archive_stale();
 if (select count(*) from articles where id in(old_id,undated_id) and status='archived' and archived_at is not null)<>2 then raise exception 'Old pending rows not archived';end if;
 if (select status from articles where id=fresh_id)='archived' or (select status from articles where id=plan_id)<>'approved' or (select status from articles where id=published_id)<>'published' then raise exception 'Protected or fresh rows archived';end if;
 if not exists(select 1 from articles where id=old_id and body='QA old content retained') then raise exception 'Original content deleted';end if;
 if (editorial_archive_stale()->>'archived')::int<>0 then raise exception 'Archive sweep not idempotent';end if;
 start_day:=day::timestamp at time zone 'Europe/Moscow';
 insert into articles(source_id,title,url,body,published_at) values
 (sid,'DateBound A','https://retention-test.invalid/'||actor||'/a','Boundary start',start_day),
 (sid,'DateBound B','https://retention-test.invalid/'||actor||'/b','Boundary end',start_day+interval '1 day'-interval '1 microsecond'),
 (sid,'DateBound C','https://retention-test.invalid/'||actor||'/c','Boundary before',start_day-interval '1 microsecond'),
 (sid,'DateBound D','https://retention-test.invalid/'||actor||'/d','Boundary after',start_day+interval '1 day');
 result:=editorial_console_snapshot_by_date('all','DateBound',1,day,day);
 if (result->>'total')::int<>2 then raise exception 'Moscow inclusive day boundaries failed';end if;
 if has_function_privilege('anon','public.editorial_archive_stale()','execute') then raise exception 'Public archive mutation allowed';end if;
end $tests$;
rollback;
