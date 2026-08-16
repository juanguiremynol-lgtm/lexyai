do $$
declare hdr jsonb;
begin
  select (regexp_match(command, 'headers:=''(\{.*?\})'''))[1]::jsonb into hdr from cron.job where jobname='process-retry-queue-every-2min';
  perform net.http_post(url:='https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/sync-by-work-item', headers:=hdr, body:='{"work_item_id":"0fb48976-4c7e-477d-a131-3ca1c10d3440","_scheduled":true,"force_refresh":true,"allow_buscar":true}'::jsonb);
  perform net.http_post(url:='https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/sync-publicaciones-by-work-item', headers:=hdr, body:='{"work_item_id":"0fb48976-4c7e-477d-a131-3ca1c10d3440","_scheduled":true,"force_refresh":true}'::jsonb);
end $$;