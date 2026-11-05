\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select public.approve_order(
  '31000000-0000-0000-0000-000000000004',
  (select id from public.orders where placed_by_profile_id = '30000000-0000-0000-0000-000000000002'),
  null, null, null, null
);
-- Keep the stock row lock long enough for session B to contend with it.
select pg_sleep(5);
commit;
