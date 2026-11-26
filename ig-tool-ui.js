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
  const FIRST_NAMES=['Nguyen','Tran','Le','Pham','Hoang','Huynh','Phan','Vu','Vo','Dang','Bui','Do','Ho','Ngo','Duong'];
  const MID_NAMES=['Minh','Gia','Thao','Ngoc','Quoc','Khanh','Hoang','Duc','Thanh','Anh','Bao','Tuan','Hai','Linh'];
  const LAST_NAMES=['Anh','Huy','Vy','Linh','Nam','Bao','Han','Trang','Khang','Phuc','Nhi','Quan','Tu','My','Khoa'];
  function pick(arr){return arr[Math.floor(Math.random()*arr.length)];}
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

  function mount(element,{canWrite=false,mails=[],save,fetchImpl=global.fetch?.bind(global),pollMs=1000}={}){
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
    let status={state:'idle',message:'Đang kết nối máy chủ IG Tool…'};
    let serverError='';
    let proxyDiag=null;
    let imapDiag=null;
    let imapMsgs=null;
    let busyAction=false;
    let lastStatusKey='';
    const saved=readSavedDraft(global.localStorage);
    const proxyHistory=Array.isArray(saved.proxyHistory)?saved.proxyHistory.filter(x=>typeof x==='string'&&x.trim()):[];
    const initId=randomIdentity();
    const initDomain=typeof saved.zohoDomain==='string'&&saved.zohoDomain?saved.zohoDomain:'devsepa.id.vn';
    let draft={
      platform:['instagram','facebook'].includes(saved.platform)?saved.platform:'instagram',
      gender:['female','male'].includes(saved.gender)?saved.gender:'female',
      mailMode:['warehouse','zoho'].includes(saved.mailMode)?saved.mailMode:'warehouse',
      zohoDomain:initDomain,
      customEmail:`${initId.mailLocal}@${initDomain}`,
      imapUser:typeof saved.imapUser==='string'&&saved.imapUser?saved.imapUser:`contact@${initDomain}`,
      imapPass:typeof saved.imapPass==='string'?saved.imapPass:'',
      email:'',
      accessKey:'',
      name:initId.name,
      username:initId.username,
      password:'nguyenduy1805',
      birthday:typeof saved.birthday==='string'&&saved.birthday?saved.birthday:'15/01/2000',
      proxy:typeof saved.proxy==='string'?saved.proxy:'',
      protocol:['auto','http','socks5'].includes(saved.protocol)?saved.protocol:'auto',
      otp:'',
    };

    const mailList=readMails();
    const pickAvailableMail=(plat)=>{
      const cur=mailList.find(m=>m.email===draft.email&&!m.usedOn?.[plat]);
      if(cur)return cur;
      return mailList.find(m=>!m.usedOn?.[plat])||mailList[0]||null;
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
        gender:draft.gender,
        mailMode:draft.mailMode,
        zohoDomain:draft.zohoDomain,
        imapUser:draft.imapUser,
        imapPass:draft.imapPass,
        birthday:draft.birthday,
        proxy:draft.proxy,
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
        const p=await api('/api/ig-tool/prefs');
        if(!p||typeof p!=='object'||destroyed)return;
        for(const k of ['platform','gender','mailMode','zohoDomain','imapUser','imapPass','birthday','proxy','protocol']){
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
      for(const key of ['platform','gender','mailMode','zohoDomain','customEmail','imapUser','imapPass','email','name','username','password','birthday','proxy','protocol','otp']){
        const el=element.querySelector(`[data-ig="${key}"]`);
        if(el)draft[key]=el.value;
      }
      const selected=readMails().find(m=>m.email===draft.email);
      draft.accessKey=selected?.accessKey||'';
      saveDraftPrefs();
    }

    function renderMailOptions(){
      const list=readMails();
      const plat=draft.platform;
      const platName=plat==='facebook'?'FB':'IG';
      if(!list.length)return '<option value="">Chưa có email trong kho</option>';
      return list.map(m=>{
        const used=!!m.usedOn?.[plat];
        const tag=used?`Đã sử dụng (${platName})`:(m.accessKey?'Auto OTP':'OTP thủ công');
        return `<option value="${esc(m.email)}" ${m.email===draft.email?'selected':''} ${used?'disabled':''}>${esc(m.email)} (${tag})</option>`;
      }).join('');
    }

    function renderFormShell(){
      const writable=readWritable();
      element.innerHTML=`
        <div class="ig-tool-grid">
          <section class="ig-tool-card">
            <h3>Thông tin tạo tài khoản</h3>
            <div data-ig-slot="readonly-banner">${!writable?'<div class="ig-tool-banner">Bạn đang ở chế độ Chỉ xem. Không thể chạy tạo tài khoản hoặc lưu vào kho.</div>':''}</div>
            <div data-ig-slot="error-banner"></div>
            <div class="ig-tool-row">
              <div class="ig-tool-field">
                <label for="ig-platform">Nền tảng</label>
                <select id="ig-platform" data-ig="platform">
                  <option value="instagram" ${draft.platform==='instagram'?'selected':''}>Instagram</option>
                  <option value="facebook" ${draft.platform==='facebook'?'selected':''}>Facebook</option>
                </select>
              </div>
              <div class="ig-tool-field" data-ig-slot="gender-field" ${draft.platform==='facebook'?'':'style="display:none"'}>
                <label for="ig-gender">Giới tính (FB)</label>
                <select id="ig-gender" data-ig="gender">
                  <option value="female" ${draft.gender==='female'?'selected':''}>Nữ</option>
                  <option value="male" ${draft.gender==='male'?'selected':''}>Nam</option>
                </select>
              </div>
            </div>
            <div class="ig-tool-field">
              <label for="ig-mail-mode">Nguồn Email</label>
              <select id="ig-mail-mode" data-ig="mailMode">
                <option value="warehouse" ${draft.mailMode==='warehouse'?'selected':''}>Email từ kho (Kho Gmail)</option>
                <option value="zoho" ${draft.mailMode==='zoho'?'selected':''}>Domain riêng (Zoho Catch-all Auto OTP)</option>
              </select>
            </div>
            <div class="ig-tool-field" data-ig-slot="warehouse-mail" ${draft.mailMode==='zoho'?'style="display:none"':''}>
              <label for="ig-mail-select">Email từ kho</label>
              <select id="ig-mail-select" data-ig="email">
                ${renderMailOptions()}
              </select>
            </div>
            <div class="ig-tool-stack" data-ig-slot="zoho-mail" style="display:${draft.mailMode==='zoho'?'flex':'none'}">
              <div class="ig-tool-row">
                <div class="ig-tool-field">
                  <label for="ig-custom-email">Email đăng ký (tự sinh hoặc tự nhập)</label>
                  <input id="ig-custom-email" data-ig="customEmail" type="text" autocomplete="off" value="${esc(draft.customEmail)}" placeholder="ten@devsepa.id.vn" />
                </div>
                <div class="ig-tool-field">
                  <label for="ig-zoho-domain">Domain</label>
                  <input id="ig-zoho-domain" data-ig="zohoDomain" type="text" autocomplete="off" value="${esc(draft.zohoDomain)}" placeholder="devsepa.id.vn" />
                </div>
              </div>
              <div class="ig-tool-row">
                <div class="ig-tool-field">
                  <label for="ig-imap-user">Hộp thư tổng Zoho</label>
                  <input id="ig-imap-user" data-ig="imapUser" type="text" autocomplete="off" value="${esc(draft.imapUser)}" placeholder="contact@devsepa.id.vn" />
                </div>
                <div class="ig-tool-field">
                  <label for="ig-imap-pass">App Password Zoho</label>
                  <input id="ig-imap-pass" data-ig="imapPass" type="password" autocomplete="new-password" value="${esc(draft.imapPass)}" placeholder="Mật khẩu ứng dụng Zoho" />
                </div>
              </div>
              <div class="ig-tool-actions">
                <button type="button" data-act="tweak-email">Đổi số email</button>
                <button type="button" data-act="test-imap">Kiểm tra Zoho IMAP</button>
                <button type="button" data-act="read-imap">Đọc thư email này</button>
              </div>
              <div class="ig-tool-meta" data-ig-slot="imap-diag"></div>
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
            </div>
            <div class="ig-tool-row">
              <div class="ig-tool-field">
                <label for="ig-password">Mật khẩu</label>
                <input id="ig-password" name="ig_new_password" data-ig="password" type="password" autocomplete="new-password" value="${esc(draft.password)}" placeholder="Ít nhất 6 ký tự" />
              </div>
              <div class="ig-tool-field">
                <label for="ig-birthday">Ngày sinh (dd/mm/yyyy)</label>
                <input id="ig-birthday" name="ig_birthday" data-ig="birthday" type="text" autocomplete="off" value="${esc(draft.birthday)}" placeholder="15/01/2000" />
              </div>
            </div>
            <div class="ig-tool-row">
              <div class="ig-tool-field">
                <label for="ig-proxy">Proxy (tuỳ chọn: host:port:user:pass)</label>
                <input id="ig-proxy" name="ig_proxy" data-ig="proxy" type="text" list="ig-proxy-history" autocomplete="off" value="${esc(draft.proxy)}" placeholder="1.2.3.4:8000:user:pass" />
                <datalist id="ig-proxy-history">${proxyHistory.map(p=>`<option value="${esc(p)}"></option>`).join('')}</datalist>
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
            <div class="ig-tool-actions">
              <button type="button" data-act="randomize">Random tên &amp; user</button>
              <button type="button" data-act="test-proxy">Kiểm tra proxy</button>
              <button type="button" class="primary" data-act="start">Bắt đầu tạo tài khoản</button>
              <button type="button" class="danger" data-act="stop">Dừng phiên</button>
            </div>
            <div class="ig-tool-meta" data-ig-slot="proxy-diag"></div>
          </section>

          <section class="ig-tool-card" data-ig-slot="status-card">
            <h3>Tiến trình &amp; Kết quả</h3>
            <div data-ig-slot="status-body"></div>
          </section>
        </div>
      `;
    }

    function syncFormControls(){
      const writable=readWritable();
      const active=ACTIVE_STATES.has(status.state);
      const unsaved=status.state==='succeeded'&&!status.saved;
      const lockInputs=active||!writable;

      for(const key of ['platform','gender','mailMode','zohoDomain','customEmail','imapUser','imapPass','email','name','username','password','birthday','proxy','protocol']){
        const el=element.querySelector(`[data-ig="${key}"]`);
        if(el)el.disabled=lockInputs;
      }
      const userSlot=element.querySelector('[data-ig-slot="username-field"]');
      const genderSlot=element.querySelector('[data-ig-slot="gender-field"]');
      const whSlot=element.querySelector('[data-ig-slot="warehouse-mail"]');
      const zohoSlot=element.querySelector('[data-ig-slot="zoho-mail"]');
      if(userSlot)userSlot.style.display=draft.platform==='facebook'?'none':'';
      if(genderSlot)genderSlot.style.display=draft.platform==='facebook'?'':'none';
      if(whSlot)whSlot.style.display=draft.mailMode==='zoho'?'none':'';
      if(zohoSlot)zohoSlot.style.display=draft.mailMode==='zoho'?'flex':'none';
      const protoEl=element.querySelector('[data-ig="protocol"]');
      if(protoEl&&protoEl.value!==draft.protocol)protoEl.value=draft.protocol;
      if((active||status.state==='succeeded')&&status.email&&draft.mailMode==='zoho'&&draft.customEmail!==status.email){
        draft.customEmail=status.email;
        const ce=element.querySelector('[data-ig="customEmail"]');
        if(ce)ce.value=status.email;
      }

      const mailSelect=element.querySelector('[data-ig="email"]');
      const currentMail=readMails().find(m=>m.email===draft.email);
      const selectedUsed=!!currentMail?.usedOn?.[draft.platform];
      if(mailSelect){
        const optsHtml=renderMailOptions();
        if(mailSelect.dataset.plat!==draft.platform){
          mailSelect.dataset.plat=draft.platform;
          mailSelect.innerHTML=optsHtml;
          if(selectedUsed){
            const avail=readMails().find(m=>!m.usedOn?.[draft.platform]);
            if(avail){draft.email=avail.email;draft.accessKey=avail.accessKey||'';mailSelect.value=avail.email;}
          }
        }
      }
      const mailAfter=readMails().find(m=>m.email===draft.email);
      const isMailUsed=draft.mailMode==='warehouse'&&!!mailAfter?.usedOn?.[draft.platform];

      const btnRand=element.querySelector('button[data-act="randomize"]');
      const btnTweak=element.querySelector('button[data-act="tweak-email"]');
      const btnTest=element.querySelector('button[data-act="test-proxy"]');
      const btnTestImap=element.querySelector('button[data-act="test-imap"]');
      const btnReadImap=element.querySelector('button[data-act="read-imap"]');
      const btnStart=element.querySelector('button[data-act="start"]');
      const btnStop=element.querySelector('button[data-act="stop"]');
      if(btnRand)btnRand.disabled=active||!writable||busyAction;
      if(btnTweak)btnTweak.disabled=(active&&status.state!=='paused')||!writable||busyAction;
      if(btnTest)btnTest.disabled=active||!writable||busyAction;
      if(btnTestImap)btnTestImap.disabled=active||!writable||busyAction;
      if(btnReadImap)btnReadImap.disabled=active||!writable||busyAction;
      if(btnStart)btnStart.disabled=active||unsaved||!writable||busyAction||isMailUsed;
      if(btnStop)btnStop.disabled=!active||busyAction;

      const imapDiagSlot=element.querySelector('[data-ig-slot="imap-diag"]');
      if(imapDiagSlot){
        if(imapMsgs){
          imapDiagSlot.innerHTML=imapMsgs.length
            ?imapMsgs.map(m=>`<div style="width:100%;border-top:1px solid var(--line);padding-top:4px"><b>${esc(m.subject||'(Không tiêu đề)')}</b> · ${esc(m.from)}<br><span>${esc(m.snippet)}</span></div>`).join('')
            :'Chưa có thư nào gửi tới email này.';
        }else{
          imapDiagSlot.textContent=imapDiag||'';
        }
      }

      const errSlot=element.querySelector('[data-ig-slot="error-banner"]');
      const usedMsg=isMailUsed?`Email ${draft.email} đã được sử dụng cho ${draft.platform==='facebook'?'Facebook':'Instagram'}. Hãy chọn email khác.`:'';
      const bannerMsg=serverError||usedMsg;
      if(errSlot)errSlot.innerHTML=bannerMsg?`<div class="ig-tool-banner">${esc(bannerMsg)}</div>`:'';

      const diagSlot=element.querySelector('[data-ig-slot="proxy-diag"]');
      if(diagSlot)diagSlot.textContent=proxyDiag||'';
    }

    function renderStatusPanel(){
      const writable=readWritable();
      const unsaved=status.state==='succeeded'&&!status.saved;
      const stateText=STATE_LABEL[status.state]||status.state||'Sẵn sàng';
      const key=JSON.stringify([status,writable,busyAction]);
      if(key===lastStatusKey)return;
      lastStatusKey=key;

      const otpInput=element.querySelector('[data-ig="otp"]');
      if(otpInput)draft.otp=otpInput.value;

      const slot=element.querySelector('[data-ig-slot="status-body"]');
      if(!slot)return;
      slot.innerHTML=`
        <div class="ig-tool-status" data-state="${esc(status.state||'idle')}">
          <span class="ig-tool-badge">${esc(stateText)}</span>
          <div>${esc(status.message||'')}</div>
          ${status.protocol||status.ip?`<div class="ig-tool-meta"><span>Giao thức: ${esc(status.protocol||'—')}</span><span>IP: ${esc(status.ip||'—')}</span></div>`:''}
        </div>
        ${status.state==='waiting_otp'?`
          <div class="ig-tool-field" style="margin-top:10px">
            <label for="ig-otp">Nhập mã OTP 6 số</label>
            <div class="ig-tool-actions">
              <input id="ig-otp" data-ig="otp" type="text" inputmode="numeric" maxlength="6" value="${esc(draft.otp)}" placeholder="123456" style="max-width:140px" ${!writable?'disabled':''} />
              <button type="button" class="primary" data-act="submit-otp" ${!writable||busyAction?'disabled':''}>Gửi OTP</button>
            </div>
          </div>
        `:''}
        ${status.state==='paused'?`
          <div class="ig-tool-actions" style="margin-top:10px">
            <button type="button" class="primary" data-act="resume" ${!writable||busyAction?'disabled':''}>Tiếp tục</button>
          </div>
        `:''}
        ${unsaved?`
          <div class="ig-tool-actions" style="margin-top:10px">
            <button type="button" class="primary" data-act="save-result" ${!writable||busyAction?'disabled':''}>Xác nhận</button>
          </div>
        `:''}
        ${status.saved?'<div class="ig-tool-meta" style="margin-top:8px">Đã lưu tài khoản vào kho.</div>':''}
      `;
    }

    function render(){
      if(destroyed)return;
      syncFormControls();
      renderStatusPanel();
    }

    async function performSave(){
      if(!readWritable())throw Error('Bạn không có quyền lưu vào kho.');
      const result=await api('/api/ig-tool/result');
      const ok=typeof save==='function'?await save(result):false;
      if(!ok)throw Error('Lưu vào kho thất bại hoặc bị từ chối. Kết quả vẫn được giữ để thử lại.');
      status=await api('/api/ig-tool/acknowledge',{method:'POST'});
      const next=randomIdentity();
      draft.name=next.name;draft.username=next.username;
      const dom=(draft.zohoDomain||'devsepa.id.vn').trim();
      draft.customEmail=`${next.mailLocal}@${dom}`;
      for(const [sel,val] of [['[data-ig="name"]',draft.name],['[data-ig="username"]',draft.username],['[data-ig="customEmail"]',draft.customEmail]]){
        const el=element.querySelector(sel);if(el)el.value=val;
      }
      serverError='';
    }

    async function refreshStatus(){
      if(destroyed||!element.isConnected){destroy();return;}
      try{
        status=await api('/api/ig-tool/status');
        serverError='';
      }catch(err){
        serverError=err.message||'Chưa bật máy chủ IG Tool cục bộ (chạy ig-tool/start.ps1).';
      }
      render();
    }

    async function handleClick(e){
      const btn=e.target.closest('button[data-act]');
      if(!btn||btn.disabled)return;
      captureInputs();
      const act=btn.dataset.act;
      busyAction=true;
      render();
      try{
        if(act==='randomize'){
          const next=randomIdentity();
          draft.name=next.name;draft.username=next.username;
          const dom=(draft.zohoDomain||'devsepa.id.vn').trim();
          draft.customEmail=`${next.mailLocal}@${dom}`;
          const nameEl=element.querySelector('[data-ig="name"]');
          const userEl=element.querySelector('[data-ig="username"]');
          const customEl=element.querySelector('[data-ig="customEmail"]');
          if(nameEl)nameEl.value=draft.name;
          if(userEl)userEl.value=draft.username;
          if(customEl)customEl.value=draft.customEmail;
          saveDraftPrefs();
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
          if(ACTIVE_STATES.has(status.state)){
            status=await api('/api/ig-tool/email',{method:'POST',body:JSON.stringify({email:draft.customEmail})});
            serverError='';
          }
        }else if(act==='test-imap'){
          const res=await api('/api/ig-tool/imap-test',{method:'POST',body:JSON.stringify({user:draft.imapUser,pass:draft.imapPass})});
          imapMsgs=null;
          imapDiag=`Kết nối Zoho IMAP thành công (${res.count} thư gần nhất trong INBOX).`;
          serverError='';
        }else if(act==='read-imap'){
          const res=await api('/api/ig-tool/imap-messages',{method:'POST',body:JSON.stringify({user:draft.imapUser,pass:draft.imapPass,email:draft.customEmail})});
          imapMsgs=res.messages||[];
          serverError='';
        }else if(act==='test-proxy'){
          const res=await api('/api/ig-tool/proxy',{method:'POST',body:JSON.stringify({proxy:draft.proxy,protocol:draft.protocol})});
          if(res.protocol&&res.protocol!=='direct')draft.protocol=res.protocol;
          proxyDiag=res.ip?`Proxy OK (${res.protocol.toUpperCase()}) · IP đầu ra: ${res.ip}`:'Không dùng proxy (kết nối trực tiếp).';
          serverError='';
        }else if(act==='start'){
          const isZoho=draft.mailMode==='zoho';
          if(!isZoho){
            const chosen=readMails().find(m=>m.email===draft.email);
            if(chosen?.usedOn?.[draft.platform])throw Error(`Email này đã được sử dụng cho ${draft.platform==='facebook'?'Facebook':'Instagram'}.`);
          }
          let birthday=draft.birthday.trim();
          const dmY=birthday.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if(dmY)birthday=`${dmY[3]}-${dmY[2].padStart(2,'0')}-${dmY[1].padStart(2,'0')}`;
          status=await api('/api/ig-tool/start',{method:'POST',body:JSON.stringify({
            platform:draft.platform,
            gender:draft.gender,
            email:isZoho?draft.customEmail.trim():draft.email,
            accessKey:isZoho?'':draft.accessKey,
            imap:isZoho&&draft.imapPass?{port:993,user:draft.imapUser.trim(),pass:draft.imapPass}:null,
            name:draft.name,
            username:draft.username,
            password:draft.password,
            birthday,
            proxy:draft.proxy,
            protocol:draft.protocol,
          })});
          serverError='';
        }else if(act==='stop'){
          status=await api('/api/ig-tool/stop',{method:'POST'});
          serverError='';
        }else if(act==='resume'){
          status=await api('/api/ig-tool/resume',{method:'POST'});
          serverError='';
        }else if(act==='submit-otp'){
          status=await api('/api/ig-tool/otp',{method:'POST',body:JSON.stringify({code:draft.otp.trim()})});
          draft.otp='';
          serverError='';
        }else if(act==='save-result'){
          await performSave();
        }
      }catch(err){
        serverError=err.message||'Thao tác thất bại.';
      }finally{
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
