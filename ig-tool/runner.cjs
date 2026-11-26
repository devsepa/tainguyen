'use strict';
const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {validateInput}=require('./input.cjs');
const {connectProxy}=require('./proxy.cjs');
const {Mailbox}=require('./mailbox.cjs');
const {ImapMailbox}=require('./imap.cjs');

const terminal=new Set(['idle','succeeded','failed','cancelled']);
class Runner {
  constructor({browserFactory,proxyFactory=connectProxy,mailboxFactory=(input,signal)=>input.imap?new ImapMailbox(input,{signal}):new Mailbox(input,{signal}),pollMs=1000,otpTimeoutMs=180000,keepBrowserOnSuccess=false}={}) {
    this.browserFactory=browserFactory || require('./browser.cjs').openBrowser;
    this.proxyFactory=proxyFactory; this.mailboxFactory=mailboxFactory;
    this.pollMs=pollMs;this.otpTimeoutMs=otpTimeoutMs;this.keepBrowserOnSuccess=keepBrowserOnSuccess;this.job=null;this.linger=null;
  }
  async closeLinger(){
    const l=this.linger;this.linger=null;
    if(!l)return;
    await l.browser?.close().catch(()=>{});
    await l.proxy?.close().catch(()=>{});
  }
  active(){return this.job && !terminal.has(this.job.state);}
  status(){
    if(!this.job)return {state:'idle',message:'Sẵn sàng tạo phiên mới.'};
    const {id,state,message,email,username,startedAt,protocol,ip,manualOnly,otp,saved}=this.job;
    return {id,state,message,email,username,startedAt,protocol,ip,manualOnly,otp,saved};
  }
  start(raw){
    if(this.active())throw Error('Đang có một phiên chạy. Hãy dừng phiên trước.');
    if(this.job?.state==='succeeded' && !this.job.saved)throw Error('Hãy lưu hoặc bỏ kết quả phiên trước.');
    const input=validateInput(raw);
    const job={id:randomUUID(),state:'starting',message:'Đang kiểm tra cấu hình…',platform:input.platform,email:input.email,username:input.username,startedAt:Date.now(),input,controller:new AbortController(),manualOnly:!input.accessKey&&!input.imap,saved:false};
    this.job=job;job.done=this.run(job);return this.status();
  }
  set(job,state,message){if(!job.controller.signal.aborted){job.state=state;job.message=message;}}
  submitOtp(code){
    const j=this.job;
    if(j?.state!=='waiting_otp')throw Error('Phiên chưa ở bước nhập OTP.');
    if(typeof code!=='string'||!/^\d{5,6}$/.test(code))throw Error('OTP cần đúng 5 hoặc 6 chữ số.');
    j.pendingOtp=code;j.state='verifying';j.message='Đang gửi mã xác nhận…';
  }
  resume(){
    if(this.job?.state!=='paused')throw Error('Phiên không ở trạng thái tạm dừng.');
    this.job.state='working';this.job.message='Đang kiểm tra bước hiện tại…';this.job.unknownSince=Date.now();
  }
  async updateEmail(email){
    const j=this.job;
    if(!j||terminal.has(j.state))throw Error('Không có phiên đang chạy.');
    const next=String(email||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next))throw Error('Email không hợp lệ.');
    if(j.input)j.input.email=next;
    j.email=next;
    if(j.browser?.updateEmail)await j.browser.updateEmail(next);
    return this.status();
  }
  async stop(){
    const j=this.job;
    if(!j || terminal.has(j.state)){await this.closeLinger();return this.status();}
    j.controller.abort();j.state='stopping';j.message='Đang đóng phiên…';
    await j.browser?.close().catch(()=>{});await j.done;await this.closeLinger();return this.status();
  }
  result(){
    if(this.job?.state!=='succeeded'||!this.job.result)throw Error('Phiên chưa có kết quả để lưu.');
    return {...this.job.result};
  }
  acknowledge(){if(this.job?.state!=='succeeded')throw Error('Chưa có kết quả.');this.job.saved=true;this.job.result=null;return this.status();}
  async run(j){
    const signal=j.controller.signal;let proxy,browser,box,seen=new Set(),success=false;
    try{
      await this.closeLinger();
      proxy=await this.proxyFactory(j.input.proxy,{signal});signal.throwIfAborted();
      j.protocol=proxy.protocol;j.ip=proxy.ip;
      if(j.input.accessKey||j.input.imap){
        try {box=this.mailboxFactory(j.input,signal);seen=await box.snapshot();}
        catch {signal.throwIfAborted();j.manualOnly=true;j.mailWarning='Không đọc được hộp thư; hãy nhập OTP thủ công.';}
      }
      this.set(j,'starting','Đang mở trình duyệt riêng…');
      browser=await this.browserFactory({proxy:proxy.server,signal,platform:j.input.platform});j.browser=browser;signal.throwIfAborted();
      this.set(j,'working','Đang điền thông tin đăng ký…');
      try {
        const filled=await browser.fill(j.input);signal.throwIfAborted();
        if(filled===false)this.set(j,'paused','Biểu mẫu khác dự kiến. Kiểm tra trình duyệt, hoàn tất bước hiện tại rồi bấm Tiếp tục.');
        else {j.since=Date.now();await browser.submit();}
      }catch {signal.throwIfAborted();this.set(j,'paused','Chưa gửi được biểu mẫu. Kiểm tra thông tin trong trình duyệt rồi bấm Tiếp tục.');}
      j.since ||= Date.now();j.unknownSince=Date.now();let birthdaySubmitted=false,lastOtpAt=0,lastMailAt=0;
      while(!signal.aborted){
        if(j.state==='paused'){await delay(this.pollMs,undefined,{signal});continue;}
        if(j.pendingOtp){const code=j.pendingOtp;j.pendingOtp=null;j.otp=code;await browser.submitOtp(code);lastOtpAt=Date.now();}
        let state;
        try {state=await browser.state();}
        catch (err) {
          if(err?.message==='browser_closed'||signal.aborted)throw err;
          state={kind:'unknown'};
        }
        signal.throwIfAborted();
        if(state.email&&state.email!==j.input.email){
          j.input.email=state.email;
          j.email=state.email;
          if(box&&'email' in box)box.email=state.email;
        }
        if(state.kind==='success'){
          if(j.input.platform==='instagram'&&state.username?.toLowerCase()!==j.input.username.toLowerCase())this.set(j,'paused','Tài khoản đang đăng nhập khác username đã nhập. Kiểm tra lại trình duyệt.');
          else{success=true;j.result={platform:j.input.platform,email:j.input.email,username:state.username||j.input.username,name:j.input.name,password:j.input.password,birthday:j.input.birthday,completedAt:Date.now(),jobId:j.id};break;}
        }else if(state.kind==='checkpoint'||state.kind==='error'){
          this.set(j,'paused','Nền tảng yêu cầu kiểm tra hoặc xác minh thêm. Xử lý trong trình duyệt rồi bấm Tiếp tục.');
        }else if(state.kind==='birthday'&&!birthdaySubmitted){
          try {await browser.fillBirthday(j.input.birthday);await browser.submit();birthdaySubmitted=true;j.unknownSince=Date.now();}
          catch {this.set(j,'paused','Hãy chọn ngày sinh trong trình duyệt và chuyển sang bước tiếp theo, rồi bấm Tiếp tục.');}
        }else if(state.kind==='otp'){
          j.unknownSince=Date.now();
          if(lastOtpAt && Date.now()-lastOtpAt<3000){await delay(this.pollMs,undefined,{signal});continue;}
          if(Date.now()-j.since>this.otpTimeoutMs)j.manualOnly=true;
          this.set(j,'waiting_otp',j.mailWarning || (j.manualOnly?'Nhập mã OTP 6 số từ hộp thư.':'Đang chờ OTP mới của đúng email…'));
          if(box&&!j.manualOnly&&Date.now()-lastMailAt>=3000){
            lastMailAt=Date.now();
            try{
              const match=await box.findOtp({since:j.since,seen,platform:j.input.platform});signal.throwIfAborted();
              if(match){seen.add(match.id);j.pendingOtp=match.code;this.set(j,'verifying','Đã nhận OTP mới, đang xác nhận…');}
            }catch {signal.throwIfAborted();j.manualOnly=true;j.mailWarning='Không đọc được hộp thư; hãy nhập OTP thủ công.';}
          }
        }else if(Date.now()-j.unknownSince>20000){
          this.set(j,'paused','Chưa xác định được bước hiện tại. Kiểm tra trình duyệt rồi bấm Tiếp tục.');
        }
        await delay(this.pollMs,undefined,{signal});
      }
    }catch (err) {
      console.error('[ig-tool] run error:',err?.stack||err?.message||err);
      if(!signal.aborted){
        const msg=err?.message==='browser_closed'
          ?'Trình duyệt đã bị đóng.'
          :'Không thể tiếp tục phiên. Kiểm tra proxy, kết nối, hoặc cài đặt trình duyệt rồi chạy lại.';
        this.set(j,'failed',msg);
      }
    }finally{
      if(success&&!signal.aborted&&this.keepBrowserOnSuccess){
        this.linger={browser,proxy};
      }else{
        await browser?.close().catch(()=>{});await proxy?.close().catch(()=>{});
      }
      j.browser=null;j.input=null;j.pendingOtp=null;
      if(signal.aborted){j.result=null;j.state='cancelled';j.message='Đã dừng và đóng phiên.';}
      else if(success){j.state='succeeded';j.message='Đã xác nhận đúng tài khoản đăng nhập. Đang chờ lưu vào kho.';}
      j.otp=null;
    }
  }
}
module.exports={Runner};
