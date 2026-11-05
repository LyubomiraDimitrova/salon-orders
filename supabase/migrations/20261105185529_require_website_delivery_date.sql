-- Require a delivery day for new website orders without changing existing orders.
-- The idempotency claim remains before the new validation so an identical retry of
-- an already-created historical order retains its original response.

begin;

create or replace function public.submit_website_order(
  p_request_id uuid,
  p_requested_delivery_date date,
  p_requested_delivery_time_from time,
  p_requested_delivery_time_to time,
  p_delivery_instructions text,
  p_customer_note text,
  p_lines jsonb
)
returns table (order_id bigint, order_number bigint, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_created_order record;
  v_existing_order_id bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required'
      using errcode = 'insufficient_privilege';
  end if;

  perform private.assert_order_lines_payload(p_lines);

  if not (select private.claim_order_operation(
    p_request_id,
    'website_submit',
    null,
    jsonb_build_object(
      'requested_delivery_date', p_requested_delivery_date,
      'requested_delivery_time_from', p_requested_delivery_time_from,
      'requested_delivery_time_to', p_requested_delivery_time_to,
      'delivery_instructions', nullif(btrim(p_delivery_instructions), ''),
      'customer_note', nullif(btrim(p_customer_note), ''),
      'lines', private.normalized_order_lines_payload(p_lines)
    )
  )) then
    v_existing_order_id := private.get_existing_operation_order(p_request_id, 'website_submit');
    if v_existing_order_id is null then
      raise exception 'The prior order submission did not complete'
        using errcode = 'serialization_failure';
    end if;

    return query
    select orders.id, orders.order_number, orders.status
    from public.orders as orders
    where orders.id = v_existing_order_id;
    return;
  end if;

  if p_requested_delivery_date is null then
    raise exception 'A requested delivery date is required for website orders'
      using errcode = 'not_null_violation';
  end if;

  select profile.*
  into v_profile
  from public.profiles as profile
  where profile.id = (select auth.uid())
  for update;

  if not found
    or v_profile.role <> 'client'
    or v_profile.approval_status <> 'approved'
    or v_profile.salon_client_id is null then
    raise exception 'Only approved clients linked to a salon can place website orders'
      using errcode = 'insufficient_privilege';
  end if;

  select *
  into v_created_order
  from private.create_order_with_snapshots(
    v_profile.salon_client_id,
    v_profile.id,
    'website',
    'NEW',
    p_requested_delivery_date,
    p_requested_delivery_time_from,
    p_requested_delivery_time_to,
    null,
    null,
    null,
    p_delivery_instructions,
    p_customer_note,
    p_lines,
    true
  );

  perform private.bind_created_order_to_operation(p_request_id, v_created_order.order_id);
  insert into public.order_notifications (order_id)
  values (v_created_order.order_id);
  perform private.record_order_status_event(
    v_created_order.order_id, null, 'NEW', null, p_request_id
  );

  return query select v_created_order.order_id, v_created_order.order_number, 'NEW'::text;
end;
$$;

revoke all on function public.submit_website_order(uuid, date, time, time, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_website_order(uuid, date, time, time, text, text, jsonb)
  to authenticated;

commit;
