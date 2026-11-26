'use strict';

function normalizeImapConfig(config={}){
  const user=String(config.user||'').trim();
  const host=String(config.host||'').trim().toLowerCase()||(/@gmail\.com$/i.test(user)?'imap.gmail.com':/@(?:zoho|zohomail)\.com$/i.test(user)?'imap.zoho.com':'imappro.zoho.com');
  const rawPass=String(config.pass||'');
  return {user,host,port:Number(config.port||993),pass:host==='imap.gmail.com'?rawPass.replace(/\s/g,''):rawPass};
}

function parseProxy(raw = '', protocol = 'auto') {
  if (!['auto','http','https','socks5'].includes(protocol)) throw Error('Giao thức proxy không hợp lệ.');
  if (typeof raw !== 'string' || raw.length > 2048) throw Error('Proxy không hợp lệ.');
  if (!raw.trim()) return null;
  const match = raw.trim().match(/^([a-z0-9.-]+):(\d+)(?::([^:\s]+):(.+))?$/i);
  if (!match || /[\r\n\x00]/.test(raw)) throw Error('Proxy cần đúng định dạng host:port hoặc host:port:user:pass.');
  const port = Number(match[2]);
  if (port < 1 || port > 65535) throw Error('Port proxy phải từ 1 đến 65535.');
  return {host:match[1],port,username:match[3] || '',password:match[4] || '',protocol};
}

function validateInput(input, now = new Date()) {
  if (!input || typeof input !== 'object') throw Error('Thiếu dữ liệu đăng ký.');
  const platform = input.platform === 'facebook' ? 'facebook' : 'instagram';
  if (input.platform && !['instagram','facebook'].includes(input.platform)) throw Error('Nền tảng không hợp lệ.');
  const gender = input.gender === 'male' ? 'male' : 'female';
  const device = input.device === 'mobile' ? 'mobile' : 'desktop';
  const out = { platform, gender, device };
  for (const key of ['email','name','username','password','birthday']) {
    const val = key === 'username' && platform === 'facebook' && input[key] === undefined ? '' : input[key];
    if (typeof val !== 'string' || val.length > 254 || /[\r\n\x00]/.test(val)) throw Error('Dữ liệu đăng ký không hợp lệ.');
    out[key] = key === 'password' ? val : val.trim();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw Error('Email không hợp lệ.');
  if (!out.name || out.name.length > 100) throw Error('Nhập tên đầy đủ (tối đa 100 ký tự).');
  if (platform === 'instagram' || out.username) {
    if (!/^[a-z0-9._]{1,30}$/i.test(out.username)) throw Error('Username chỉ gồm chữ, số, dấu chấm và gạch dưới (tối đa 30 ký tự).');
  }
  if (out.password.length < 6) throw Error('Mật khẩu cần ít nhất 6 ký tự.');
  const dmY = out.birthday.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmY) out.birthday = `${dmY[3]}-${dmY[2].padStart(2,'0')}-${dmY[1].padStart(2,'0')}`;
  const date = new Date(out.birthday + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.birthday) || !Number.isFinite(+date) || date.toISOString().slice(0,10) !== out.birthday) throw Error('Ngày sinh không hợp lệ (định dạng dd/mm/yyyy).');
  const age = now.getUTCFullYear() - date.getUTCFullYear() - (now.toISOString().slice(5,10) < out.birthday.slice(5) ? 1 : 0);
  if (age < 13 || age > 120) throw Error('Ngày sinh cần đúng tuổi sử dụng Instagram.');
  const accessKey = input.accessKey || '';
  if (typeof accessKey !== 'string' || (accessKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accessKey))) throw Error('Access Key hộp thư không hợp lệ.');
  let imap = null;
  if (input.imap && typeof input.imap === 'object') {
    const {user,pass,host,port}=normalizeImapConfig(input.imap);
    if (user && pass) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || !/^[a-z0-9.-]+$/i.test(host) || port < 1 || port > 65535) throw Error('Cấu hình IMAP không hợp lệ.');
      imap = { host, port, user, pass };
    }
  }
  return {...out,email:out.email.toLowerCase(),accessKey,imap,proxy:parseProxy(input.proxy || '',input.protocol || 'auto')};
}

module.exports = {parseProxy,validateInput,normalizeImapConfig};
