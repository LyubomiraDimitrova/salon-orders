\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select public.approve_order(
  '31000000-0000-0000-0000-000000000005',
  (select id from public.orders where placed_by_profile_id = '30000000-0000-0000-0000-000000000003'),
  null, null, null, null
);
commit;
