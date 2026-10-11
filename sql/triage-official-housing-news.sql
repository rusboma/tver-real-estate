do $migration$
declare d text;
begin
 select pg_get_functiondef('public.triage_article_on_ingest()'::regprocedure) into d;
 d := replace(d, '(квартир|жил', '(водоснабжен|теплоснабжен|отопительн|питьев.{0,15}вод|управляющ.{0,20}организац|квартир|жил');
 d := replace(d, 'verdict := case when housing', 'verdict := case when exists(select 1 from public.sources s where s.id=new.source_id and s.url=''https://epp.genproc.gov.ru/ru/proc_69/'') then ''needs_review'' when housing');
 execute d;
end $migration$;