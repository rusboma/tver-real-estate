begin;
set local role service_role;
do $tests$
declare sid uuid; a uuid; b uuid; old_id uuid; rejected_id uuid; actor uuid:=gen_random_uuid(); ctx jsonb; content jsonb;
begin
 insert into sources(name,url,tier,source_type) values('QA batch source','https://batch-test.invalid/'||actor,'B','local_media') returning id into sid;
 insert into articles(source_id,title,url,body,status,published_at) values(sid,'Batch A','https://batch-test.invalid/'||actor||'/a','QA batch candidate with enough independent content for the fixture.', 'review',now()) returning id into a;
 insert into articles(source_id,title,url,body,status,published_at) values(sid,'Batch B','https://batch-test.invalid/'||actor||'/b','QA existing draft source phrase with independent content.','review',now()) returning id into b;
 insert into articles(source_id,title,url,body,status,published_at) values(sid,'Batch old','https://batch-test.invalid/'||actor||'/old','QA old independent fixture','review',now()-interval '8 days') returning id into old_id;
 insert into articles(source_id,title,url,body,status,published_at) values(sid,'Batch rejected','https://batch-test.invalid/'||actor||'/rejected','QA rejected independent fixture','rejected',now()) returning id into rejected_id;
 if not editorial_draft_batch_candidate(a) or not editorial_draft_batch_candidate(b) then raise exception 'Review candidates missing';end if;
 if editorial_draft_batch_candidate(old_id) or editorial_draft_batch_candidate(rejected_id) then raise exception 'Stale or rejected material included';end if;
 ctx:=editorial_draft_context(b);
 content:=jsonb_build_object('title','QA existing draft','lead','QA Existing draft lead with preserved editor context.','body',repeat('QA existing draft source phrase with independent content. ',3),'verification_notes','QA verify source','content_kind','news','facts',jsonb_build_array(jsonb_build_object('claim','QA existing source statement','quote','QA existing draft source phrase with independent content.')));
 perform editorial_draft_write(b,'generate',content,0,ctx->>'source_fingerprint',(ctx->'article'->>'updated_at')::timestamptz,actor,'rusboma@gmail.com');
 if editorial_draft_batch_candidate(b) then raise exception 'Existing draft would be overwritten';end if;
 if exists(select 1 from jsonb_array_elements(editorial_draft_batch_list()->'items') item where item->>'id'=b::text) then raise exception 'Existing draft appears in batch';end if;
 perform editorial_console_decide(a,'reject',actor,'rusboma@gmail.com',(select updated_at from articles where id=a),'QA rejected while a batch was preparing');
 if editorial_draft_batch_candidate(a) then raise exception 'Decision change ignored';end if;
 if has_function_privilege('anon','public.editorial_draft_batch_list()','execute') then raise exception 'Public batch list exposed';end if;
 if exists(select 1 from publications where article_id in(a,b)) then raise exception 'Batch created a publication';end if;
end $tests$;
rollback;
