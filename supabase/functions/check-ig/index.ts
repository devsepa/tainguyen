import {createHandler} from './handler.mjs';
// The handler verifies user sessions and membership, or the dedicated Vault token.
Deno.serve(createHandler({
  SUPABASE_URL:Deno.env.get('SUPABASE_URL')!,
  SUPABASE_ANON_KEY:Deno.env.get('SUPABASE_ANON_KEY')!,
  SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
}));
