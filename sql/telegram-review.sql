do $migration$
declare d text;
begin
 select pg_get_functiondef('public.triage_article_on_ingest()'::regprocedure) into d;
 d := replace(d, 'verdict := case when exists', 'verdict := case when exists(select 1 from public.sources s where s.id=new.source_id and s.source_type=''telegram'') then ''needs_review'' when exists');
 execute d;
end $migration$;