'use strict';

function parseMessageTime(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return NaN;
  const s = raw.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) {
    return Date.parse(s.replace(' ', 'T') + 'Z');
  }
  return Date.parse(s);
}

function selectOtp(messages, {email,since,seen,platform='instagram',now=Date.now()}) {
  const brandRe = platform === 'facebook' ? /facebook/i : /instagram/i;
  const codeRe = platform === 'facebook' ? /\b(?:FB-)?(\d{5,6})\b/gi : /\b(\d{6})\b/g;
  const matches = [];
  for (const m of messages) {
    const id = String(m.id ?? '');
    const time = parseMessageTime(m.created_at || '');
    if (!id || seen.has(id) || !Number.isFinite(time) || time < since - 30000 || time > now+60000) continue;
    const from = typeof m.from === 'object' ? m.from.address || '' : String(m.from || '');
    if (!/(?:^|[<\s])[^<>\s@]+@(?:[a-z0-9-]+\.)*(?:instagram\.com|facebookmail\.com)>?$/i.test(from.trim())) continue;
    const recipient = m.to ?? m.recipient;
    if (recipient) {
      const recipients = (Array.isArray(recipient) ? recipient : [recipient]).map(v=>typeof v === 'object' ? v.address || '' : String(v));
      if (!recipients.some(v=>v.toLowerCase().match(/[^<>\s,;]+@[^<>\s,;]+/g)?.includes(email.toLowerCase()))) continue;
    }
    const text = `${m.subject || ''} ${m.body || ''}`.replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
    if (!brandRe.test(text) || !/(?:code|confirm|verify|verification|mã|xác nhận|xác minh)/i.test(text)) continue;
    const codes = [...new Set([...text.matchAll(codeRe)].map(x=>x[1]))];
    if (codes.length === 1) matches.push({id,code:codes[0],time});
  }
  matches.sort((a,b)=>b.time-a.time);
  return matches.length ? {id:matches[0].id,code:matches[0].code} : null;
}

class Mailbox {
  constructor({email,accessKey},{fetch:fetchImpl=globalThis.fetch,signal}={}) {
    this.email=email; this.accessKey=accessKey; this.fetch=fetchImpl; this.signal=signal; this.client=null;
  }
  async post(route,values) {
    const signal = this.signal ? AbortSignal.any([this.signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    const response = await this.fetch('https://api.tempamail.com/v1/'+route,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values),signal});
    if (!response.ok) throw Error('Không đọc được hộp thư.');
    const data=await response.json();
    if (!data || data.error || data.success === false) throw Error('Không đọc được hộp thư.');
    return data;
  }
  async messages() {
    if (!this.client) {
      const data=await this.post('manage',{action:'access',email_uuid:this.accessKey,client_uuid:'unknown',app_uuid:'a5x-cj6a-ka1q'});
      if (!data.client?.uuid) throw Error('Access Key hộp thư không sử dụng được.');
      this.client=data.client.uuid;
    }
    const data=await this.post('messages',{client_uuid:this.client,email_uuid:this.accessKey,last_message_id:'0'});
    if (!Array.isArray(data.messages)) throw Error('Phản hồi hộp thư không hợp lệ.');
    return data.messages;
  }
  async snapshot() { return new Set((await this.messages()).map(m=>String(m.id))); }
  async findOtp(options) { return selectOtp(await this.messages(),{email:this.email,...options}); }
}
module.exports={Mailbox,selectOtp};
