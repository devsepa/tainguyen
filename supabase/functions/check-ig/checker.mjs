// Public Instagram endpoints are undocumented and may require login or block servers.
// A failed lookup is never evidence that an account is permanently dead.
export async function checkInstagram(input, fetcher = fetch) {
  const username = String(input.username || '').trim().replace(/^@+/, '').toLowerCase();
  const igId = String(input.igId || '').trim();
  if (igId && !/^\d{1,30}$/.test(igId)) return {status:'unknown',reason:'invalid_id'};
  if (!/^[a-z0-9._]{1,30}$/.test(username) && !igId) return {status:'unknown',reason:'invalid_username'};
  const headers = {'x-ig-app-id':'936619743392459','User-Agent':'Mozilla/5.0','Accept':'application/json'};
  async function lookup(url, byId) {
    try {
      const response = await fetcher(url, {headers, redirect:'manual', signal:AbortSignal.timeout(8000)});
      if (response.status === 404) return {status:'unknown',reason:'upstream_404'};
      if (!response.ok) return {status:'unknown',reason:response.status === 429 ? 'rate_limited' : 'upstream_'+response.status};
      const body = await response.json().catch(()=>null);
      const user = byId ? body?.user : body?.data?.user;
      if (user === null) return {status:'not_found',reason:'profile_not_found'};
      const id = String(user?.id || user?.pk || '');
      const name = String(user?.username || '').toLowerCase();
      if (!/^\d{1,30}$/.test(id) || !/^[a-z0-9._]{1,30}$/.test(name)) return {status:'unknown',reason:'unverified'};
      if ((igId && id !== igId) || (!byId && name !== username)) return {status:'unknown',reason:'identity_mismatch'};
      return {status:'live',igId:id,username:name,via:byId?'uid':'username'};
    } catch { return {status:'unknown',reason:'network_or_timeout'}; }
  }
  let byId;
  if (igId) {
    byId = await lookup(`https://i.instagram.com/api/v1/users/${encodeURIComponent(igId)}/info/`, true);
    if (byId.status === 'live') return byId;
  }
  if (!/^[a-z0-9._]{1,30}$/.test(username)) return byId || {status:'unknown',reason:'invalid_username'};
  const result = await lookup(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, false);
  if (igId && result.status === 'not_found') return {status:'unknown',reason:'identity_unresolved'};
  return result;
}

export function instagramPatch(account, result, now = new Date()) {
  const patch = {igCheck:{status:result.status,reason:result.reason || 'verified',at:now.toISOString()}};
  if (result.status === 'live') {
    patch.status = 'live';
    patch.checked = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    patch.igId = result.igId;
    patch.igUsername = result.username;
  }
  return patch;
}
