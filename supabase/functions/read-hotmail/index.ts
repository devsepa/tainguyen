import {createHotmailHandler} from './handler.mjs';
// Platform JWT check is off; handler validates Auth user and membership before RLS lookup.
Deno.serve(createHotmailHandler({
  SUPABASE_URL:Deno.env.get('SUPABASE_URL')!,
  SUPABASE_ANON_KEY:Deno.env.get('SUPABASE_ANON_KEY')!,
  SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
}));
