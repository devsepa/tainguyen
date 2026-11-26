'use strict';
const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {validateInput}=require('./input.cjs');
const {connectProxy}=require('./proxy.cjs');
const {Mailbox}=require('./mailbox.cjs');
const {ImapMailbox}=require('./imap.cjs');

const terminal=new Set(['idle','succeeded','failed','cancelled']);
class Runner {
  constructor({browserFactory,proxyFactory=connectProxy,mailboxFactory=(input,signal)=>input.imap?new ImapMailbox(input,{signal}):new Mailbox(input,{signal}),pollMs=1000,otpTimeoutMs=180000,stepRetryMs=5000,completionTimeoutMs=60000,keepBrowserOnSuccess=false,windowPosition,canUseEmail,onStop}={}) {
    this.browserFactory=browserFactory || require('./browser.cjs').openBrowser;
    this.proxyFactory=proxyFactory; this.mailboxFactory=mailboxFactory;
    this.pollMs=pollMs;this.otpTimeoutMs=otpTimeoutMs;this.keepBrowserOnSuccess=keepBrowserOnSuccess;this.job=null;this.linger=null;
    this.stepRetryMs=stepRetryMs;this.completionTimeoutMs=completionTimeoutMs;
    this.windowPosition=windowPosition;this.canUseEmail=canUseEmail;this.onStop=onStop;
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
    const {id,state,message,email,username,startedAt,protocol,ip,manualOnly,otp,saved,otpDiagnostic}=this.job;
    const networkDiagnostic=this.job.browser?.diagnostics?.() || this.job.networkDiagnostic;
    return {id,state,message,email,username,startedAt,protocol,ip,manualOnly,otp,saved,...(otpDiagnostic?{otpDiagnostic:{...otpDiagnostic}}:{}),...(networkDiagnostic?{networkDiagnostic}:{})};
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
    j.otpDiagnostic={device:j.input.device,source:'manual',email:j.email,challengeStartedAt:j.since};
    j.pendingOtp=code;j.state='verifying';j.message='Đang gửi mã xác nhận…';
  }
  resume(){
    if(this.job?.state!=='paused')throw Error('Phiên không ở trạng thái tạm dừng.');
    this.job.state='working';this.job.message='Đang kiểm tra bước hiện tại…';this.job.unknownSince=Date.now();this.job.otpWaitSince=null;
  }
  async updateEmail(email){
    const j=this.job;
    if(!j||terminal.has(j.state))throw Error('Không có phiên đang chạy.');
    const next=String(email||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next))throw Error('Email không hợp lệ.');
    if(this.canUseEmail&&!this.canUseEmail(next,j.id))throw Error('Email này đang được dùng ở phiên khác.');
    if(j.input)j.input.email=next;
    j.email=next;
    if(j.browser?.updateEmail)await j.browser.updateEmail(next);
    return this.status();
  }
  async stop(){
    const j=this.job;
    try{
      if(!j || terminal.has(j.state)){await this.closeLinger();return this.status();}
      j.controller.abort();j.state='stopping';j.message='Đang đóng phiên…';
      await j.browser?.close().catch(()=>{});await j.done;await this.closeLinger();return this.status();
    }finally{
      if(j&&this.onStop)this.onStop(j.id);
    }
  }
  result(){
    if(this.job?.state!=='succeeded'||!this.job.result)throw Error('Phiên chưa có kết quả để lưu.');
    return {...this.job.result};
  }
  acknowledge(){if(this.job?.state!=='succeeded')throw Error('Chưa có kết quả.');this.job.saved=true;this.job.result=null;return this.status();}
  mailboxUrl(){return this.job?.input?.accessKey?`https://tempamail.com/access?key=${this.job.input.accessKey}`:null;}
  async cookies(){
    const b=this.job?.browser||this.linger?.browser;
    if(!b?.getCookies)throw Error('Trình duyệt đã đóng hoặc chưa sẵn sàng.');
    return await b.getCookies();
  }
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
      browser=await this.browserFactory({proxy:proxy.server,signal,platform:j.input.platform,device:j.input.device,...(this.windowPosition?{windowPosition:this.windowPosition}:{})});j.browser=browser;signal.throwIfAborted();
      this.set(j,'working','Đang điền thông tin đăng ký…');
      try {
        const filled=await browser.fill(j.input);signal.throwIfAborted();
        if(filled===false)this.set(j,'paused','Biểu mẫu khác dự kiến. Kiểm tra trình duyệt, hoàn tất bước hiện tại rồi bấm Tiếp tục.');
        else {j.since=Date.now();await browser.submit();}
      }catch {signal.throwIfAborted();this.set(j,'paused','Chưa gửi được biểu mẫu. Kiểm tra thông tin trong trình duyệt rồi bấm Tiếp tục.');}
      j.since ||= Date.now();j.unknownSince=Date.now();let birthdaySubmitted=false,lastOtpAt=0,lastMailAt=0;
      let pendingStep=null,termsSubmittedAt=null;
      while(!signal.aborted){
        if(j.state==='paused'){await delay(this.pollMs,undefined,{signal});continue;}
        if(j.pendingOtp){
          const code=j.pendingOtp;j.pendingOtp=null;j.otp=code;
          if(j.otpDiagnostic)j.otpDiagnostic.submittedAt=Date.now();
          await browser.submitOtp(code);lastOtpAt=Date.now();
        }
        let state;
        try {state=await browser.state();}
        catch (err) {
          if(err?.message==='browser_closed'||signal.aborted)throw err;
          state={kind:'unknown'};
        }
        signal.throwIfAborted();
        if(state.kind!=='step'&&state.kind!=='unknown')pendingStep=null;
        if(state.email&&state.email!==j.input.email){
          const next=String(state.email).trim().toLowerCase();
          if(this.canUseEmail&&!this.canUseEmail(next,j.id)){
            this.set(j,'paused','Email trong trình duyệt đang trùng với phiên khác. Hãy đổi email khác rồi bấm Tiếp tục.');
            await delay(this.pollMs,undefined,{signal});
            continue;
          }
          j.input.email=next;
          j.email=next;
          if(box&&'email' in box)box.email=next;
        }
        if(state.kind==='success'){
          if(j.input.platform==='instagram'&&state.username&&state.username.toLowerCase()!==j.input.username.toLowerCase())this.set(j,'paused','Tài khoản đang đăng nhập khác username đã nhập. Kiểm tra lại trình duyệt.');
          else{success=true;j.result={platform:j.input.platform,email:j.input.email,accessKey:j.input.accessKey||'',username:state.username||j.input.username,name:j.input.name,password:j.input.password,birthday:j.input.birthday,cookie:state.cookie||'',completedAt:Date.now(),jobId:j.id};break;}
        }else if(state.kind==='otp_rejected'){
          j.pendingOtp=null;j.otp=null;j.manualOnly=true;
          j.otpDiagnostic={device:j.input.device,source:'manual_or_unknown',email:j.email,challengeStartedAt:j.since,...j.otpDiagnostic,reason:state.reason || 'invalid_or_expired',rejectedAt:Date.now()};
          this.set(j,'paused','Instagram đã từ chối mã OTP hoặc mã hết hạn. Tool đã dừng tự gửi mã. Kiểm tra đúng email và yêu cầu mã mới trong chính cửa sổ này, nhập trực tiếp rồi bấm Tiếp tục trong tool.');
        }else if(state.kind==='checkpoint'||state.kind==='error'){
          this.set(j,'paused','Nền tảng yêu cầu kiểm tra hoặc xác minh thêm. Xử lý trong trình duyệt rồi bấm Tiếp tục.');
        }else if(state.kind==='consent'){
          if(!termsSubmittedAt){
            this.set(j,'working','Đang đồng ý điều khoản đăng ký…');
            termsSubmittedAt=Date.now();
            try{await browser.agreeToTerms();this.set(j,'working','Đã bấm Tôi đồng ý. Đang chờ hoàn tất và xác nhận tài khoản…');}
            catch{signal.throwIfAborted();this.set(j,'paused','Chưa hoàn tất bước Tôi đồng ý. Kiểm tra trình duyệt rồi bấm Tiếp tục trong tool.');}
          }else if(Date.now()-termsSubmittedAt>this.completionTimeoutMs){
            this.set(j,'paused','Chưa xác nhận được tài khoản sau bước Tôi đồng ý. Kiểm tra trình duyệt rồi bấm Tiếp tục.');
          }
        }else if(state.kind==='onboarding'&&browser.skipOnboarding){
          this.set(j,'working','Đang bỏ qua các bước thiết lập sau đăng ký…');
          try{await browser.skipOnboarding();j.unknownSince=Date.now();}
          catch{signal.throwIfAborted();}
        }else if(state.kind==='birthday'&&!birthdaySubmitted){
          this.set(j,'working','Đang điền ngày sinh đã chọn…');
          try {await browser.fillBirthday(j.input.birthday);await browser.submit();birthdaySubmitted=true;j.unknownSince=Date.now();}
          catch {this.set(j,'paused','Hãy chọn ngày sinh trong trình duyệt và chuyển sang bước tiếp theo, rồi bấm Tiếp tục.');}
        }else if(state.kind==='step'&&state.step&&browser.fillStep){
          try{
            if(!pendingStep||pendingStep.step!==state.step){
              this.set(j,'working','Đang điền thông tin và chuyển bước…');
              await browser.fillStep(state.step,j.input);await browser.submit();
              pendingStep={step:state.step,at:Date.now(),attempts:1};j.unknownSince=Date.now();
            }else if(Date.now()-pendingStep.at>this.stepRetryMs){
              // A successful click is not proof that username validation advanced.
              // Retry Next once without retyping and restarting validation.
              if(state.step==='username'&&pendingStep.attempts<2){
                await browser.submit();pendingStep.at=Date.now();pendingStep.attempts++;
              }else this.set(j,'paused','Bước hiện tại chưa chuyển tiếp. Kiểm tra thông báo trong trình duyệt, bấm Tiếp rồi Tiếp tục trong tool.');
            }
          }catch{signal.throwIfAborted();this.set(j,'paused','Kiểm tra thông tin bước hiện tại trong trình duyệt rồi bấm Tiếp tục.');}
        }else if(state.kind==='otp'){
          j.unknownSince=Date.now();
          if(!j.otpWaitSince)j.otpWaitSince=Date.now();
          if(lastOtpAt && Date.now()-lastOtpAt<3000){await delay(this.pollMs,undefined,{signal});continue;}
          if(Date.now()-j.otpWaitSince>this.otpTimeoutMs)j.manualOnly=true;
          this.set(j,'waiting_otp',j.mailWarning || (j.manualOnly?'Nhập mã OTP 6 số từ hộp thư.':'Đang chờ OTP mới của đúng email…'));
          if(box&&!j.manualOnly&&Date.now()-lastMailAt>=3000){
            lastMailAt=Date.now();
            try{
              const match=await box.findOtp({since:j.since,seen,platform:j.input.platform});signal.throwIfAborted();
              if(match){
                seen.add(match.id);j.pendingOtp=match.code;
                j.otpDiagnostic={device:j.input.device,source:'mailbox',email:j.email,messageId:match.id,challengeStartedAt:j.since,selectedAt:Date.now()};
                this.set(j,'verifying','Đã nhận OTP mới cho đúng email, đang xác nhận…');
              }
            }catch {signal.throwIfAborted();j.manualOnly=true;j.mailWarning='Không đọc được hộp thư; hãy nhập OTP thủ công.';}
          }
        }else if(termsSubmittedAt&&Date.now()-termsSubmittedAt<=this.completionTimeoutMs){
          this.set(j,'working','Đã bấm Tôi đồng ý. Đang chờ hoàn tất và xác nhận tài khoản…');
        }else if(Date.now()-j.unknownSince>20000){
          this.set(j,'paused','Chưa xác định được bước hiện tại. Kiểm tra trình duyệt rồi bấm Tiếp tục.');
        }
        await delay(this.pollMs,undefined,{signal});
      }
    }catch (err) {
      if(!signal.aborted){
        console.error('[ig-tool] run error:',err?.stack||err?.message||err);
        const msg=err?.message==='browser_closed'
          ?'Trình duyệt đã bị đóng.'
          :'Không thể tiếp tục phiên. Kiểm tra proxy, kết nối, hoặc cài đặt trình duyệt rồi chạy lại.';
        this.set(j,'failed',msg);
      }
    }finally{
      j.networkDiagnostic=browser?.diagnostics?.();
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
const DEFAULT_POSITIONS=[{x:20,y:20},{x:500,y:20}];

class MultiRunner {
  constructor({maxJobs=2,...runnerOptions}={}){
    this.maxJobs=maxJobs;
    this.runnerOptions=runnerOptions;
    this.jobs=new Map();
    this.slots=new Map();
  }
  isEmailAvailable(email,excludeJobId){
    const norm=String(email||'').trim().toLowerCase();
    if(!norm)return true;
    for(const [id,runner] of this.jobs){
      if(id===excludeJobId)continue;
      const current=String(runner.job?.email||'').trim().toLowerCase();
      if(current&&current===norm)return false;
    }
    return true;
  }
  allocateSlot(){
    const used=new Set(this.slots.values());
    for(let i=0;i<this.maxJobs;i++)if(!used.has(i))return i;
    return this.jobs.size;
  }
  start(raw){
    const input=validateInput(raw);
    if(this.jobs.size>=this.maxJobs){
      throw Error(`Tối đa ${this.maxJobs} phiên chạy cùng lúc.`);
    }
    if(!this.isEmailAvailable(input.email)){
      throw Error('Email này đang được dùng ở phiên khác.');
    }
    const slot=this.allocateSlot();
    const windowPosition=DEFAULT_POSITIONS[slot]||{x:20+slot*480,y:20};
    const runner=new Runner({
      ...this.runnerOptions,
      windowPosition,
      canUseEmail:(email,jobId)=>this.isEmailAvailable(email,jobId),
      onStop:(jobId)=>{this.jobs.delete(jobId);this.slots.delete(jobId);},
    });
    const st=runner.start(raw);
    this.jobs.set(st.id,runner);
    this.slots.set(st.id,slot);
    return st;
  }
  resolve(jobId){
    if(!jobId||typeof jobId!=='string')throw Error('Thiếu jobId.');
    const runner=this.jobs.get(jobId);
    if(!runner)throw Error(`Không tìm thấy phiên với jobId ${jobId}.`);
    return runner;
  }
  list(){
    return {jobs:[...this.jobs.values()].map(r=>r.status())};
  }
  async shutdown(){
    const runners=[...this.jobs.values()];
    await Promise.all(runners.map(r=>r.stop().catch(()=>{})));
    this.jobs.clear();
    this.slots.clear();
  }
}

module.exports={Runner,MultiRunner};
