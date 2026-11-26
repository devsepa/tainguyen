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
