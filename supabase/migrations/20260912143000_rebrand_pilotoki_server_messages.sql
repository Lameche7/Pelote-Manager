do $$
declare
  fn record;
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_functiondef(p.oid) like '%Pelote Manager%'
  loop
    execute replace(
      pg_get_functiondef(fn.oid),
      'Pelote Manager',
      'PILOTOKI'
    );
  end loop;
end;
$$;
