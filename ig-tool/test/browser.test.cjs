const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {openBrowser}=require('../browser.cjs');
async function waitFor(fn){for(let i=0;i<40;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out waiting for form');}
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
