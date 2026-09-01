create or replace function public.guard_deadline_dateless_anchor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_fij timestamptz; v_pub uuid;
begin
  v_pub := nullif(new.calculation_meta->>'pub_id','')::uuid;
  if v_pub is not null then
    select p.fecha_fijacion into v_fij from public.work_item_publicaciones p where p.id = v_pub;
    if v_fij is null then
      raise exception 'DATELESS_PUBLICACION_CANNOT_ANCHOR_TERM: publicacion % has no fecha_fijacion', v_pub
        using errcode = 'check_violation';
    end if;
  end if;
  if new.trigger_event = 'ESTADO_NUEVO' and new.trigger_date is null and new.deadline_date is not null then
    raise exception 'DATELESS_ANCHOR_FORBIDDEN: a term anchored on an estado requires a fijacion date'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_deadline_dateless_anchor on public.work_item_deadlines;
create trigger trg_guard_deadline_dateless_anchor
before insert or update on public.work_item_deadlines
for each row execute function public.guard_deadline_dateless_anchor();