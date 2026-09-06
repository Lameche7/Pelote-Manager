do $$
declare
  fn text;
begin
  select pg_get_functiondef(
    'public.admin_preview_championship_matches_update(uuid,jsonb)'::regprocedure
  ) into fn;
  if position('#variable_conflict use_variable' in fn) = 0 then
    fn := replace(
      fn,
      'AS $function$' || E'\n',
      'AS $function$' || E'\n#variable_conflict use_variable\n'
    );
    execute fn;
  end if;

  select pg_get_functiondef(
    'public.admin_apply_championship_matches_update(uuid,jsonb)'::regprocedure
  ) into fn;
  if position('#variable_conflict use_variable' in fn) = 0 then
    fn := replace(
      fn,
      'AS $function$' || E'\n',
      'AS $function$' || E'\n#variable_conflict use_variable\n'
    );
    execute fn;
  end if;
end;
$$;