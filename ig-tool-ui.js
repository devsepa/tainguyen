(function(global){
  'use strict';
  const ACTIVE_STATES=new Set(['starting','working','waiting_otp','verifying','paused','stopping']);
  const STATE_LABEL={
    idle:'Sẵn sàng',
    starting:'Đang khởi tạo',
    working:'Đang thao tác',
    waiting_otp:'Chờ mã OTP',
    verifying:'Đang xác nhận OTP',
    paused:'Tạm dừng',
    stopping:'Đang dừng',
    succeeded:'Thành công',
    failed:'Thất bại',
    cancelled:'Đã dừng',
  };

  function esc(v){
    return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  const STORAGE_KEY='ig_tool_local_draft_v1';
  const DEFAULT_IMAP_USER='nguyenduynd1805@gmail.com';
  function mailboxDefaults(prefs){
    const next={...prefs};
    const user=String(next.imapUser||'').trim();
    if(!user||user.toLowerCase()==='contact@devsepa.id.vn'){
      next.imapUser=DEFAULT_IMAP_USER;
      next.imapPass='';
    }
    return next;
  }
  const FIRST_NAMES=['Nguyen','Tran','Le','Pham','Hoang','Huynh','Phan','Vu','Vo','Dang','Bui','Do','Ho','Ngo','Duong'];
  const MID_NAMES=['Minh','Gia','Thao','Ngoc','Quoc','Khanh','Hoang','Duc','Thanh','Anh','Bao','Tuan','Hai','Linh'];
  const LAST_NAMES=['Anh','Huy','Vy','Linh','Nam','Bao','Han','Trang','Khang','Phuc','Nhi','Quan','Tu','My','Khoa'];
  function pick(arr){return arr[Math.floor(Math.random()*arr.length)];}
  function randomBirthday(){
    const nowYear=new Date().getFullYear();
    const y=nowYear-23-Math.floor(Math.random()*15);
    const m=String(1+Math.floor(Math.random()*12)).padStart(2,'0');
    const d=String(1+Math.floor(Math.random()*28)).padStart(2,'0');
    return `${d}/${m}/${y}`;
  }
  function randomIdentity(){
    const first=pick(FIRST_NAMES),mid=pick(MID_NAMES),last=pick(LAST_NAMES);
    const num=Math.floor(1000+Math.random()*9000);
    const sep=Math.random()<0.5?'.':'_';
    const base=`${mid}${last}`.toLowerCase();
    const shortNum=Math.random()<0.35?'':String(Math.floor(1+Math.random()*98));
    const mailSep=Math.random()<0.4?'.':'';
    const mailLocal=`${mid.toLowerCase()}${mailSep}${last.toLowerCase()}${shortNum}`;
    return {name:`${first} ${mid} ${last}`,username:`${base}${sep}${num}`,mailLocal};
  }
  function readSavedDraft(storage){
    try{
      const raw=storage?.getItem(STORAGE_KEY);
      return raw?JSON.parse(raw):{};
    }catch{return {};}
  }
  function writeSavedDraft(storage,data){
    try{storage?.setItem(STORAGE_KEY,JSON.stringify(data));}catch{}
  }

  function mount(element,{canWrite=false,mails=[],generateMail,openInbox,save,fetchImpl=global.fetch?.bind(global),pollMs=1000}={}){
    if(!element)throw Error('Thiếu vùng hiển thị IG Tool.');
    const readWritable=()=>typeof canWrite==='function'?!!canWrite():!!canWrite;
    const readMails=()=>{
      const list=typeof mails==='function'?mails():mails;
      return Array.isArray(list)?list:[];
    };

    let token='';
    let destroyed=false;
    let pollTimer=null;
    let prefsTimer=null;
    let dirtyKeys=new Set();
    let jobs=[];
    let isLegacySingle=false;
    let otpDrafts={};
    let twofaDrafts={};
    let twofaCodes={};
    let genKeysByEmail={};
    let saveQueue=Promise.resolve();
    let serverError='';
    let proxyDiag=null;
    let imapDiag=null;
    let imapMsgs=null;
    let imapReadEmail='';
    let activeMailAction=null;
    let busyAction=false;
    let lastStatusKey='';
    const saved=mailboxDefaults(readSavedDraft(global.localStorage));
    const proxyHistory=Array.isArray(saved.proxyHistory)?saved.proxyHistory.filter(x=>typeof x==='string'&&x.trim()):[];
    const initId=randomIdentity();
    const initDomain=typeof saved.zohoDomain==='string'&&saved.zohoDomain?saved.zohoDomain:'devsepa.id.vn';
    let draft={
      platform:['instagram','facebook'].includes(saved.platform)?saved.platform:'instagram',
      device:['mobile','mobile-webkit','desktop'].includes(saved.device)?saved.device:'desktop',
      gender:['female','male'].includes(saved.gender)?saved.gender:'female',
      mailMode:['warehouse','tempamail','zoho'].includes(saved.mailMode)?saved.mailMode:'warehouse',
      tempType:['other','edu'].includes(saved.tempType)?saved.tempType:'other',
      genEmail:typeof saved.genEmail==='string'?saved.genEmail:'',
      genKey:typeof saved.genKey==='string'?saved.genKey:'',
      zohoDomain:initDomain,
      customEmail:`${initId.mailLocal}@${initDomain}`,
      imapUser:saved.imapUser,
      imapPass:typeof saved.imapPass==='string'?saved.imapPass:'',
      email:'',
      accessKey:'',
      name:initId.name,
      username:initId.username,
      password:'nguyenduy1805',
      birthday:randomBirthday(),
      proxy:typeof saved.proxy==='string'?saved.proxy:'',
      proxyPool:typeof saved.proxyPool==='string'?saved.proxyPool:'',
      useProxy:saved.useProxy!==false,
      protocol:['auto','http','socks5'].includes(saved.protocol)?saved.protocol:'auto',
      otp:'',
    };

    const pickBestWarehouseMail=(list,plat,inUse=new Set())=>{
      const ok=m=>!m.usedOn?.[plat]&&!inUse.has(String(m.email||'').trim().toLowerCase());
      return list.find(m=>ok(m)&&!!m.accessKey)||list.find(ok)||list[0]||null;
    };
    const mailList=readMails();
    const pickAvailableMail=(plat)=>{
      const cur=mailList.find(m=>m.email===draft.email&&!m.usedOn?.[plat]);
      if(cur&&cur.accessKey)return cur;
      return pickBestWarehouseMail(mailList,plat);
    };
    const initMail=pickAvailableMail(draft.platform);
    if(initMail){
      draft.email=initMail.email||'';
      draft.accessKey=initMail.accessKey||'';
    }

    async function ensureToken(){
      if(token)return token;
      const res=await fetchImpl('/api/ig-tool/session',{headers:{'X-IG-Tool-Client':'1'}});
      if(!res.ok)throw Error('Không kết nối được máy chủ IG Tool cục bộ.');
      const data=await res.json();
      if(!data?.token)throw Error('Phiên IG Tool không hợp lệ.');
      token=data.token;
      return token;
    }

    async function api(path,options={}){
      const tok=await ensureToken();
      const headers={...(options.headers||{}),'X-IG-Tool-Token':tok};
      if(options.body!==undefined)headers['Content-Type']='application/json';
      const res=await fetchImpl(path,{...options,headers});
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(data.error||`Lỗi máy chủ (${res.status}).`);
      return data;
    }

    function saveDraftPrefs(){
      const p=draft.proxy.trim();
      const nextHistory=p?[p,...proxyHistory.filter(x=>x!==p)].slice(0,5):proxyHistory;
      proxyHistory.splice(0,proxyHistory.length,...nextHistory);
      const payload={
        platform:draft.platform,
        device:draft.device,
        gender:draft.gender,
        mailMode:draft.mailMode,
        tempType:draft.tempType,
        genEmail:draft.genEmail,
        genKey:draft.genKey,
        zohoDomain:draft.zohoDomain,
        imapUser:draft.imapUser,
        imapPass:draft.imapPass,
        birthday:draft.birthday,
        proxy:draft.proxy,
        proxyPool:draft.proxyPool,
        useProxy:draft.useProxy,
        protocol:draft.protocol,
        proxyHistory:nextHistory,
      };
      writeSavedDraft(global.localStorage,payload);
      if(prefsTimer)global.clearTimeout(prefsTimer);
      prefsTimer=global.setTimeout(()=>{
        if(!destroyed)void api('/api/ig-tool/prefs',{method:'POST',body:JSON.stringify(payload)}).catch(()=>{});
      },250);
    }

    async function loadServerPrefs(){
      try{
        const rawPrefs=await api('/api/ig-tool/prefs');
        const p=mailboxDefaults(rawPrefs);
        if(!p||typeof p!=='object'||destroyed)return;
        for(const k of ['platform','device','gender','mailMode','tempType','zohoDomain','imapUser','imapPass','proxy','proxyPool','protocol']){
          if((k==='imapUser'||k==='imapPass')&&(dirtyKeys.has('imapUser')||dirtyKeys.has('imapPass')))continue;
          if(k==='imapUser'||k==='imapPass'){
            const serverUser=String(rawPrefs?.imapUser||'').trim().toLowerCase();
            if((!serverUser||serverUser==='contact@devsepa.id.vn')&&draft.imapUser.toLowerCase()!==DEFAULT_IMAP_USER)continue;
          }
          if(typeof p[k]==='string'&&p[k]&&!dirtyKeys.has(k)){
            draft[k]=p[k];
            const el=element.querySelector(`[data-ig="${k}"]`);
            if(el&&el.value!==p[k])el.value=p[k];
          }
        }
        render();
      }catch{}
    }

    function captureInputs(e){
      if(e?.target?.dataset?.ig)dirtyKeys.add(e.target.dataset.ig);
      for(const key of ['platform','device','gender','mailMode','tempType','genEmail','zohoDomain','customEmail','imapUser','imapPass','email','name','username','password','birthday','proxy','proxyPool','protocol','otp']){
        const el=element.querySelector(`[data-ig="${key}"]`);
        if(el)draft[key]=el.value;
      }
      const upEl=element.querySelector('[data-ig="useProxy"]');
      if(upEl)draft.useProxy=!!upEl.checked;
      const selected=readMails().find(m=>m.email===draft.email);
      draft.accessKey=selected?.accessKey||'';
      saveDraftPrefs();
    }

    function renderMailOptions(){
      const list=readMails();
      const plat=draft.platform;
      const platName=plat==='facebook'?'FB':'IG';
      if(!list.length)return '<option value="">Chưa có email trong kho</option>';
      const inUseSet=new Set(jobs.map(j=>String(j.email||'').trim().toLowerCase()).filter(Boolean));
      return list.map(m=>{
        const used=!!m.usedOn?.[plat];
        const running=inUseSet.has(String(m.email||'').trim().toLowerCase());
        const tag=used?`Đã sử dụng (${platName})`:running?'Đang chạy ở phiên khác':(m.accessKey?'Auto OTP':'OTP thủ công');
        return `<option value="${esc(m.email)}" ${m.email===draft.email?'selected':''} ${used?'disabled':''}>${esc(m.email)} (${tag})</option>`;
      }).join('');
    }

    function renderFormShell(){
      const writable=readWritable();
      element.innerHTML=`
        <div class="ig-tool-shell">
          <div class="ig-tool-topbar">
            <div class="ig-tool-actions">
              <span class="ig-tool-badge"><span style="color:#2fbf71">●</span> <span data-ig-slot="top-count">0/2 phiên đang chạy</span></span>
            </div>
            <div class="ig-tool-actions">
              <button type="button" data-act="open-zoho-inbox">📬 Mở hòm thư tổng</button>
              <button type="button" data-act="toggle-config">⚙️ Cấu hình cố định</button>
            </div>
          </div>

          <div class="ig-tool-grid">
            <section class="ig-tool-card">
              <h3>Chạy phiên mới</h3>
              <div data-ig-slot="readonly-banner">${!writable?'<div class="ig-tool-banner">Bạn đang ở chế độ Chỉ xem. Không thể chạy tạo tài khoản hoặc lưu vào kho.</div>':''}</div>
              <div data-ig-slot="error-banner"></div>

              <div class="ig-tool-actions" style="justify-content:space-between;gap:10px">
                <div class="ig-tool-field">
                  <label>Nền tảng</label>
                  <div class="ig-tool-pills">
                    <button type="button" data-act="set-pill" data-key="platform" data-val="instagram" aria-pressed="${draft.platform==='instagram'}">Instagram</button>
                    <button type="button" data-act="set-pill" data-key="platform" data-val="facebook" aria-pressed="${draft.platform==='facebook'}">Facebook</button>
                  </div>
                  <select id="ig-platform" data-ig="platform" hidden>
                    <option value="instagram" ${draft.platform==='instagram'?'selected':''}>Instagram</option>
                    <option value="facebook" ${draft.platform==='facebook'?'selected':''}>Facebook</option>
                  </select>
                </div>
                <div class="ig-tool-field">
                  <label>Chế độ</label>
                  <div class="ig-tool-pills">
                    <button type="button" data-act="set-pill" data-key="device" data-val="mobile" aria-pressed="${draft.device==='mobile'}">Mobile (iPhone 16)</button>
                    <button type="button" data-act="set-pill" data-key="device" data-val="mobile-webkit" aria-pressed="${draft.device==='mobile-webkit'}">iPhone 16 · WebKit</button>
                    <button type="button" data-act="set-pill" data-key="device" data-val="desktop" aria-pressed="${draft.device==='desktop'}">Desktop</button>
                  </div>
                  <select id="ig-device" data-ig="device" hidden>
                    <option value="mobile" ${draft.device==='mobile'?'selected':''}>Mobile (iPhone 16 · Chromium)</option>
                    <option value="mobile-webkit" ${draft.device==='mobile-webkit'?'selected':''}>Mobile (iPhone 16 · WebKit)</option>
                    <option value="desktop" ${draft.device==='desktop'?'selected':''}>Desktop (Máy tính)</option>
                  </select>
                </div>
                <div class="ig-tool-field" data-ig-slot="gender-field" ${draft.platform==='facebook'?'':'style="display:none"'}>
                  <label>Giới tính</label>
                  <div class="ig-tool-pills">
                    <button type="button" data-act="set-pill" data-key="gender" data-val="male" aria-pressed="${draft.gender==='male'}">Nam</button>
                    <button type="button" data-act="set-pill" data-key="gender" data-val="female" aria-pressed="${draft.gender==='female'}">Nữ</button>
                  </div>
                  <select id="ig-gender" data-ig="gender" hidden>
                    <option value="female" ${draft.gender==='female'?'selected':''}>Nữ</option>
                    <option value="male" ${draft.gender==='male'?'selected':''}>Nam</option>
                  </select>
                </div>
              </div>

              <div class="ig-tool-field">
                <label for="ig-mail-mode">Nguồn Email</label>
                <select id="ig-mail-mode" data-ig="mailMode">
                  <option value="warehouse" ${draft.mailMode==='warehouse'?'selected':''}>Email từ kho (Kho Gmail)</option>
                  <option value="tempamail" ${draft.mailMode==='tempamail'?'selected':''}>Tạo mới Tempamail (Dùng tới đâu tạo tới đó)</option>
                  <option value="zoho" ${draft.mailMode==='zoho'?'selected':''}>Domain riêng (Gmail / Zoho IMAP Auto OTP)</option>
                </select>
              </div>

              <div class="ig-tool-stack" data-ig-slot="tempamail-mail" style="display:${draft.mailMode==='tempamail'?'flex':'none'}">
                <div class="ig-tool-row">
                  <div class="ig-tool-field">
                    <label for="ig-temp-type">Loại Tempamail</label>
                    <select id="ig-temp-type" data-ig="tempType">
                      <option value="other" ${draft.tempType==='other'?'selected':''}>Temp Mail thường</option>
                      <option value="edu" ${draft.tempType==='edu'?'selected':''}>Temp EDU (.edu.pl)</option>
                    </select>
                  </div>
                  <div class="ig-tool-field">
                    <label for="ig-gen-email">Email vừa tạo</label>
                    <div class="ig-tool-inline">
                      <input id="ig-gen-email" data-ig="genEmail" type="text" readonly value="${esc(draft.genEmail)}" placeholder="Tự tạo khi bấm Bắt đầu" />
                      <button type="button" data-act="gen-mail">Tạo mới</button>
                    </div>
                  </div>
                </div>
                <div class="ig-tool-actions">
                  <button type="button" data-act="open-gen-inbox" data-ig-slot="gen-mail-link" style="display:${draft.genKey?'inline-flex':'none'};align-items:center;gap:5px;border-color:#2fbf71;color:#2fbf71">Hộp thư &amp; OTP</button>
                </div>
              </div>

              <div class="ig-tool-field" data-ig-slot="warehouse-mail" ${draft.mailMode==='zoho'||draft.mailMode==='tempamail'?'style="display:none"':''}>
                <label for="ig-mail-select">Email từ kho</label>
                <select id="ig-mail-select" data-ig="email">
                  ${renderMailOptions()}
                </select>
              </div>

              <div class="ig-tool-field" data-ig-slot="zoho-mail" style="display:${draft.mailMode==='zoho'?'flex':'none'}">
                <label for="ig-custom-email">Email đăng ký (tự sinh hoặc tự nhập)</label>
                <div class="ig-tool-inline">
                  <input id="ig-custom-email" data-ig="customEmail" type="text" autocomplete="off" value="${esc(draft.customEmail)}" placeholder="ten@devsepa.id.vn" />
                  <button type="button" data-act="tweak-email">🎲 Đổi</button>
                  <button type="button" data-act="read-imap">Đọc thư</button>
                </div>
                <div class="ig-tool-meta" data-ig-slot="imap-diag"></div>
              </div>

              <div class="ig-tool-section-head">
                <label>Danh tính tài khoản</label>
                <button type="button" data-act="randomize" style="padding:3px 9px;font-size:12px">🎲 Random</button>
              </div>
              <div class="ig-tool-row">
                <div class="ig-tool-field">
                  <label for="ig-name">Tên đầy đủ</label>
                  <input id="ig-name" name="ig_full_name" data-ig="name" type="text" autocomplete="off" value="${esc(draft.name)}" placeholder="Ví dụ: Nguyen Van A" />
                </div>
                <div class="ig-tool-field" data-ig-slot="username-field" ${draft.platform==='facebook'?'style="display:none"':''}>
                  <label for="ig-username">Username</label>
                  <input id="ig-username" name="ig_new_username" data-ig="username" type="text" autocomplete="off" value="${esc(draft.username)}" placeholder="vd_username_01" />
                </div>
                <div class="ig-tool-field">
                  <label for="ig-password">Mật khẩu</label>
                  <input id="ig-password" name="ig_new_password" data-ig="password" type="password" autocomplete="new-password" value="${esc(draft.password)}" placeholder="Ít nhất 6 ký tự" />
                </div>
                <div class="ig-tool-field">
                  <label for="ig-birthday">Ngày sinh (dd/mm/yyyy)</label>
                  <input id="ig-birthday" name="ig_birthday" data-ig="birthday" type="text" autocomplete="off" value="${esc(draft.birthday)}" placeholder="15/01/2000" />
                </div>
              </div>

              <div class="ig-tool-field">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <label for="ig-proxy">Proxy phiên này (tuỳ chọn)</label>
                  <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;color:${draft.useProxy?'#2fbf71':'var(--muted)'}">
                    <input type="checkbox" data-ig="useProxy" ${draft.useProxy?'checked':''} style="width:auto;margin:0" /> Dùng Proxy
                  </label>
                </div>
                <div class="ig-tool-inline">
                  <input id="ig-proxy" name="ig_proxy" data-ig="proxy" type="text" list="ig-proxy-history" autocomplete="off" value="${esc(draft.proxy)}" placeholder="1.2.3.4:8000:user:pass" />
                  <button type="button" data-act="pick-proxy">🎲 Đổi</button>
                  <button type="button" data-act="test-proxy">Kiểm tra</button>
                </div>
                <datalist id="ig-proxy-history">${proxyHistory.map(p=>`<option value="${esc(p)}"></option>`).join('')}</datalist>
              </div>
              <div class="ig-tool-meta" data-ig-slot="proxy-diag"></div>

              <button type="button" class="primary ig-tool-cta" data-act="start">▶ Bắt đầu tạo tài khoản</button>

              <details class="ig-tool-details" data-ig-slot="fixed-config">
                <summary data-ig-slot="config-summary">⚙️ Cấu hình cố định</summary>
                <div class="ig-tool-stack">
                  <div class="ig-tool-row">
                    <div class="ig-tool-field">
                      <label for="ig-zoho-domain">Domain riêng</label>
                      <input id="ig-zoho-domain" data-ig="zohoDomain" type="text" autocomplete="off" value="${esc(draft.zohoDomain)}" placeholder="devsepa.id.vn" />
                    </div>
                    <div class="ig-tool-field">
                      <label for="ig-protocol">Giao thức proxy</label>
                      <select id="ig-protocol" data-ig="protocol">
                        <option value="auto" ${draft.protocol==='auto'?'selected':''}>Tự phát hiện (HTTP / SOCKS5)</option>
                        <option value="http" ${draft.protocol==='http'?'selected':''}>HTTP</option>
                        <option value="socks5" ${draft.protocol==='socks5'?'selected':''}>SOCKS5</option>
                      </select>
                    </div>
                  </div>
                  <div class="ig-tool-row">
                    <div class="ig-tool-field">
                      <label for="ig-imap-user">Hộp thư tổng IMAP (Gmail / Zoho)</label>
                      <input id="ig-imap-user" data-ig="imapUser" type="text" autocomplete="off" value="${esc(draft.imapUser)}" placeholder="mailphu@gmail.com hoặc contact@domain" />
                    </div>
                    <div class="ig-tool-field">
                      <label for="ig-imap-pass">App Password (Gmail / Zoho)</label>
                      <input id="ig-imap-pass" data-ig="imapPass" type="password" autocomplete="new-password" value="${esc(draft.imapPass)}" placeholder="Mật khẩu ứng dụng 16 ký tự" />
                    </div>
                  </div>
                  <div class="ig-tool-actions">
                    <button type="button" data-act="test-imap">Kiểm tra IMAP</button>
                  </div>
                  <div class="ig-tool-field">
                    <label for="ig-proxy-pool">Danh sách Proxy xoay vòng (<span data-ig-slot="proxy-count">0</span>)</label>
                    <textarea id="ig-proxy-pool" data-ig="proxyPool" rows="3" placeholder="Mỗi dòng 1 proxy: host:port:user:pass" style="font-family:var(--mono);font-size:12px">${esc(draft.proxyPool)}</textarea>
                    <div class="ig-tool-actions" style="margin-top:4px">
                      <button type="button" data-act="filter-proxies">⚡ Lọc proxy sống</button>
                    </div>
                  </div>
                </div>
              </details>
            </section>

            <section class="ig-tool-card" data-ig-slot="status-card">
              <h3>Tiến trình &amp; Kết quả</h3>
              <div data-ig-slot="status-body"></div>
            </section>
          </div>
        </div>
      `;
    }

    function syncFormControls(){
      const writable=readWritable();
      const anyActive=jobs.some(j=>ACTIVE_STATES.has(j.state));
      const atCapacity=isLegacySingle
        ?(ACTIVE_STATES.has(jobs[0]?.state)||(jobs[0]?.state==='succeeded'&&!jobs[0]?.saved))
        :jobs.length>=2;
      const lockInputs=!writable||atCapacity;

      for(const key of ['platform','device','gender','mailMode','tempType','zohoDomain','customEmail','imapUser','imapPass','email','name','username','password','birthday','proxy','proxyPool','protocol']){
        const el=element.querySelector(`[data-ig="${key}"]`);
        if(el){
          el.disabled=(key==='customEmail'&&isLegacySingle&&jobs[0]?.state==='paused')?!writable:(key==='proxy'?(lockInputs||!draft.useProxy):lockInputs);
          if(el.tagName==='SELECT'&&el.value!==draft[key])el.value=draft[key];
        }
      }
      const upEl=element.querySelector('[data-ig="useProxy"]');
      if(upEl){
        upEl.disabled=lockInputs;
        upEl.checked=!!draft.useProxy;
      }
      element.querySelectorAll('button[data-act="set-pill"]').forEach(b=>{
        const k=b.dataset.key,v=b.dataset.val;
        b.disabled=lockInputs;
        b.setAttribute('aria-pressed',String(draft[k]===v));
      });
      const poolCount=parseProxyPool().length;
      const poolCountEl=element.querySelector('[data-ig-slot="proxy-count"]');
      if(poolCountEl)poolCountEl.textContent=String(poolCount);
      const topCountEl=element.querySelector('[data-ig-slot="top-count"]');
      if(topCountEl)topCountEl.textContent=`${jobs.length}/2 phiên đang chạy`;
      const cfgSumEl=element.querySelector('[data-ig-slot="config-summary"]');
      if(cfgSumEl){
        const imapLabel=draft.imapUser?draft.imapUser:'Chưa cài IMAP';
        cfgSumEl.textContent=`⚙️ Cấu hình cố định: ${imapLabel} · ${poolCount} Proxy xoay vòng`;
      }
      const userSlot=element.querySelector('[data-ig-slot="username-field"]');
      const genderSlot=element.querySelector('[data-ig-slot="gender-field"]');
      const whSlot=element.querySelector('[data-ig-slot="warehouse-mail"]');
      const tmSlot=element.querySelector('[data-ig-slot="tempamail-mail"]');
      const zohoSlot=element.querySelector('[data-ig-slot="zoho-mail"]');
      if(userSlot)userSlot.style.display=draft.platform==='facebook'?'none':'';
      if(genderSlot)genderSlot.style.display=draft.platform==='facebook'?'':'none';
      if(whSlot)whSlot.style.display=draft.mailMode==='warehouse'?'':'none';
      if(tmSlot)tmSlot.style.display=draft.mailMode==='tempamail'?'flex':'none';
      if(zohoSlot)zohoSlot.style.display=draft.mailMode==='zoho'?'flex':'none';
      const protoEl=element.querySelector('[data-ig="protocol"]');
      if(protoEl&&protoEl.value!==draft.protocol)protoEl.value=draft.protocol;

      const mailSelect=element.querySelector('[data-ig="email"]');
      const currentMail=readMails().find(m=>m.email===draft.email);
      const selectedUsed=!!currentMail?.usedOn?.[draft.platform];
      if(mailSelect){
        const optsHtml=renderMailOptions();
        if(mailSelect.dataset.plat!==draft.platform||mailSelect.innerHTML!==optsHtml){
          mailSelect.dataset.plat=draft.platform;
          mailSelect.innerHTML=optsHtml;
          if(selectedUsed){
            const inUse=new Set(jobs.map(j=>String(j.email||'').trim().toLowerCase()).filter(Boolean));
            const avail=pickBestWarehouseMail(readMails(),draft.platform,inUse);
            if(avail){draft.email=avail.email;draft.accessKey=avail.accessKey||'';mailSelect.value=avail.email;}
          }
        }
      }
      const mailAfter=readMails().find(m=>m.email===draft.email);
      const isMailUsed=draft.mailMode==='warehouse'&&!!mailAfter?.usedOn?.[draft.platform];
      const chosenEmail=(draft.mailMode==='zoho'?draft.customEmail:draft.mailMode==='tempamail'?draft.genEmail:draft.email).trim().toLowerCase();
      const dupIdx=chosenEmail?jobs.findIndex(j=>String(j.email||'').trim().toLowerCase()===chosenEmail):-1;
      const isMailInUse=dupIdx>=0;

      const btnRand=element.querySelector('button[data-act="randomize"]');
      const btnPickProxy=element.querySelector('button[data-act="pick-proxy"]');
      const btnFilterProxies=element.querySelector('button[data-act="filter-proxies"]');
      const btnGenMail=element.querySelector('button[data-act="gen-mail"]');
      const btnTweak=element.querySelector('button[data-act="tweak-email"]');
      const btnTest=element.querySelector('button[data-act="test-proxy"]');
      const btnTestImap=element.querySelector('button[data-act="test-imap"]');
      const btnReadImap=element.querySelector('button[data-act="read-imap"]');
      const btnStart=element.querySelector('button[data-act="start"]');
      const btnStop=element.querySelector('button[data-act="stop"]');
      if(btnRand)btnRand.disabled=lockInputs||busyAction;
      if(btnPickProxy)btnPickProxy.disabled=lockInputs||busyAction||!draft.useProxy||!parseProxyPool().length;
      if(btnFilterProxies)btnFilterProxies.disabled=lockInputs||busyAction||!parseProxyPool().length;
      if(btnGenMail)btnGenMail.disabled=lockInputs||busyAction;
      const genLink=element.querySelector('[data-ig-slot="gen-mail-link"]');
      if(genLink)genLink.style.display=draft.genKey?'inline-flex':'none';
      if(btnTweak)btnTweak.disabled=lockInputs||busyAction;
      if(btnTest)btnTest.disabled=lockInputs||busyAction||!draft.useProxy;
      if(btnTestImap)btnTestImap.disabled=lockInputs||busyAction;
      if(btnReadImap)btnReadImap.disabled=lockInputs||busyAction;
      if(btnReadImap)btnReadImap.textContent=activeMailAction==='read-imap'?'Đang mở hộp thư…':'Đọc thư email này';
      if(btnTestImap)btnTestImap.textContent=activeMailAction==='test-imap'?'Đang kiểm tra…':'Kiểm tra IMAP';
      if(btnStart)btnStart.disabled=lockInputs||!writable||busyAction||isMailUsed||isMailInUse;
      if(btnStop)btnStop.disabled=!anyActive||busyAction;

      const imapDiagSlot=element.querySelector('[data-ig-slot="imap-diag"]');
      if(imapDiagSlot){
        if(imapMsgs){
          imapDiagSlot.innerHTML=imapMsgs.length
            ?imapMsgs.map(m=>`<div style="width:100%;border-top:1px solid var(--line);padding-top:4px"><b>${esc(m.subject||'(Không tiêu đề)')}</b> · ${esc(m.from)}<br><span>${esc(m.snippet)}</span></div>`).join('')
            :`Chưa có thư gửi tới ${esc(imapReadEmail||draft.customEmail)} trong các thư gần nhất. Bấm Mở hòm thư tổng để xem các địa chỉ khác.`;
        }else{
          imapDiagSlot.textContent=imapDiag||'';
        }
      }

      const errSlot=element.querySelector('[data-ig-slot="error-banner"]');
      const usedMsg=isMailUsed?`Email ${draft.email} đã được sử dụng cho ${draft.platform==='facebook'?'Facebook':'Instagram'}. Hãy chọn email khác.`:'';
      const dupJob=isMailInUse?jobs[dupIdx]:null;
      const dupState=dupJob?(STATE_LABEL[dupJob.state]||dupJob.state):'';
      const dupMsg=isMailInUse?`Email ${chosenEmail} đang được giữ bởi Phiên ${dupIdx+1} (${dupState}). Hãy bấm "🎲 Đổi" email hoặc bấm "Đóng phiên" ở Phiên ${dupIdx+1}.`:'';
      const bannerMsg=serverError||usedMsg||dupMsg;
      if(errSlot)errSlot.innerHTML=bannerMsg?`<div class="ig-tool-banner">${esc(bannerMsg)}</div>`:'';

      const diagSlot=element.querySelector('[data-ig-slot="proxy-diag"]');
      if(diagSlot)diagSlot.textContent=proxyDiag||'';
    }

    function renderJobCard(job,idx,total){
      const writable=readWritable();
      const jid=job.id||'';
      const okey=jid||'_single';
      const unsaved=job.state==='succeeded'&&!job.saved;
      const stateText=STATE_LABEL[job.state]||job.state||'Sẵn sàng';
      const active=ACTIVE_STATES.has(job.state);
      let inboxHref='';
      let inboxKey='';
      if(job.email){
        const emLower=String(job.email||'').toLowerCase();
        const matchedMail=readMails().find(m=>String(m.email||'').toLowerCase()===emLower);
        inboxKey=matchedMail?.accessKey||genKeysByEmail[emLower]||(draft.genEmail&&draft.genEmail.toLowerCase()===emLower?draft.genKey:'');
        if(inboxKey)inboxHref=`https://tempamail.com/access?key=${encodeURIComponent(inboxKey)}`;
        else if(draft.mailMode==='zoho'||(draft.zohoDomain&&emLower.endsWith('@'+draft.zohoDomain.trim().toLowerCase())))inboxHref=/@gmail\.com$/i.test(draft.imapUser.trim())?'https://mail.google.com':'https://mail.zoho.com';
        else if(emLower.endsWith('@gmail.com'))inboxHref='https://mail.google.com';
      }
      const inboxActionHtml=((inboxKey||inboxHref)&&typeof openInbox==='function')
        ?`<button type="button" data-act="open-status-inbox" data-job-id="${esc(jid)}" style="padding:3px 9px;border:1px solid #2fbf71;color:#2fbf71;border-radius:6px;font-size:12px">Hộp thư &amp; OTP</button>`
        :(inboxHref?`<a href="${esc(inboxHref)}" target="_blank" rel="noopener noreferrer" class="mini link" style="padding:2px 8px;border:1px solid var(--line);border-radius:6px;text-decoration:none;font-size:11.5px">Mở hộp thư ↗</a>`:'');

      return `
        <div class="ig-tool-job-card" data-job-id="${esc(jid)}" style="${total>1?'border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:10px':''}">
          <div class="ig-tool-status" data-state="${esc(job.state||'idle')}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:8px">
                ${total>1||jid?`<span class="ig-tool-badge" style="opacity:.8">Phiên ${idx+1}${total>1?(idx===0?' (Cửa sổ Trái)':' (Cửa sổ Phải)'):''}</span>`:''}
                <span class="ig-tool-badge">${esc(stateText)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                ${jid&&(active||job.state==='succeeded')?`<button type="button" data-act="copy-cookie" data-job-id="${esc(jid)}" style="padding:3px 10px;font-size:12px" ${busyAction?'disabled':''}>Copy Cookie</button>`:''}
                ${jid&&(active||job.state==='succeeded'||job.state==='failed')?`<button type="button" class="danger" data-act="stop" data-job-id="${esc(jid)}" style="padding:3px 10px;font-size:12px" ${busyAction?'disabled':''}>${active?'Dừng phiên':'Đóng phiên'}</button>`:''}
              </div>
            </div>
            <div>${esc(job.message||'')}</div>
            ${job.email?`<div class="ig-tool-meta" style="align-items:center"><span>Email: ${esc(job.email)}</span>${inboxActionHtml}${job.otp?`<span>OTP: <b>${esc(job.otp)}</b></span>`:''}</div>`:''}
            ${job.protocol||job.ip?`<div class="ig-tool-meta"><span>Giao thức: ${esc(job.protocol||'—')}</span><span>IP: ${esc(job.ip||'—')}</span></div>`:''}
            ${(job.otpDiagnostic||job.networkDiagnostic)?`
              <details class="ig-tool-details" style="margin-top:4px" ${(job.state==='paused'||job.state==='failed'||job.otpDiagnostic?.reason)?'open':''}>
                <summary>▸ Chi tiết kỹ thuật</summary>
                ${job.otpDiagnostic?`
                  <div data-ig-slot="otp-diagnostic" class="ig-tool-stack" style="margin-top:6px">
                    <strong>Chi tiết lần xác nhận OTP</strong>
                    <div class="ig-tool-meta"><span>Chế độ: ${job.otpDiagnostic.device==='mobile'?'Mobile':'Desktop'}</span><span>Nguồn mã: ${job.otpDiagnostic.source==='mailbox'?'Hộp thư tự động':job.otpDiagnostic.source==='manual'?'Nhập trong tool':'Nhập trực tiếp hoặc chưa xác định'}</span></div>
                    ${job.otpDiagnostic.messageId?`<div class="ig-tool-meta">ID thư: ${esc(job.otpDiagnostic.messageId)}</div>`:''}
                    ${Number.isFinite(job.otpDiagnostic.submittedAt)?`<div class="ig-tool-meta">Gửi xác nhận lúc: ${esc(new Date(job.otpDiagnostic.submittedAt).toLocaleString('vi-VN'))}</div>`:''}
                    ${job.otpDiagnostic.reason?'<div class="ig-tool-meta">Kết quả: Mã bị từ chối hoặc hết hạn; đã dừng tự gửi.</div>':''}
                  </div>
                `:''}
                ${job.networkDiagnostic?`
                  <div data-ig-slot="network-diagnostic" class="ig-tool-stack" style="margin-top:6px">
                    <strong>Phản hồi đăng ký</strong>
                    ${job.networkDiagnostic.events?.length?job.networkDiagnostic.events.slice(-4).map(event=>`
                      <div class="ig-tool-meta">
                        <span>${esc(Number.isFinite(event.at)?new Date(event.at).toLocaleTimeString('vi-VN'):'—')}</span>
                        <span>${esc(({verify_code:'Xác nhận mã',send_code:'Gửi mã',registration:'Đăng ký',other:'Yêu cầu khác'})[event.stage]||'Yêu cầu khác')}</span>
                        <span>${event.networkError?'Lỗi kết nối':event.httpStatus?'HTTP '+esc(event.httpStatus):'Đang chờ phản hồi'}</span>
                        ${event.outcome?`<span>${esc(event.outcome)}</span>`:''}
                        ${event.errors?.length?`<span>Mã lỗi: ${esc(event.errors.join(', '))}</span>`:''}
                      </div>
                    `).join(''):'<div class="ig-tool-meta">Chưa ghi nhận yêu cầu xác nhận trong phiên này.</div>'}
                  </div>
                `:''}
              </details>
            `:''}
          </div>
          ${job.state==='waiting_otp'?`
            <div class="ig-tool-field" style="margin-top:10px">
              <label for="ig-otp-${esc(okey)}">Nhập mã OTP 6 số</label>
              <div class="ig-tool-actions">
                <input id="ig-otp-${esc(okey)}" data-ig="otp" data-job-id="${esc(jid)}" type="text" inputmode="numeric" maxlength="6" value="${esc(otpDrafts[okey]||'')}" placeholder="123456" style="max-width:140px" ${!writable?'disabled':''} />
                <button type="button" class="primary" data-act="submit-otp" data-job-id="${esc(jid)}" ${!writable||busyAction?'disabled':''}>Gửi OTP</button>
              </div>
            </div>
          `:''}
          ${job.state==='paused'?`
            <div class="ig-tool-actions" style="margin-top:10px">
              <button type="button" class="primary" data-act="resume" data-job-id="${esc(jid)}" ${!writable||busyAction?'disabled':''}>Tiếp tục</button>
            </div>
          `:''}
          ${unsaved|| (job.state==='succeeded'&&jid&&!job.twofa)?`
            <div class="ig-tool-actions" style="margin-top:10px">
              ${unsaved?`<button type="button" class="primary" data-act="save-result" data-job-id="${esc(jid)}" ${!writable||busyAction?'disabled':''}>Xác nhận</button>`:''}
              ${job.state==='succeeded'&&jid&&!job.twofa?`<button type="button" data-act="enable-2fa" data-job-id="${esc(jid)}" ${!writable||busyAction?'disabled':''}>🔐 Bật 2FA</button>`:''}
            </div>
            ${unsaved?`
              <div class="ig-tool-actions" style="margin-top:8px;align-items:center">
                <input data-ig="twofa-input" data-job-id="${esc(jid)}" type="text" value="${esc(twofaDrafts[okey]||'')}" placeholder="Dán chuỗi khóa 2FA (Secret Key)..." style="flex:1;min-width:160px" ${!writable?'disabled':''} />
                <button type="button" data-act="gen-2fa-code" data-job-id="${esc(jid)}" ${!writable||busyAction?'disabled':''}>🔑 Lấy mã</button>
                ${twofaCodes[okey]?`<span class="mono" style="padding:4px 8px;border:1px solid rgba(47,191,113,0.45);border-radius:6px;color:#2fbf71;font-weight:700">${esc(twofaCodes[okey])}</span>`:''}
              </div>
            `:''}
          `:''}
          ${job.twofa?'<div class="ig-tool-meta" style="margin-top:6px;color:#2fbf71">✓ Đã bật 2FA (TOTP) cho tài khoản này.</div>':''}
          ${job.saved?'<div class="ig-tool-meta" style="margin-top:8px">Đã lưu tài khoản vào kho.</div>':''}
        </div>
      `;
    }

    function renderStatusPanel(){
      const writable=readWritable();
      const displayJobs=jobs.length?jobs:[{state:'idle',message:'Sẵn sàng tạo phiên mới (tối đa 2 phiên song song).'}];
      const key=JSON.stringify([displayJobs,writable,busyAction,twofaCodes]);
      if(key===lastStatusKey)return;
      lastStatusKey=key;

      element.querySelectorAll('[data-ig="otp"]').forEach(el=>{
        otpDrafts[el.dataset.jobId||'_single']=el.value;
      });
      element.querySelectorAll('[data-ig="twofa-input"]').forEach(el=>{
        twofaDrafts[el.dataset.jobId||'_single']=el.value;
      });

      const slot=element.querySelector('[data-ig-slot="status-body"]');
      if(!slot)return;
      slot.innerHTML=displayJobs.map((job,idx)=>renderJobCard(job,idx,displayJobs.length)).join('');
    }

    function render(){
      if(destroyed)return;
      syncFormControls();
      renderStatusPanel();
    }

    function parseProxyPool(){
      return [...new Set(String(draft.proxyPool||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
    }

    function pickRandomProxy(excludeCurrent=true){
      const pool=parseProxyPool();
      if(!pool.length)return draft.proxy;
      const cur=draft.proxy.trim();
      const candidates=excludeCurrent&&pool.length>1?pool.filter(p=>p!==cur):pool;
      return candidates[Math.floor(Math.random()*candidates.length)]||pool[0];
    }

    function rotateFormIdentity(){
      draft.genEmail='';draft.genKey='';
      const ge=element.querySelector('[data-ig="genEmail"]');if(ge)ge.value='';
      const next=randomIdentity();
      draft.name=next.name;draft.username=next.username;
      const dom=(draft.zohoDomain||'devsepa.id.vn').trim();
      draft.customEmail=`${next.mailLocal}@${dom}`;
      const inUse=new Set(jobs.map(j=>String(j.email||'').trim().toLowerCase()).filter(Boolean));
      const avail=pickBestWarehouseMail(readMails(),draft.platform,inUse);
      if(avail){
        draft.email=avail.email;draft.accessKey=avail.accessKey||'';
        const ms=element.querySelector('[data-ig="email"]');if(ms)ms.value=avail.email;
      }
      if(parseProxyPool().length){
        draft.proxy=pickRandomProxy(true);
        const px=element.querySelector('[data-ig="proxy"]');if(px)px.value=draft.proxy;
      }
      for(const [sel,val] of [['[data-ig="name"]',draft.name],['[data-ig="username"]',draft.username],['[data-ig="customEmail"]',draft.customEmail]]){
        const el=element.querySelector(sel);if(el)el.value=val;
      }
      saveDraftPrefs();
    }

    async function computeTotp(secret){
      const clean=String(secret||'').replace(/[\s=-]/g,'').toUpperCase();
      if(!clean||!/^[A-Z2-7]+$/.test(clean))throw Error('Chuỗi khóa 2FA không hợp lệ.');
      let bits='';
      for(const ch of clean)bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5,'0');
      const bytes=new Uint8Array(Math.floor(bits.length/8));
      for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(bits.slice(i*8,i*8+8),2);
      const c=Math.floor(Date.now()/1000/30);
      const buf=new ArrayBuffer(8);
      new DataView(buf).setUint32(4,c>>>0,false);
      new DataView(buf).setUint32(0,Math.floor(c/0x100000000),false);
      const k=await global.crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-1'},false,['sign']);
      const sig=new Uint8Array(await global.crypto.subtle.sign('HMAC',k,buf));
      const off=sig[sig.length-1]&0xf;
      const num=((sig[off]&0x7f)<<24)|((sig[off+1]&0xff)<<16)|((sig[off+2]&0xff)<<8)|(sig[off+3]&0xff);
      return String(num%1e6).padStart(6,'0');
    }

    async function performSave(jobId){
      const runSave=async()=>{
        if(!readWritable())throw Error('Bạn không có quyền lưu vào kho.');
        const okey=jobId||'_single';
        const tfEl=element.querySelector(`[data-ig="twofa-input"][data-job-id="${jobId}"]`)||element.querySelector('[data-ig="twofa-input"]');
        const manualTwofa=String((tfEl?tfEl.value:twofaDrafts[okey])||'').replace(/\s+/g,'').toUpperCase();
        const q=jobId?`?jobId=${encodeURIComponent(jobId)}`:'';
        const result=await api('/api/ig-tool/result'+q);
        if(manualTwofa&&!result.twofa)result.twofa=manualTwofa;
        const ok=typeof save==='function'?await save(result):false;
        if(!ok)throw Error('Lưu vào kho thất bại hoặc bị từ chối. Kết quả vẫn được giữ để thử lại.');
        const ack=await api('/api/ig-tool/acknowledge',{method:'POST',body:JSON.stringify({jobId})});
        delete twofaDrafts[okey];
        delete twofaCodes[okey];
        if(isLegacySingle)jobs=[ack];
        else await refreshStatus();
        serverError='';
      };
      const next=saveQueue.then(runSave,runSave);
      saveQueue=next.catch(()=>{});
      return next;
    }

    async function refreshStatus(){
      if(destroyed||!element.isConnected){destroy();return;}
      try{
        const res=await api('/api/ig-tool/status');
        if(Array.isArray(res?.jobs)){
          isLegacySingle=false;
          jobs=res.jobs;
        }else if(res&&typeof res==='object'&&res.state){
          isLegacySingle=true;
          jobs=[res];
        }else{
          jobs=[];
        }
        for(const job of jobs){
          const emLower=String(job.email||'').toLowerCase();
          if(ACTIVE_STATES.has(job.state)&&emLower&&!genKeysByEmail[emLower]){
            const q=job.id?`?jobId=${encodeURIComponent(job.id)}`:'';
            const mb=await api('/api/ig-tool/mailbox-url'+q).catch(()=>null);
            if(mb?.url){
              const m=mb.url.match(/key=([0-9a-f-]+)/i);
              if(m)genKeysByEmail[emLower]=m[1];
            }
          }
        }
        serverError='';
      }catch(err){
        serverError=err.message||'Chưa bật máy chủ IG Tool cục bộ (chạy ig-tool/start.ps1).';
      }
      render();
    }

    async function handleClick(e){
      const btn=e.target.closest('button[data-act]');
      if(destroyed||!btn||!element.contains(btn)||!btn.closest('.ig-tool-shell, .ig-tool-grid'))return;
      e.stopPropagation();
      if(btn.disabled)return;
      captureInputs();
      const act=btn.dataset.act;
      if(act==='read-imap'||act==='test-imap'){
        activeMailAction=act;imapMsgs=null;
        imapDiag=act==='read-imap'?'Đang mở hộp thư của email đã chọn…':'Đang kết nối hộp thư IMAP…';
      }
      busyAction=true;
      render();
      try{
        if(act==='set-pill'){
          const key=btn.dataset.key,val=btn.dataset.val;
          if(key&&val){
            draft[key]=val;
            const sel=element.querySelector(`[data-ig="${key}"]`);
            if(sel)sel.value=val;
            if(key==='platform'){
              const inUse=new Set(jobs.map(j=>String(j.email||'').trim().toLowerCase()).filter(Boolean));
              const avail=pickBestWarehouseMail(readMails(),draft.platform,inUse);
              if(avail&&readMails().find(m=>m.email===draft.email)?.usedOn?.[draft.platform]){
                draft.email=avail.email;draft.accessKey=avail.accessKey||'';
              }
            }
            saveDraftPrefs();
          }
        }else if(act==='toggle-config'){
          const det=element.querySelector('[data-ig-slot="fixed-config"]');
          if(det){det.open=!det.open;if(det.open)det.scrollIntoView({behavior:'smooth',block:'nearest'});}
        }else if(act==='randomize'){
          const next=randomIdentity();
          draft.name=next.name;draft.username=next.username;draft.birthday=randomBirthday();
          const dom=(draft.zohoDomain||'devsepa.id.vn').trim();
          draft.customEmail=`${next.mailLocal}@${dom}`;
          const nameEl=element.querySelector('[data-ig="name"]');
          const userEl=element.querySelector('[data-ig="username"]');
          const bdayEl=element.querySelector('[data-ig="birthday"]');
          const customEl=element.querySelector('[data-ig="customEmail"]');
          if(nameEl)nameEl.value=draft.name;
          if(userEl)userEl.value=draft.username;
          if(bdayEl)bdayEl.value=draft.birthday;
          if(customEl)customEl.value=draft.customEmail;
          saveDraftPrefs();
        }else if(act==='pick-proxy'){
          if(!parseProxyPool().length)throw Error('Chưa có proxy nào trong Danh sách Proxy xoay vòng.');
          draft.proxy=pickRandomProxy(true);
          const px=element.querySelector('[data-ig="proxy"]');if(px)px.value=draft.proxy;
          saveDraftPrefs();
          proxyDiag=`Đã chọn ngẫu nhiên proxy: ${draft.proxy}`;
          serverError='';
        }else if(act==='filter-proxies'){
          const pool=parseProxyPool();
          if(!pool.length)throw Error('Chưa có proxy nào trong Danh sách Proxy xoay vòng.');
          const alive=[];
          let dead=0;
          for(let i=0;i<pool.length;i+=3){
            const batch=pool.slice(i,i+3);
            const results=await Promise.all(batch.map(async p=>{
              try{
                const r=await api('/api/ig-tool/proxy',{method:'POST',body:JSON.stringify({proxy:p,protocol:draft.protocol})});
                return r?.ip?p:null;
              }catch{return null;}
            }));
            for(const item of results){
              if(item)alive.push(item);
              else dead++;
            }
          }
          draft.proxyPool=alive.join('\n');
          const poolEl=element.querySelector('[data-ig="proxyPool"]');if(poolEl)poolEl.value=draft.proxyPool;
          if(draft.proxy&&!alive.includes(draft.proxy.trim())){
            draft.proxy=alive[0]||'';
            const px=element.querySelector('[data-ig="proxy"]');if(px)px.value=draft.proxy;
          }
          saveDraftPrefs();
          proxyDiag=`Đã lọc xong: ${alive.length} proxy sống, đã xoá ${dead} proxy lỗi.`;
          serverError='';
        }else if(act==='open-gen-inbox'){
          if(typeof openInbox==='function'&&draft.genKey)openInbox({email:draft.genEmail,accessKey:draft.genKey});
        }else if(act==='open-status-inbox'){
          const jobId=btn.dataset.jobId||'';
          const targetJob=jobs.find(j=>j.id===jobId)||jobs[0];
          const targetEmail=targetJob?.email||draft.genEmail;
          const emLower=String(targetEmail||'').toLowerCase();
          const matched=readMails().find(m=>String(m.email||'').toLowerCase()===emLower);
          const key=matched?.accessKey||genKeysByEmail[emLower]||(draft.genEmail&&draft.genEmail.toLowerCase()===emLower?draft.genKey:'');
          if(typeof openInbox==='function'){
            if(key)openInbox({email:targetEmail,accessKey:key});
            else {
              if(!draft.imapUser.trim()||!draft.imapPass)throw Error('Nhập hộp thư tổng và App Password để đọc thư của phiên.');
              const tok=await ensureToken();
              await openInbox({email:targetEmail,zoho:{user:draft.imapUser.trim(),pass:draft.imapPass,token:tok,showAll:false}});
            }
          }
        }else if(act==='gen-mail'){
          if(typeof generateMail!=='function')throw Error('Chức năng tạo mail chưa sẵn sàng.');
          const gen=await generateMail(draft.tempType);
          if(!gen?.email||!gen?.accessKey)throw Error('Không tạo được Tempamail mới.');
          draft.genEmail=gen.email;draft.genKey=gen.accessKey;
          genKeysByEmail[gen.email.toLowerCase()]=gen.accessKey;
          const ge=element.querySelector('[data-ig="genEmail"]');if(ge)ge.value=gen.email;
          saveDraftPrefs();
          serverError='';
        }else if(act==='tweak-email'){
          const cur=draft.customEmail.trim();
          const at=cur.indexOf('@');
          const dom=at>0?cur.slice(at+1):(draft.zohoDomain||'devsepa.id.vn').trim();
          const local=(at>0?cur.slice(0,at):cur).replace(/\d+$/,'')||'user';
          const num=Math.floor(1+Math.random()*99);
          draft.customEmail=`${local}${num}@${dom}`;
          const ce=element.querySelector('[data-ig="customEmail"]');
          if(ce)ce.value=draft.customEmail;
          saveDraftPrefs();
          if(jobs.length===1&&ACTIVE_STATES.has(jobs[0].state)){
            const updated=await api('/api/ig-tool/email',{method:'POST',body:JSON.stringify({jobId:jobs[0].id,email:draft.customEmail})});
            if(isLegacySingle)jobs=[updated];else await refreshStatus();
            serverError='';
          }
        }else if(act==='test-imap'){
          const res=await api('/api/ig-tool/imap-test',{method:'POST',body:JSON.stringify({user:draft.imapUser,pass:draft.imapPass})});
          imapMsgs=null;
          imapDiag=`Kết nối IMAP thành công (${res.count} thư gần nhất trong INBOX).`;
          serverError='';
        }else if(act==='read-imap'){
          const selectedEmail=draft.customEmail.trim();
          const mailbox={user:draft.imapUser.trim(),pass:draft.imapPass};
          if(!mailbox.user||!mailbox.pass)throw Error('Nhập Gmail và App Password trước khi đọc thư.');
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(selectedEmail))throw Error('Nhập email đăng ký cần xem thư.');
          imapReadEmail=selectedEmail;
          if(typeof openInbox==='function'){
            const tok=await ensureToken();
            await openInbox({email:selectedEmail,zoho:{...mailbox,token:tok,showAll:false}});
            imapDiag=`Đã mở hộp thư của ${selectedEmail}.`;
          }else{
            const res=await api('/api/ig-tool/imap-messages',{method:'POST',signal:global.AbortSignal?.timeout?.(60000),body:JSON.stringify({...mailbox,email:selectedEmail})});
            imapMsgs=res.messages||[];
          }
          serverError='';
        }else if(act==='open-zoho-inbox'){
          if(!draft.imapUser.trim()||!draft.imapPass)throw Error('Thiếu email tổng hoặc App Password.');
          const tok=await ensureToken();
          if(typeof openInbox==='function')openInbox({email:draft.imapUser.trim(),zoho:{user:draft.imapUser.trim(),pass:draft.imapPass,token:tok,showAll:true}});
          serverError='';
        }else if(act==='test-proxy'){
          const res=await api('/api/ig-tool/proxy',{method:'POST',body:JSON.stringify({proxy:draft.proxy,protocol:draft.protocol})});
          if(res.protocol&&res.protocol!=='direct')draft.protocol=res.protocol;
          proxyDiag=res.ip?`Proxy OK (${res.protocol.toUpperCase()}) · IP đầu ra: ${res.ip}`:'Không dùng proxy (kết nối trực tiếp).';
          serverError='';
        }else if(act==='start'){
          const isZoho=draft.mailMode==='zoho';
          const isTemp=draft.mailMode==='tempamail';
          if(isTemp&&(!draft.genEmail||!draft.genKey)){
            if(typeof generateMail!=='function')throw Error('Chức năng tạo mail chưa sẵn sàng.');
            const gen=await generateMail(draft.tempType);
            if(!gen?.email||!gen?.accessKey)throw Error('Không tạo được Tempamail mới.');
            draft.genEmail=gen.email;draft.genKey=gen.accessKey;
            genKeysByEmail[gen.email.toLowerCase()]=gen.accessKey;
            const ge=element.querySelector('[data-ig="genEmail"]');if(ge)ge.value=gen.email;
            saveDraftPrefs();
          }
          if(draft.mailMode==='warehouse'){
            const chosen=readMails().find(m=>m.email===draft.email);
            if(chosen?.usedOn?.[draft.platform])throw Error(`Email này đã được sử dụng cho ${draft.platform==='facebook'?'Facebook':'Instagram'}.`);
          }
          if(draft.useProxy&&!draft.proxy.trim()&&parseProxyPool().length){
            draft.proxy=pickRandomProxy(false);
            const px=element.querySelector('[data-ig="proxy"]');if(px)px.value=draft.proxy;
          }
          let birthday=draft.birthday.trim();
          const dmY=birthday.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if(dmY)birthday=`${dmY[3]}-${dmY[2].padStart(2,'0')}-${dmY[1].padStart(2,'0')}`;
          const started=await api('/api/ig-tool/start',{method:'POST',body:JSON.stringify({
            platform:draft.platform,
            device:draft.device,
            gender:draft.gender,
            email:isZoho?draft.customEmail.trim():isTemp?draft.genEmail:draft.email,
            accessKey:isZoho?'':isTemp?draft.genKey:draft.accessKey,
            imap:isZoho&&draft.imapPass?{port:993,user:draft.imapUser.trim(),pass:draft.imapPass}:null,
            name:draft.name,
            username:draft.username,
            password:draft.password,
            birthday,
            proxy:draft.useProxy?draft.proxy:'',
            protocol:draft.protocol,
          })});
          if(isLegacySingle)jobs=[started];
          else await refreshStatus();
          serverError='';
        }else if(act==='stop'){
          const jobId=btn.dataset.jobId||(jobs.length===1?jobs[0].id:'');
          const stopped=await api('/api/ig-tool/stop',{method:'POST',body:JSON.stringify({jobId})});
          if(isLegacySingle)jobs=[stopped];
          else await refreshStatus();
          serverError='';
        }else if(act==='resume'){
          const jobId=btn.dataset.jobId||(jobs.length===1?jobs[0].id:'');
          const resumed=await api('/api/ig-tool/resume',{method:'POST',body:JSON.stringify({jobId})});
          if(isLegacySingle)jobs=[resumed];
          else await refreshStatus();
          serverError='';
        }else if(act==='submit-otp'){
          const jobId=btn.dataset.jobId||(jobs.length===1?jobs[0].id:'');
          const okey=jobId||'_single';
          const otpEl=element.querySelector(`[data-ig="otp"][data-job-id="${jobId}"]`)||element.querySelector('[data-ig="otp"]');
          const code=String((otpEl?otpEl.value:otpDrafts[okey])||'').trim();
          const submitted=await api('/api/ig-tool/otp',{method:'POST',body:JSON.stringify({jobId,code})});
          otpDrafts[okey]='';
          if(isLegacySingle)jobs=[submitted];
          else await refreshStatus();
          serverError='';
        }else if(act==='save-result'){
          const jobId=btn.dataset.jobId||(jobs.length===1?jobs[0].id:'');
          await performSave(jobId);
        }else if(act==='gen-2fa-code'){
          const jobId=btn.dataset.jobId||(jobs.length===1?jobs[0].id:'');
          const okey=jobId||'_single';
          const tfEl=element.querySelector(`[data-ig="twofa-input"][data-job-id="${jobId}"]`)||element.querySelector('[data-ig="twofa-input"]');
          const rawSecret=String((tfEl?tfEl.value:twofaDrafts[okey])||'').trim();
          twofaDrafts[okey]=rawSecret;
          const code=await computeTotp(rawSecret);
          twofaCodes[okey]=code;
          if(global.navigator?.clipboard?.writeText)await global.navigator.clipboard.writeText(code).catch(()=>{});
          proxyDiag=`Đã lấy & copy mã 2FA: ${code}`;
          serverError='';
        }else if(act==='enable-2fa'){
          const jobId=btn.dataset.jobId||(jobs.length===1?jobs[0].id:'');
          const res=await api('/api/ig-tool/enable-2fa',{method:'POST',body:JSON.stringify({jobId})});
          if(res?.twofaKey&&global.navigator?.clipboard?.writeText){
            await global.navigator.clipboard.writeText(res.twofaKey).catch(()=>{});
          }
          proxyDiag=res?.twofaKey?'Đã bật 2FA thành công và copy key 2FA vào Clipboard!':'Đã bật 2FA thành công!';
          if(isLegacySingle)jobs=[res];
          else await refreshStatus();
          serverError='';
        }else if(act==='copy-cookie'){
          const jobId=btn.dataset.jobId||(jobs.length===1?jobs[0].id:'');
          const q=jobId?`?jobId=${encodeURIComponent(jobId)}`:'';
          const res=await api('/api/ig-tool/cookies'+q);
          if(!res?.cookie)throw Error('Trình duyệt hiện chưa có cookie nào.');
          if(global.navigator?.clipboard?.writeText)await global.navigator.clipboard.writeText(res.cookie);
          proxyDiag='Đã copy Cookie từ trình duyệt ảo vào Clipboard!';
          serverError='';
        }
      }catch(err){
        serverError=err.message||'Thao tác thất bại.';
        if(activeMailAction){imapMsgs=null;imapDiag=serverError;}
      }finally{
        activeMailAction=null;
        busyAction=false;
        render();
      }
    }

    function handleInput(e){
      captureInputs(e);
      const key=e?.target?.dataset?.ig;
      if(key==='platform'||key==='mailMode'){
        const avail=readMails().find(m=>!m.usedOn?.[draft.platform]);
        if(avail&&readMails().find(m=>m.email===draft.email)?.usedOn?.[draft.platform]){
          draft.email=avail.email;draft.accessKey=avail.accessKey||'';
        }
        render();
      }
    }

    element.addEventListener('click',handleClick);
    element.addEventListener('input',handleInput);
    element.addEventListener('change',handleInput);

    renderFormShell();
    render();
    void refreshStatus();
    void loadServerPrefs();
    if(pollMs>0){
      pollTimer=global.setInterval(()=>{void refreshStatus();},pollMs);
    }

    function destroy(){
      if(destroyed)return;
      destroyed=true;
      if(pollTimer!==null)global.clearInterval(pollTimer);
      element.removeEventListener('click',handleClick);
      element.removeEventListener('input',handleInput);
      element.removeEventListener('change',handleInput);
    }

    return {destroy,refresh:refreshStatus};
  }

  global.IgTool={mount};
})(typeof globalThis!=='undefined'?globalThis:window);
