alter table public.editorial_actions drop constraint editorial_actions_action_check;
alter table public.editorial_actions add constraint editorial_actions_action_check check(action in ('approve','reject','request_review','mark_verified','mark_disputed','dedup_primary','dedup_distinct'));
