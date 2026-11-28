const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('./ig-tool/node_modules/playwright');

test('account card actions respond to icon clicks in a narrow window',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:740,height:850},permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  html=html.replace('        boot();',`        globalThis.testAccounts=()=>{mode='ready';localMode=true;const a={uid:'synthetic.user',platform:'instagram',igUsername:'synthetic.user',name:'Synthetic User',email:'synthetic@example.com',status:'live',sec:{pass:'synthetic-password',cookie:'synthetic-cookie'}};shards[hash(a.uid)][a.uid]=a;render();};`);
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='localhost')return route.fulfill({body:'',contentType:'application/javascript'});
    if(url.pathname==='/')return route.fulfill({body:html,contentType:'text/html'});
    const files={'/styles.css':'text/css','/ig-tool-ui.css':'text/css','/ig-tool-ui.js':'application/javascript','/supabase-config.js':'application/javascript','/supabase-store.js':'application/javascript'};
    const type=files[url.pathname];
    return route.fulfill({body:type?fs.readFileSync(path.join(__dirname,url.pathname.slice(1))):'',contentType:type||'text/plain'});
  });
  await page.goto('http://localhost/#tai-khoan');
  await page.evaluate(()=>testAccounts());
  await page.evaluate(()=>{location.hash='#tao-ig';});
  await page.waitForSelector('.ig-tool-grid');
  await page.evaluate(()=>{location.hash='#tai-khoan';});
  const show=page.locator('[data-act="show"][data-v="synthetic.user|pass"]');
  await show.locator('svg').click();
  await assert.equal(await page.locator('[data-label="Mật khẩu"] .mono').innerText(),'synthetic-password');
  await page.locator('[data-act="cp"][data-v="synthetic.user|pass"] svg').click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'synthetic-password');
  assert.deepEqual(errors,[]);
});
