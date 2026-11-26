const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Runner}=require('../runner.cjs');
const input=()=>({email:'person@example.edu',name:'Test Person',username:'test.person',password:'secret-for-test',birthday:'2000-01-02'});
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('condition timed out');}
function fixture({state={kind:'otp'},auto=false}={}) {
  const f={state,closed:0,submissions:[],otp:[],proxyClosed:0};
  f.runner=new Runner({pollMs:5,otpTimeoutMs:60,browserFactory:async()=>({fill:async()=>{},submit:async()=>{f.submissions.push(1)},fillBirthday:async()=>{},state:async()=>f.state,submitOtp:async code=>{f.otp.push(code);f.state={kind:'success',username:'test.person'}},close:async()=>{f.closed++}}),proxyFactory:async()=>({protocol:'http',ip:'203.0.113.8',server:'http://127.0.0.1:1',close:async()=>{f.proxyClosed++}}),mailboxFactory:()=>({snapshot:async()=>new Set(['old']),findOtp:async()=>auto?{id:'new',code:'123456'}:null})});
  return f;
}
test('one job at a time, manual OTP, success identity and retryable result',async()=>{
  const f=fixture(); f.runner.start(input());
  assert.throws(()=>f.runner.start(input()),/phiên/i);
  await until(()=>f.runner.status().state==='waiting_otp');
  assert.throws(()=>f.runner.submitOtp('12'),/6 chữ số/i);
  f.runner.submitOtp('123456');
  await until(()=>f.runner.status().state==='succeeded');
  assert.equal(f.runner.result().password,'secret-for-test');
  assert.equal(f.runner.result().username,'test.person');
  assert.equal(f.runner.result().username,'test.person','result remains available for failed-save retry');
  assert(!JSON.stringify(f.runner.status()).includes('secret-for-test'));
  assert.equal(f.submissions.length,1);assert.equal(f.closed,1);assert.equal(f.proxyClosed,1);
});
test('OTP submission does not itself imply success; mismatched identity pauses',async()=>{
  const f=fixture();f.runner.start(input());await until(()=>f.runner.status().state==='waiting_otp');
  f.state={kind:'success',username:'someone.else'};
  await until(()=>f.runner.status().state==='paused');assert.throws(()=>f.runner.result(),/chưa/i);
  await f.runner.stop();assert.equal(f.runner.status().state,'cancelled');
});
test('automatic OTP only after mailbox baseline and releases resources on success',async()=>{
  const f=fixture({auto:true});f.runner.start({...input(),accessKey:'12345678-1234-4234-8234-123456789abc'});
  await until(()=>f.runner.status().state==='succeeded');assert.deepEqual(f.otp,['123456']);assert.equal(f.closed,1);
});
test('proxy failure never opens browser or leaks credentials',async()=>{
  let launched=0;
  const runner=new Runner({proxyFactory:async()=>{throw Error('password-must-not-leak')},browserFactory:async()=>{launched++}});
  runner.start({...input(),proxy:'127.0.0.1:1234:alice:password-must-not-leak'});
  await until(()=>runner.status().state==='failed');assert.equal(launched,0);assert(!JSON.stringify(runner.status()).includes('password-must-not-leak'));
});
test('stop during browser startup closes late resources and cannot resurrect job',async()=>{
  let release,closed=0;
  const runner=new Runner({proxyFactory:async()=>({close:async()=>{}}),browserFactory:()=>new Promise(r=>release=r)});
  runner.start(input());await until(()=>!!release);
  const stopped=runner.stop();release({close:async()=>{closed++}});await stopped;
  assert.equal(runner.status().state,'cancelled');assert.equal(closed,1);
});
test('checkpoint pauses until explicit resume and timeout offers manual OTP',async()=>{
  const f=fixture({state:{kind:'checkpoint'}});f.runner.start(input());await until(()=>f.runner.status().state==='paused');
  f.state={kind:'otp'};f.runner.resume();await until(()=>f.runner.status().state==='waiting_otp');
  await until(()=>f.runner.status().manualOnly===true);await f.runner.stop();
});

test('mobile rejected OTP stops automatic polling and records metadata without the code',async t=>{
  let readCount=0;
  const f=fixture();t.after(()=>f.runner.stop());
  f.runner.mailboxFactory=()=>({snapshot:async()=>new Set(),findOtp:async()=>{readCount++;return {id:'message-17',code:'113499'};}});
  f.runner.browserFactory=async()=>({fill:async()=>true,submit:async()=>{},state:async()=>f.state,submitOtp:async()=>{f.state={kind:'otp_rejected',reason:'invalid_or_expired',email:'person@example.edu'};},close:async()=>{}});
  f.runner.start({...input(),device:'mobile',accessKey:'12345678-1234-4234-8234-123456789abc'});
  await until(()=>f.runner.status().state==='paused');
  const status=f.runner.status();assert.equal(status.manualOnly,true);assert.match(status.message,/từ chối|hết hạn/i);
  assert.equal(status.otpDiagnostic.device,'mobile');assert.equal(status.otpDiagnostic.source,'mailbox');
  assert.equal(status.otpDiagnostic.messageId,'message-17');assert.equal(status.otpDiagnostic.reason,'invalid_or_expired');
  assert(!JSON.stringify(status.otpDiagnostic).includes('113499'));
  const before=readCount;await new Promise(r=>setTimeout(r,25));assert.equal(readCount,before);
});

test('moving from OTP to birthday clears waiting-OTP status before filling the date',async t=>{
  let state={kind:'otp'},release,submits=0,date;
  const runner=new Runner({pollMs:5,proxyFactory:async()=>({close:async()=>{}}),browserFactory:async()=>({fill:async()=>true,submit:async()=>{if(++submits===2)state={kind:'success',username:'test.person'};},state:async()=>state,fillBirthday:async value=>{date=value;await new Promise(r=>release=r);},close:async()=>{}})});
  t.after(async()=>{release?.();await runner.stop();});runner.start(input());
  await until(()=>runner.status().state==='waiting_otp');state={kind:'birthday'};
  await until(()=>!!release);assert.equal(runner.status().state,'working');assert.equal(date,'2000-01-02');
  release();await until(()=>runner.status().state==='succeeded');assert.equal(submits,2);
});

test('username advances after delayed validation and terms are accepted once before confirmed success',async t=>{
  let state={kind:'step',step:'username'},submits=0,agreements=0,fills=0;
  const runner=new Runner({pollMs:5,stepRetryMs:15,proxyFactory:async()=>({close:async()=>{}}),browserFactory:async()=>({fill:async()=>true,fillStep:async()=>{fills++;},submit:async()=>{if(++submits===3)state={kind:'consent'};},agreeToTerms:async()=>{agreements++;state={kind:'unknown'};},state:async()=>state,close:async()=>{}})});
  t.after(()=>runner.stop());runner.start({...input(),device:'mobile'});
  await until(()=>agreements===1);assert.equal(fills,1);assert.equal(submits,3);
  assert.throws(()=>runner.result(),/chưa/);await new Promise(r=>setTimeout(r,25));assert.equal(agreements,1);
  state={kind:'success',username:'test.person'};
  await until(()=>runner.status().state==='succeeded');assert.equal(runner.result().username,'test.person');
});
