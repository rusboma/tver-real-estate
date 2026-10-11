CREATE OR REPLACE FUNCTION public.triage_article_on_ingest()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 t text := coalesce(new.title,'') || ' ' || coalesce(new.summary,'');
 housing boolean;
 land boolean;
 unrelated boolean;
 local_match boolean;
 score integer;
 verdict text;
 why jsonb;
begin
 housing := t ~* '(водоснабжен|теплоснабжен|отопительн|питьев.{0,15}вод|управляющ.{0,20}организац|квартир|жил(ой|ого|ых|ые|ых домов)|новостро|ипотек|недвижим|застройщик|многоквартир|управляющ.{0,12}компан|жкх|коммунальн|расселен|аренд.{0,20}(жиль|квартир))';
 land := t ~* '(земельн.{0,20}участ|земл.{0,15}(под строительств|ижс))';
 unrelated := t ~* '(колледж|школ|больниц|поликлиник|стадион|спортзал)';
 local_match := t ~* '(^|[^а-яёa-z])(твер|верхневолж|калининск|торжок|конаков|ржев|кимр|бежецк|кашин|осташков|лихослав|торопец|болого|удомл|нелидов|андреапол|зубцов|стариц|весьегон|калязин|максатих|рамешк|спиров|молоков|сонков|сандов|пенов|селижар|фиров|жарков|вышн.{0,10}волоч)';
 score := case when housing then 70 when land then 45 else 15 end + case when local_match then 15 else 0 end - case when unrelated then 55 else 0 end;
 score := greatest(0,least(100,score));
 verdict := case when exists(select 1 from public.sources s where s.id=new.source_id and (s.source_type='telegram' or s.url in ('https://illidium.com/','https://dsktver.com/','https://www.tvervodokanal.ru/','https://www.oes-tver.ru/','https://uk-zvezda.ru/','https://tsjtver.kvado.ru/','https://www.tver.ru/','https://vedtver.ru/','https://kimvestnik.ru/','https://bzgazeta.ru/','https://seliger-news.ru/','https://gazeta-konakovo.ru/','https://www.kashin.info/','https://v-volok.ru/','https://lihoslavl69.ru/','https://toropecadm.ru/','https://xn----8sbgnuc0acykh9d.xn--p1ai/','https://presska.ru/','https://max.ru/id6901093516_gos'))) then 'needs_review' when exists(select 1 from public.sources s where s.id=new.source_id and s.url='https://epp.genproc.gov.ru/ru/proc_69/') then 'needs_review' when housing and not unrelated and local_match then 'candidate' when score < 35 then 'out_of_scope' else 'needs_review' end;
 why := jsonb_build_array(case when housing then 'housing-related headline' when land then 'land-related headline; manual scope check needed' else 'no clear housing relevance' end, case when unrelated then 'institutional topic detected' else 'no institutional exclusion' end,case when local_match then 'Tver region mentioned' else 'locality not established' end);
 insert into public.article_reviews(article_id,relevance_score,decision,reasons,verification_status,reviewer)
 values(new.id,score,verdict,why,'not_verified','db_triage_v1')
 on conflict(article_id) do update set relevance_score=excluded.relevance_score,decision=excluded.decision,reasons=excluded.reasons,updated_at=now()
 where public.article_reviews.reviewer='db_triage_v1' and public.article_reviews.verification_status='not_verified';
 return new;
end $function$

