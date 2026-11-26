const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {openBrowser,navigateToRegistration}=require('../browser.cjs');
const {chromium}=require('playwright');
const {Runner}=require('../runner.cjs');
async function waitFor(fn){for(let i=0;i<40;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out waiting for form');}

test('Facebook mobile dismisses the Meta account prompt before clicking signup underneath',async t=>{
  let registered=0;
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url==='/reg/'){registered++;return res.end('<input name="firstname">');}
    res.end(`<!doctype html><html><body><a href="/reg/">Tạo tài khoản mới</a><div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:white;z-index:99"><span>Nếu đã đăng nhập vào Instagram, Messenger hoặc Threads, bạn có thể dùng tài khoản đó.</span><button onclick="this.parentElement.remove()">Hủy</button></div></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(800);
  await navigateToRegistration(page,{platform:'facebook',device:'mobile',headless:true,baseUrl:'http://127.0.0.1:'+server.address().port});
  assert.equal(registered,1);assert.equal(await page.locator('[aria-modal="true"]').count(),0);
  assert.equal(await page.locator('input[name="firstname"]').count(),1);
});

test('mobile completes username validation, accepts signup terms once and waits for authenticated identity',async t=>{
  let accepted=0;
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/api/v1/accounts/current_user/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({user:{username:'test.person'}}));}
    if(req.url==='/agree'){accepted++;return res.end('{}');}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><h1>Tạo tên người dùng</h1><label>Tên người dùng<input name="username" value="test.person"></label><button disabled>Tiếp</button><script>
      const next=document.querySelector('button');setTimeout(()=>{next.disabled=false},300);
      next.onclick=()=>{document.body.innerHTML='<h1>Để đăng ký, hãy đọc cũng như đồng ý với các điều khoản và chính sách của chúng tôi</h1><button>Tôi đồng ý</button>';document.querySelector('button').onclick=async()=>{await fetch('/agree',{method:'POST'});document.body.innerHTML='<p>Đang tải…</p>';setTimeout(()=>{document.body.innerHTML='<a href="/direct/inbox/">Inbox</a>'},350);};};
    </script></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const runner=new Runner({pollMs:20,proxyFactory:async()=>({close:async()=>{}}),browserFactory:async()=>{
    const browser=await openBrowser({headless:true,device:'mobile',startUrl:'http://127.0.0.1:'+server.address().port+'/accounts/signup/username/'});
    // Start at a later wizard screen, as after an OTP/birthday transition.
    let initial=true;
    return {...browser,fill:async()=>true,submit:async()=>{if(initial){initial=false;return;}await browser.submit();}};
  }});
  t.after(()=>runner.stop());
  runner.start({email:'person@example.edu',name:'Test Person',username:'test.person',password:'fake-password',birthday:'1995-05-05',device:'mobile'});
  for(let i=0;i<120;i++){if(runner.status().state==='succeeded')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(runner.status().state,'succeeded');assert.equal(accepted,1);assert.equal(runner.result().username,'test.person');
});

for(const entry of ['link','button','phone-button'])test(`mobile starts at home and follows signup in the same initialized browser session (${entry})`,async t=>{
  const visits=[];
  const server=http.createServer((req,res)=>{
    if(req.url==='/favicon.ico')return res.end();
    visits.push(req.url);res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url==='/'){
      res.setHeader('Set-Cookie','registration_init=fixture-session; Path=/; HttpOnly');
      const destination=entry==='phone-button'?'/accounts/signup/phone/':'/accounts/signup/email/';
      return res.end(entry==='link'?`<!doctype html><html><body><a href="${destination}">Đăng ký</a></body></html>`:`<!doctype html><html><body><button onclick="location.href='${destination}'">đăng ký</button></body></html>`);
    }
    if(req.url==='/accounts/signup/phone/'){
      res.setHeader('Set-Cookie','registration_stage=phone; Path=/; HttpOnly');
      return res.end('<!doctype html><html><body><input type="tel"><button onclick="location.href=\'/accounts/signup/email/\'">Đăng ký bằng email</button></body></html>');
    }
    if(req.url==='/accounts/signup/email/'){
      if(!/registration_init=fixture-session/.test(req.headers.cookie||'')){res.statusCode=400;return res.end('Missing registration initialization');}
      if(entry==='phone-button'&&!/registration_stage=phone/.test(req.headers.cookie||'')){res.statusCode=400;return res.end('Missing phone-to-email initialization');}
      return res.end('<!doctype html><html><body><input name="email"></body></html>');
    }
    res.statusCode=404;res.end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();
  await navigateToRegistration(page,{platform:'instagram',device:'mobile',baseUrl:'http://127.0.0.1:'+server.address().port});
  assert.deepEqual(visits,entry==='phone-button'?['/','/accounts/signup/phone/','/accounts/signup/email/']:['/','/accounts/signup/email/']);
  assert.equal(await page.locator('input[name="email"]').count(),1);
});
test('real browser fills supplied form, submits OTP and checks authenticated identity',async t=>{
  let submitted;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/api/v1/accounts/current_user/?edit=true'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({user:{username:'test.person'}}));}
    if(req.url==='/filled'){let body='';for await(const chunk of req)body+=chunk;submitted=JSON.parse(body);return res.end('{}');}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><body><form id="signup"><input name="emailOrPhone"><input type="password" name="password"><input name="fullName"><input name="username"><select aria-label="Ngày"><option value="2">2</option></select><select aria-label="Tháng"><option value="1">1</option></select><select aria-label="Năm"><option value="2000">2000</option></select><button>Gửi</button></form><script>
    document.querySelector('form').onsubmit=async e=>{e.preventDefault();await fetch('/filled',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});document.body.innerHTML='<form><input name="confirmationCode"><button>Tiếp tục</button></form>';document.querySelector('form').onsubmit=e=>{e.preventDefault();if(document.querySelector('input').value==='123456')document.body.innerHTML='<a href="/direct/inbox/">Inbox</a>';else document.body.innerHTML='<p role="alert">Invalid</p>';};};
    </script></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  assert.equal(await browser.fill({email:'person@example.edu',password:'fake-secret',name:'Test Person',username:'test.person',birthday:'2000-01-02'}),true);
  await browser.submit();await waitFor(async()=>(await browser.state()).kind==='otp');
  assert.equal(submitted.emailOrPhone,'person@example.edu');assert.equal(submitted.username,'test.person');assert.equal(submitted.password,'fake-secret');
  await browser.submitOtp('123456');await waitFor(async()=>(await browser.state()).kind==='success');
  assert.deepEqual(await browser.state(),{kind:'success',username:'test.person'});
});

test('real browser handles async-rendered Meta form with placeholder inputs and custom comboboxes',async t=>{
  let submitted=null;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/meta-submit'){let body='';for await(const chunk of req)body+=chunk;submitted=JSON.parse(body);return res.end('{}');}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><div id="root"></div><script>
      setTimeout(()=>{
        document.getElementById('root').innerHTML=\`
          <form id="meta">
            <input id="f-email" placeholder="Số di động hoặc email">
            <input id="f-pass" type="password" placeholder="Mật khẩu">
            <div role="combobox" aria-label="Ngày" tabindex="0">Ngày</div>
            <div role="combobox" aria-label="Tháng" tabindex="0">Tháng</div>
            <div role="combobox" aria-label="Năm" tabindex="0">Năm</div>
            <input id="f-name" placeholder="Tên đầy đủ">
            <input id="f-user" placeholder="Tên người dùng">
            <button type="submit">Gửi</button>
          </form>
          <div id="menu" role="listbox" hidden></div>
        \`;
        const picked={};
        const opts={Ngày:['15'],Tháng:['Tháng 1'],Năm:['2000']};
        for(const cb of document.querySelectorAll('[role="combobox"]')){
          cb.onclick=()=>{
            const label=cb.getAttribute('aria-label');
            const menu=document.getElementById('menu');
            menu.innerHTML=opts[label].map(v=>\`<div role="option">\${v}</div>\`).join('');
            menu.hidden=false;
            for(const o of menu.querySelectorAll('[role="option"]')){
              o.onclick=()=>{picked[label]=o.textContent;cb.textContent=o.textContent;menu.hidden=true;};
            }
          };
        }
        document.getElementById('meta').onsubmit=async e=>{
          e.preventDefault();
          await fetch('/meta-submit',{method:'POST',body:JSON.stringify({
            email:document.getElementById('f-email').value,
            name:document.getElementById('f-name').value,
            username:document.getElementById('f-user').value,
            picked
          })});
        };
      }, 150);
    </script></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  assert.equal(await browser.fill({email:'meta@example.edu',password:'fake-secret',name:'Meta User',username:'meta.user',birthday:'2000-01-15'}),true);
  await browser.submit();
  await waitFor(()=>submitted!==null);
  assert.equal(submitted.email,'meta@example.edu');
  assert.equal(submitted.username,'meta.user');
  assert.deepEqual(submitted.picked,{Ngày:'15',Tháng:'Tháng 1',Năm:'2000'});
});

test('real browser detects floating-label OTP input even when an alert element is present',async t=>{
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><div role="alert">Thông báo</div><div><span>Mã xác nhận</span><input id="otp-box" type="text"></div><button>Tiếp tục</button></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  assert.deepEqual(await browser.state(),{kind:'otp'});
});

test('mobile OTP reports invalid or expired code even without an alert role',async t=>{
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><h1>Nhập mã xác nhận</h1><p>Chúng tôi đã gửi đến person@example.edu.</p><label>Mã xác nhận<input name="confirmationCode" aria-invalid="true" value="113499"></label><p>The confirmation code you entered is invalid or has expired. Please make sure you entered your confirmation code correctly.</p><button>Tiếp</button></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,device:'mobile',startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  const state=await browser.state();
  assert.equal(state.kind,'otp_rejected');assert.equal(state.email,'person@example.edu');
  assert.equal(state.reason,'invalid_or_expired');
});

test('mobile native birthday is not OTP and submits the requested calendar date',async t=>{
  let submitted;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/birthday'){let body='';for await(const chunk of req)body+=chunk;submitted=JSON.parse(body);return res.end('{}');}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><h1>Ngày sinh của bạn là khi nào?</h1><form><label>Ngày sinh (0 tuổi)<input type="date" name="birthday" inputmode="numeric" value="2026-11-26"></label><button>Tiếp</button></form><script>
      let changed=false;document.querySelector('input').addEventListener('change',()=>{changed=true;});
      document.querySelector('form').onsubmit=async e=>{e.preventDefault();await fetch('/birthday',{method:'POST',body:JSON.stringify({birthday:document.querySelector('input').value,changed})});};
    </script></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,device:'mobile',startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  assert.equal((await browser.state()).kind,'birthday');
  await assert.rejects(()=>browser.submitOtp('123456'),/otp_missing/);
  await browser.fillBirthday('1995-05-05');await browser.submit();await waitFor(()=>!!submitted);
  assert.deepEqual(submitted,{birthday:'1995-05-05',changed:true});
});

test('mobile diagnostics observe direct manual confirmation without reading request credentials',async t=>{
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/api/v1/accounts/check_confirmation_code/')){
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({status:'fail',error_type:'invalid_nonce',message:'849920 should not be exposed',token:'private-token'}));
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><input name="confirmationCode"><p id="message"></p><button>Tiếp</button><script>
      document.querySelector('button').onclick=async()=>{await fetch('/api/v1/accounts/check_confirmation_code/?secret=do-not-log',{method:'POST',body:JSON.stringify({code:'849920',password:'do-not-log'})});document.querySelector('#message').textContent='The confirmation code you entered is invalid or has expired.';};
      setTimeout(()=>document.querySelector('button').click(),250);
    </script></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,device:'mobile',startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  await waitFor(async()=>(await browser.state()).kind==='otp_rejected');
  await waitFor(()=>browser.diagnostics().events.some(event=>event.errors.includes('invalid_nonce')));
  const data=browser.diagnostics();
  assert.equal(data.engine,'chromium');
  assert.equal(data.events.at(-1).stage,'verify_code');assert.equal(data.events.at(-1).httpStatus,200);
  assert.deepEqual(data.events.at(-1).errors,['invalid_nonce']);
  for(const sensitive of ['849920','do-not-log','private-token'])assert(!JSON.stringify(data).includes(sensitive));
});

test('real browser fills Facebook registration form and detects Facebook OTP screen',async t=>{
  let submitted=null;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/fb-submit'){let body='';for await(const chunk of req)body+=chunk;submitted=JSON.parse(body);return res.end('{}');}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body>
      <form id="fb">
        <input name="lastname"><input name="firstname">
        <input name="reg_email__"><input type="password" name="reg_passwd__">
        <select name="birthday_day"><option value="15">15</option></select>
        <select name="birthday_month"><option value="1">1</option></select>
        <select name="birthday_year"><option value="2000">2000</option></select>
        <input type="radio" name="sex" value="1"><input type="radio" name="sex" value="2">
        <button name="websubmit" type="submit">Đăng ký</button>
      </form>
      <script>
        document.getElementById('fb').onsubmit=async e=>{
          e.preventDefault();
          await fetch('/fb-submit',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
          document.body.innerHTML='<input name="code" id="code_in_cliff"><button>Tiếp tục</button>';
        };
      </script>
    </body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,platform:'facebook',startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  assert.equal(await browser.fill({platform:'facebook',gender:'male',email:'fb@example.edu',password:'nguyenduy1805',name:'Hoang Quoc Nhi',username:'',birthday:'2000-01-15'}),true);
  await browser.submit();
  await waitFor(async()=>(await browser.state()).kind==='otp');
  assert.equal(submitted.lastname,'Hoang');
  assert.equal(submitted.firstname,'Quoc Nhi');
  assert.equal(submitted.reg_email__,'fb@example.edu');
  assert.equal(submitted.sex,'2');
});

test('real browser handles Facebook Meta form with gender combobox and Gui button',async t=>{
  let submitted=null;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/fb-meta'){let body='';for await(const chunk of req)body+=chunk;submitted=JSON.parse(body);return res.end('{}');}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body>
      <form id="fbm">
        <input placeholder="Họ"><input placeholder="Tên">
        <div role="combobox" aria-label="Ngày">Ngày</div>
        <div role="combobox" aria-label="Tháng">Tháng</div>
        <div role="combobox" aria-label="Năm">Năm</div>
        <div role="combobox" aria-label="Giới tính">Chọn giới tính</div>
        <input placeholder="Số di động hoặc email">
        <input type="password" placeholder="Mật khẩu">
        <button type="submit">Gửi</button>
      </form>
      <div id="pop" role="listbox" hidden></div>
      <script>
        let gender='';
        const opts={Ngày:['15'],Tháng:['Tháng 1'],Năm:['2000'],'Giới tính':['Nữ','Nam']};
        for(const cb of document.querySelectorAll('[role="combobox"]')){
          cb.onclick=()=>{
            const k=cb.getAttribute('aria-label');const pop=document.getElementById('pop');
            pop.innerHTML=opts[k].map(v=>'<div role="option">'+v+'</div>').join('');
            pop.hidden=false;
            for(const o of pop.querySelectorAll('[role="option"]')){
              o.onclick=()=>{if(k==='Giới tính')gender=o.textContent;cb.textContent=o.textContent;pop.hidden=true;};
            }
          };
        }
        document.getElementById('fbm').onsubmit=async e=>{
          e.preventDefault();
          await fetch('/fb-meta',{method:'POST',body:JSON.stringify({gender})});
        };
      </script>
    </body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,platform:'facebook',startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  assert.equal(await browser.fill({platform:'facebook',gender:'female',email:'fb2@example.edu',password:'nguyenduy1805',name:'Ngo Anh Nhi',username:'',birthday:'2000-01-15'}),true);
  await browser.submit();
  await waitFor(()=>submitted!==null);
  assert.equal(submitted.gender,'Nữ');
});

test('real browser detects Facebook confirmemail.php OTP input',async t=>{
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><html><body><h2>Nhập mã xác nhận</h2><p>Hãy nhập mã gồm 5 chữ số mà chúng tôi đã gửi đến edited.fb@devsepa.id.vn.</p><input name="c" type="text"><button>Tiếp tục</button></body></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,platform:'facebook',startUrl:`http://127.0.0.1:${server.address().port}/confirmemail.php?next=undefined`});t.after(()=>browser.close());
  assert.deepEqual(await browser.state(),{kind:'otp',email:'edited.fb@devsepa.id.vn'});
});

test('real browser supports mobile device emulation mode',async t=>{
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><p id="ua"></p><input name="emailOrPhone"><input type="password" name="password"><input name="fullName"><input name="username"><script>document.getElementById('ua').textContent=navigator.userAgent;</script></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,device:'mobile',startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  assert.equal(await browser.fill({email:'m@example.edu',password:'fake-secret',name:'Mobile User',username:'mob.user',birthday:'2000-01-15'}),true);
});

test('mobile uses a Chromium mobile profile consistently in HTTP and JavaScript',async t=>{
  let profile;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/profile'){
      let body='';for await(const chunk of req)body+=chunk;
      profile={httpUa:req.headers['user-agent'],...JSON.parse(body)};return res.end('{}');
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><input name="email"><script>
      fetch('/profile',{method:'POST',body:JSON.stringify({jsUa:navigator.userAgent,touch:navigator.maxTouchPoints,width:innerWidth})});
    </script></body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,device:'mobile',startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  await waitFor(()=>!!profile);
  assert.match(profile.httpUa,/Android/);assert.match(profile.httpUa,/Chrome\//);
  assert(!/iPhone|Version\/.*Safari\//.test(profile.httpUa));
  assert.equal(profile.jsUa,profile.httpUa);assert(profile.touch>0);assert(profile.width<500);
  assert.equal(browser.diagnostics().profile,'chrome-android');
});

test('facebook mobile starts at home and follows signup into registration',async t=>{
  const {chromium}=require('playwright');
  const {navigateToRegistration}=require('../browser.cjs');
  const seen=[];
  const server=http.createServer((req,res)=>{
    seen.push(req.url);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url==='/'){
      res.end('<!doctype html><html><body><a href="/reg/">Tạo tài khoản mới</a></body></html>');
    }else if(req.url==='/reg/'){
      res.end('<!doctype html><html><body><button onclick="location.href=\'/reg/phone/\'">Bắt đầu</button></body></html>');
    }else if(req.url==='/reg/phone/'){
      res.end('<!doctype html><html><body><input name="reg_phone__"><a href="/reg/email/">Đăng ký bằng email</a></body></html>');
    }else{
      res.end('<!doctype html><html><body><input name="reg_email__"></body></html>');
    }
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();
  const base='http://127.0.0.1:'+server.address().port;
  await navigateToRegistration(page,{platform:'facebook',device:'mobile',baseUrl:base});
  assert.deepEqual(seen,['/','/reg/','/reg/phone/','/reg/email/']);
  assert.match(page.url(),/\/reg\/email\/$/);
});

test('birthday selects match month text before zero-indexed option values',async t=>{
  let picked={};
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/picked'){
      let body='';for await(const chunk of req)body+=chunk;
      picked=JSON.parse(body);return res.end('{}');
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><body>
      <select title="Day:"><option value="1">1</option><option value="15">15</option></select>
      <select title="Month:"><option value="0">Tháng 1</option><option value="1">Tháng 2</option><option value="2">Tháng 3</option><option value="3">Tháng 4</option></select>
      <select title="Year:"><option value="2000">2000</option></select>
      <button type="button" onclick="fetch('/picked',{method:'POST',body:JSON.stringify({day:document.querySelector('[title=\\'Day:\\']').value,month:document.querySelector('[title=\\'Month:\\']').selectedOptions[0].textContent,year:document.querySelector('[title=\\'Year:\\']').value})})">Tiếp</button>
    </body></html>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await openBrowser({headless:true,startUrl:'http://127.0.0.1:'+server.address().port});t.after(()=>browser.close());
  await browser.fillBirthday('2000-03-15');
  await browser.submit();
  await waitFor(()=>!!picked.month);
  assert.deepEqual(picked,{day:'15',month:'Tháng 3',year:'2000'});
});
