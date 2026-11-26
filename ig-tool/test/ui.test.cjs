const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createToolServer}=require('../server.cjs');
const {Runner}=require('../runner.cjs');

test('UI shows rejected OTP diagnostics without rendering the code or credentials',async t=>{
  const app=createToolServer({prefsFile:null,runner:{status:()=>({state:'paused',message:'Instagram đã từ chối mã OTP hoặc mã hết hạn.',email:'person@example.edu',otpDiagnostic:{device:'mobile',source:'mailbox',email:'person@example.edu',messageId:'message-17',submittedAt:1795687200000,rejectedAt:1795687203000,reason:'invalid_or_expired'},networkDiagnostic:{engine:'chromium',device:'mobile',profile:'iphone-safari-ua',events:[{at:1795687200000,stage:'verify_code',httpStatus:200,outcome:'fail',errors:['invalid_nonce']}]}}),stop:async()=>{}}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  const base='http://127.0.0.1:'+app.server.address().port;
  await page.route('**/test-diagnostics',route=>route.fulfill({contentType:'text/html',body:'<div id="mount"></div><script src="/ig-tool-ui.js"></script>'}));
  await page.goto(base+'/test-diagnostics');
  await page.evaluate(()=>{window.IgTool.mount(document.getElementById('mount'),{canWrite:true,mails:[]});});
  await page.waitForSelector('[data-ig-slot="otp-diagnostic"]');
  const diagnostic=await page.locator('[data-ig-slot="otp-diagnostic"]').innerText();
  assert.match(diagnostic,/Mobile/);assert.match(diagnostic,/message-17/);assert.match(diagnostic,/bị từ chối|hết hạn/);
  const network=await page.locator('[data-ig-slot="network-diagnostic"]').innerText();
  assert.match(network,/invalid_nonce/);assert.match(network,/HTTP 200/);assert.match(network,/fail/);
  assert.equal(await page.locator('button[data-act="submit-otp"]').count(),0);
  assert.equal(await page.locator('button[data-act="resume"]').count(),1);
});

test('UI handles proxy test, manual OTP, failed save retry and read-only role',async t=>{
  let stage='otp';
  const runner=new Runner({
    pollMs:15,
    proxyFactory:async()=>({server:'http://127.0.0.1:1',protocol:'socks5',ip:'203.0.113.9',close:async()=>{}}),
    browserFactory:async()=>({
      fill:async()=>true,
      submit:async()=>{},
      fillBirthday:async()=>{},
      submitOtp:async code=>{stage=code==='654321'?'success':'otp';},
      state:async()=>stage==='success'?{kind:'success',username:'ui.tester'}:{kind:'otp'},
      close:async()=>{},
    }),
  });
  const app=createToolServer({
    proxyFactory:async()=>({server:'http://127.0.0.1:1',protocol:'socks5',ip:'203.0.113.9',close:async()=>{}}),
    runner,
    prefsFile:null,
  });
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;

  const browser=await chromium.launch({headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();

  // Load a minimal host page from the same origin that pulls ig-tool-ui.js and ig-tool-ui.css
  await page.route(base+'/test-host',async route=>{
    await route.fulfill({
      status:200,
      contentType:'text/html; charset=utf-8',
      body:'<!doctype html><html><head><link rel="stylesheet" href="/ig-tool-ui.css"></head><body><div id="mount"></div><script src="/ig-tool-ui.js"></script></body></html>',
    });
  });

  await page.goto(base+'/test-host');
  await page.evaluate(()=>{
    window.__saves=[];
    window.__shouldFailSave=true;
    window.__handle=window.IgTool.mount(document.getElementById('mount'),{
      canWrite:true,
      mails:[{email:'u1@example.edu',accessKey:''}],
      save:async result=>{
        window.__saves.push(result);
        if(window.__shouldFailSave)return false;
        return true;
      },
    });
  });

  await page.waitForSelector('[data-ig="name"]');
  await page.fill('[data-ig="name"]','UI Tester');
  await page.fill('[data-ig="username"]','ui.tester');
  await page.fill('[data-ig="password"]','fake-pass-123');
  await page.fill('[data-ig="proxy"]','127.0.0.1:9000:user:secret');

  await page.click('button[data-act="test-proxy"]');
  await page.waitForFunction(()=>document.body.innerText.includes('203.0.113.9'));

  await page.click('button[data-act="start"]');
  await page.waitForSelector('[data-ig="otp"]');
  await page.fill('[data-ig="otp"]','654321');
  await page.click('button[data-act="submit-otp"]');

  await page.waitForSelector('button[data-act="save-result"]');
  // First save fails -> result remains retryable
  await page.click('button[data-act="save-result"]');
  await page.waitForFunction(()=>document.body.innerText.includes('thất bại')||document.body.innerText.includes('thử lại'));
  assert.equal(await page.isVisible('button[data-act="save-result"]'),true);

  // Second save (manual retry) succeeds -> acknowledged
  await page.evaluate(()=>{window.__shouldFailSave=false;});
  await page.click('button[data-act="save-result"]');
  await page.waitForFunction(()=>document.body.innerText.includes('Đã lưu tài khoản vào kho.'));
  const saves=await page.evaluate(()=>window.__saves);
  assert.equal(saves.length,2);
  assert.equal(saves[0].username,'ui.tester');

  // Read-only role disables controls
  await page.evaluate(()=>{
    window.__handle.destroy();
    window.IgTool.mount(document.getElementById('mount'),{
      canWrite:false,
      mails:[{email:'u1@example.edu',accessKey:''}],
      save:async()=>true,
    });
  });
  await page.waitForFunction(()=>document.body.innerText.includes('Chỉ xem'));
  assert.equal(await page.isDisabled('button[data-act="start"]'),true);
  assert.equal(await page.isDisabled('button[data-act="test-proxy"]'),true);

  // Proxy & birthday persist across reload via localStorage
  await page.reload();
  await page.evaluate(()=>{
    window.IgTool.mount(document.getElementById('mount'),{
      canWrite:true,
      mails:[{email:'u1@example.edu',accessKey:''}],
      save:async()=>true,
    });
  });
  await page.waitForSelector('[data-ig="proxy"]');
  assert.equal(await page.inputValue('[data-ig="proxy"]'),'127.0.0.1:9000:user:secret');
});
