import {createDomainMailHandler} from './handler.mjs';
Deno.serve(createDomainMailHandler({
  SUPABASE_URL:Deno.env.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY:Deno.env.get('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  DOMAIN_MAIL_INGEST_SECRET:Deno.env.get('DOMAIN_MAIL_INGEST_SECRET'),
  MAIL_DOMAIN:Deno.env.get('MAIL_DOMAIN') || 'devsepa.id.vn',
}));
