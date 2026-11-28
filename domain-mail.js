(function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function bodyFrame(mail){
    const body=mail.body_type==='html'?String(mail.body||''):'<pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(mail.body)+'</pre>';
    const source='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;"><style>body{font:14px Arial,sans-serif;color:#111;background:#fff;overflow-wrap:anywhere}img{max-width:100%}</style></head><body>'+body+'</body></html>';
    return '<iframe title="Nội dung thư" sandbox="" referrerpolicy="no-referrer" srcdoc="'+esc(source)+'" style="width:100%;height:360px;border:1px solid var(--line);border-radius:8px;background:white"></iframe>';
  }
  function mount(element,{request,canWrite=()=>false,pollMs=5000}={}){
    let destroyed=false,busy=false,domain='devsepa.id.vn',boxes=[],selected='',messages=[],error='',info='',auto=true,timer=null,readVersion=0;
    const errors={unauthorized:'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',forbidden:'Bạn chưa có quyền thực hiện thao tác này.',alias_exists:'Địa chỉ đã tồn tại.',invalid_alias:'Tên chỉ gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới; tối đa 64 ký tự.',service_unavailable:'Dịch vụ mail chưa sẵn sàng. Kiểm tra triển khai API và cơ sở dữ liệu.'};
    function render(){
      if(destroyed||!element.isConnected)return;
      const draft=element.querySelector('[data-dm-local]')?.value||'';
      element.innerHTML=`<div class="panel" style="display:grid;gap:12px"><h2>Mail domain</h2><p class="muted">Tạo địa chỉ @${esc(domain)} và đọc thư trực tiếp trên web. Chỉ các địa chỉ đã tạo mới có hộp thư trên web; bản chuyển tiếp Gmail vẫn giữ nguyên.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input data-dm-local aria-label="Tên địa chỉ mới" placeholder="ten.diachi" maxlength="64" value="${esc(draft)}"><span>@${esc(domain)}</span><button type="button" data-dm-act="random" ${busy||!canWrite()?'disabled':''}>Ngẫu nhiên</button><button type="button" class="primary" data-dm-act="create" ${busy||!canWrite()?'disabled':''}>Tạo địa chỉ</button><button type="button" data-dm-act="reload" ${busy?'disabled':''}>Tải lại</button></div>
        <div role="status" style="color:${error?'var(--bad,#ef6464)':'var(--mute)'}">${esc(error||info||'')}</div>
        <div style="display:grid;gap:6px">${boxes.map(box=>`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" data-dm-act="read" data-email="${esc(box.email)}" aria-label="Đọc ${esc(box.email)}" aria-pressed="${selected===box.email}">${esc(box.email)}</button><button type="button" data-dm-act="copy" data-email="${esc(box.email)}">Sao chép</button></div>`).join('')||'<p class="muted">Chưa có địa chỉ mail domain.</p>'}</div></div>
        ${selected?`<section class="panel" style="display:grid;gap:12px;margin-top:12px"><h3>Hộp thư: ${esc(selected)}</h3><label><input type="checkbox" data-dm-auto ${auto?'checked':''}> Tự tải lại mỗi 5 giây</label><p class="muted">Hiển thị 30 thư gần nhất. Không tải tệp đính kèm hay ảnh từ xa.</p>${messages.map(mail=>`<article style="border:1px solid var(--line);border-radius:8px;padding:10px"><b>${esc(mail.subject||'(Không có tiêu đề)')}</b><p class="muted">${esc(mail.sender)} · ${esc(mail.received_at?new Date(mail.received_at).toLocaleString('vi-VN'):'')}</p>${bodyFrame(mail)}</article>`).join('')||'<p>Chưa có thư cho địa chỉ này. Thư cũ trong Gmail không được nhập lại.</p>'}</section>`:''}`;
    }
    async function call(body){const result=await request(body);if(result?.error)throw Error(errors[result.error]||'Không thực hiện được thao tác mail.');return result;}
    async function read(email){
      const latest=email===selected?messages[0]?.id:undefined;
      selected=email;const version=++readVersion;
      const result=await call({action:'messages',email,...(latest?{latest}:{})});
      if(result.unchanged){error='';return;}
      if(!destroyed&&version===readVersion){messages=Array.isArray(result.messages)?result.messages:[];info='Đã tải thư lúc '+new Date().toLocaleTimeString('vi-VN');error='';render();}
    }
    async function reload(){const result=await call({action:'list'});if(destroyed)return;domain=result.domain||domain;boxes=Array.isArray(result.mailboxes)?result.mailboxes:[];if(selected)await read(selected);render();}
    async function click(event){
      const btn=event.target.closest('[data-dm-act]');if(!btn||!element.contains(btn)||btn.disabled||destroyed)return;
      const act=btn.dataset.dmAct;
      if(act==='random'){element.querySelector('[data-dm-local]').value='mail.'+crypto.randomUUID().replace(/-/g,'').slice(0,12);return;}
      if(act==='copy'){try{await navigator.clipboard.writeText(btn.dataset.email);info='Đã sao chép địa chỉ.';error='';}catch{error='Không sao chép được. Hãy chọn và chép địa chỉ thủ công.';}render();return;}
      if(busy)return;
      const local=element.querySelector('[data-dm-local]')?.value.trim();busy=true;error='';info='Đang xử lý…';render();
      try{
        if(act==='read')await read(btn.dataset.email);
        else if(act==='create'){
          const result=await call({action:'create',local});
          if(!destroyed){const box=result.mailbox;boxes=[box,...boxes.filter(x=>x.email!==box.email)];await read(box.email);}
        }else await reload();
      }catch(err){error=err.message||'Không kết nối được dịch vụ mail.';}
      finally{busy=false;render();}
    }
    function change(event){if(event.target.matches('[data-dm-auto]'))auto=event.target.checked;}
    element.addEventListener('click',click);element.addEventListener('change',change);busy=true;render();
    void reload().catch(err=>{error=err.message;}).finally(()=>{busy=false;render();});
    if(pollMs>0)timer=setInterval(()=>{if(!destroyed&&selected&&auto&&!busy){busy=true;void read(selected).catch(err=>{error=err.message;render();}).finally(()=>{busy=false;});}},pollMs);
    return {destroy(){destroyed=true;readVersion++;if(timer)clearInterval(timer);element.removeEventListener('click',click);element.removeEventListener('change',change);},refresh:reload};
  }
  root.DomainMail={mount};
})(globalThis);
