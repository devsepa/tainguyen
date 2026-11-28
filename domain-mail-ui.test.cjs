const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./ig-tool/node_modules/playwright');
test('domain tab creates alias, reads only selected inbox and isolates message HTML',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:740,height:850}});
  const requests=[];
  await page.route('**/*',async route=>{
    if(route.request().url().endsWith('/domain-mail.js'))return route.fulfill({contentType:'application/javascript; charset=utf-8',body:fs.readFileSync(__dirname+'/domain-mail.js','utf8')});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<div id="mount"></div><script src="/domain-mail.js"></script>'});
  });
  await page.goto('http://localhost/');
  await page.exposeFunction('fakeApi',body=>{
    requests.push(body);
    if(body.action==='list')return {domain:'devsepa.id.vn',mailboxes:[{email:'one@devsepa.id.vn'}]};
    if(body.action==='create')return {mailbox:{email:body.local+'@devsepa.id.vn'}};
    return {messages:[{id:'1',subject:'Test message',sender:'sender@example.com',body_type:'html',body:'<script>parent.hacked=true</script><p>Message content</p>',received_at:'2026-11-27T00:00:00Z'}]};
  });
  await page.evaluate(()=>{window.handle=DomainMail.mount(document.querySelector('#mount'),{request:body=>window.fakeApi(body),canWrite:()=>true,pollMs:0});});
  await page.waitForFunction(()=>document.querySelector('#mount').textContent.includes('one@devsepa.id.vn'),{},{timeout:1500}).catch(async err=>{throw Error((await page.locator('#mount').innerText())+' '+JSON.stringify(requests));});
  await page.getByRole('button',{name:'Đọc one@devsepa.id.vn'}).click();
  await page.waitForSelector('iframe');
  assert.equal(requests.find(x=>x.action==='messages').email,'one@devsepa.id.vn');
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'');
  assert.equal(await page.evaluate(()=>window.hacked),undefined);
  await page.getByLabel('Tên địa chỉ mới').fill('created');await page.getByRole('button',{name:'Tạo địa chỉ',exact:true}).click();
  await page.getByRole('button',{name:'Đọc created@devsepa.id.vn'}).waitFor();
  await page.evaluate(()=>window.handle.destroy());
});
