const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./ig-tool/node_modules/playwright');
test('warehouse exposes Mail domain tab and supports returning to existing mail tabs',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:740,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const original=fs.readFileSync(__dirname+'/index.html','utf8');
  const html=original.replace('        boot();',`        globalThis.setupDomainTest=()=>{mode='ready';localMode=true;authClient={auth:{getSession:async()=>({data:{session:{access_token:'test.jwt.token'}}})}};render();};`);
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/functions/v1/domain-mail'){
      const input=route.request().postDataJSON();
      const data=input.action==='list'?{domain:'devsepa.id.vn',mailboxes:[{email:'test@devsepa.id.vn'}]}:input.action==='create'?{mailbox:{email:input.local+'@devsepa.id.vn'}}:{messages:[]};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    if(url.hostname!=='localhost')return route.fulfill({contentType:'application/javascript',body:''});
    if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
    const types={'.js':'application/javascript; charset=utf-8','.css':'text/css'};
    const rel=url.pathname.slice(1);const allowed=['domain-mail.js','styles.css','ig-tool-ui.js','ig-tool-ui.css','supabase-config.js','supabase-store.js'];
    if(!allowed.includes(rel))return route.fulfill({status:404,body:''});
    const local=path.join(__dirname,rel);const file=fs.existsSync(local)?local:path.join(process.env.DOMAIN_TEST_BASE||__dirname,rel);
    return route.fulfill({contentType:types[path.extname(file)],body:fs.readFileSync(file)});
  });
  await page.goto('http://localhost/#gmail');await page.evaluate(()=>setupDomainTest());
  await page.getByRole('button',{name:'Mail domain',exact:true}).click();
  await page.getByRole('button',{name:'Đọc test@devsepa.id.vn'}).waitFor();
  await page.getByLabel('Tên địa chỉ mới').fill('created');await page.getByRole('button',{name:'Tạo địa chỉ',exact:true}).click();
  await page.getByRole('heading',{name:'Hộp thư: created@devsepa.id.vn'}).waitFor();
  await page.locator('[data-act="switchMailTab"][data-v="edu"]').click();
  assert.equal(await page.locator('[data-domain-mail]').count(),0);
  await page.getByRole('button',{name:'Mail domain',exact:true}).click();
  await page.getByRole('button',{name:'Đọc test@devsepa.id.vn'}).waitFor();
  assert.deepEqual(errors,[]);
});
