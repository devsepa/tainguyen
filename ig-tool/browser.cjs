'use strict';
const {chromium,devices}=require('playwright');
const {observePage}=require('./diagnostics.cjs');

async function visible(locator){for(const item of await locator.all())if(await item.isVisible())return item;return null;}
const otpSelector='input[name="confirmationCode"],input[name="email_confirmation_code"],input[name="code"],input[name="c"],#code_in_cliff,input[autocomplete="one-time-code"]';

async function pressMobileOrClick(btn,isMobile){
  await btn.scrollIntoViewIfNeeded().catch(()=>{});
  if(isMobile){
    try{await btn.tap();return;}catch{}
  }
  await btn.click({force:true});
}

async function navigateToRegistration(page,{platform='instagram',device='desktop',startUrl,baseUrl}={}){
  const isMobile=device==='mobile';
  const isFb=platform==='facebook';
  const fromHome=device==='mobile'&&!startUrl;
  const igBase=baseUrl||'https://www.instagram.com';
  const fbBase=baseUrl||'https://m.facebook.com';
  const target=startUrl || (isFb?(fromHome?fbBase+'/':'https://www.facebook.com/r.php'):(fromHome?igBase+'/':igBase+'/accounts/emailsignup/'));
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});
  if(fromHome){
    // Follow the site's link rather than jumping into a later signup step.
    // This preserves whatever the home/login entry establishes in this context.
    const signupSelector=isFb
      ?'a[href*="/reg"]:visible,a[href*="/r.php"]:visible,a[href*="/signup"]:visible'
      :'a[href*="/accounts/signup"]:visible,a[href*="/accounts/emailsignup"]:visible';
    const signup=page.locator(signupSelector)
      .or(page.getByRole('button',{name:/^(đăng ký|sign up|create (?:new )?account|tạo tài khoản(?: mới)?)$/i}))
      .or(page.getByRole('link',{name:/^(đăng ký|sign up|create (?:new )?account|tạo tài khoản(?: mới)?)$/i})).first();
    await signup.waitFor({state:'visible',timeout:15000});
    await signup.click();
    if(isFb){
      const startLocator=page.getByRole('button',{name:/^(bắt đầu|get started)$/i})
        .or(page.getByRole('link',{name:/^(bắt đầu|get started)$/i}));
      await Promise.race([
        page.locator('input').first().waitFor({state:'visible',timeout:15000}).catch(()=>{}),
        startLocator.first().waitFor({state:'visible',timeout:15000}).catch(()=>{}),
      ]);
      const startBtn=await visible(startLocator);
      if(!(await page.locator('input').first().isVisible().catch(()=>false))&&startBtn){
        await pressMobileOrClick(startBtn,isMobile);
      }
    }
    await page.locator('input').first().waitFor({state:'visible',timeout:15000});
    const emailName=/^(đăng ký bằng email|sign up with email|dùng email(?: khác)?|use email(?: instead)?)$/i;
    if(!isFb&&/\/accounts\/signup\/phone\/?$/.test(new URL(page.url()).pathname)){
      const emailEntry=page.getByRole('button',{name:emailName}).or(page.getByRole('link',{name:emailName})).first();
      await emailEntry.waitFor({state:'visible',timeout:15000});
      await emailEntry.click();
      await page.waitForURL(url=>! /\/accounts\/signup\/phone\/?$/.test(url.pathname),{timeout:15000});
    }else if(isFb){
      const emailEntry=page.getByRole('button',{name:emailName}).or(page.getByRole('link',{name:emailName})).first();
      if(await emailEntry.isVisible().catch(()=>false)){
        await emailEntry.click();
      }
    }
  }
}

async function openBrowser({proxy,signal,headless=false,platform='instagram',device='desktop',startUrl,windowPosition}={}){
  const isMobile=device==='mobile';
  const isIg=platform!=='facebook';
  const winW=isMobile?460:(isIg?620:450), winH=isMobile?860:(isIg?800:700);
  const vpW=isMobile?430:(isIg?600:430), vpH=isMobile?760:(isIg?720:620);
  const zoomVal=isMobile?'0.82':(isIg?'0.85':'0.75');
  const posX=Number.isFinite(windowPosition?.x)?windowPosition.x:20;
  const posY=Number.isFinite(windowPosition?.y)?windowPosition.y:20;
  const browser=await chromium.launch({
    headless,
    proxy:proxy?{server:proxy}:undefined,
    args:headless?[]:[`--window-size=${winW},${winH}`,`--window-position=${posX},${posY}`],
  });
  const close=async()=>{await browser.close().catch(()=>{});};
  const abort=()=>{void close();};signal?.addEventListener('abort',abort,{once:true});
  try{
    signal?.throwIfAborted();
    const {defaultBrowserType:mobileEngine,...mobileOptions}=devices['Pixel 7'];
    if(isMobile&&mobileEngine!=='chromium')throw Error('mobile_profile_engine_mismatch');
    const ctxOpts=isMobile
      ? {...mobileOptions,locale:'vi-VN'}
      : {locale:'vi-VN',viewport:{width:vpW,height:vpH}};
    const context=await browser.newContext(ctxOpts);
    if(!headless){
      await context.exposeFunction('__igToolGetCookie',async()=>{
        const targetUrl=platform==='facebook'?'https://www.facebook.com':'https://www.instagram.com';
        const cookies=await context.cookies(targetUrl).catch(()=>[]);
        return cookies.map(c=>`${c.name}=${c.value}`).join('; ');
      });
      await context.addInitScript(()=>{
        if(window.top!==window.self)return;
        const mountBtn=()=>{
          if(!document.body||document.getElementById('__ig_tool_cookie_pill'))return;
          const el=document.createElement('div');
          el.id='__ig_tool_cookie_pill';
          el.textContent='📋 Copy Cookie';
          el.style.cssText='position:fixed;bottom:10px;right:10px;z-index:2147483647;padding:4px 9px;border-radius:999px;background:rgba(15,23,42,0.88);color:#34d399;border:1px solid rgba(52,211,153,0.45);font:600 11px/1.2 system-ui,sans-serif;cursor:pointer;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.35)';
          el.onclick=async()=>{
            try{
              const c=await window.__igToolGetCookie();
              if(!c){el.textContent='Chưa có cookie';setTimeout(()=>{el.textContent='📋 Copy Cookie';},1500);return;}
              if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(c);
              else{const ta=document.createElement('textarea');ta.value=c;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}
              el.textContent='✓ Đã copy Cookie';
              setTimeout(()=>{el.textContent='📋 Copy Cookie';},1600);
            }catch{el.textContent='Lỗi copy';setTimeout(()=>{el.textContent='📋 Copy Cookie';},1500);}
          };
          document.body.appendChild(el);
        };
        if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountBtn,{once:true});
        else mountBtn();
      });
    }
    if(!headless&&!isMobile){
      await context.addInitScript((z)=>{
        const apply=()=>{if(document.documentElement)document.documentElement.style.zoom=z;};
        if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
        else apply();
      },zoomVal);
    }
    let page=await context.newPage();page.setDefaultTimeout(8000);
    let observation=observePage(page);
    try{
      await navigateToRegistration(page,{platform,device,startUrl});
    }catch(err){
      signal?.throwIfAborted();
      const isHttpErr=/ERR_HTTP_RESPONSE_CODE_FAILURE|chrome-error/i.test(err?.message||'');
      if(!startUrl&&isHttpErr){
        observation.detach();
        await page.close().catch(()=>{});
        page=await context.newPage();page.setDefaultTimeout(8000);
        observation=observePage(page);
        const home=platform==='facebook'?'https://www.facebook.com/':'https://www.instagram.com/';
        await page.goto(home,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{throw Error('Nền tảng từ chối kết nối qua proxy này ở chế độ hiện tại. Thử đổi sang Desktop hoặc proxy khác.');});
        const regLink=await visible(page.locator('a[href*="emailsignup"],a[href*="/accounts/signup"],a[href*="/r.php"],a[href*="/reg/"]'));
        if(regLink)await regLink.click();
      }else{
        await navigateToRegistration(page,{platform,device,startUrl});
      }
    }
    await page.locator('input').first().waitFor({state:'visible',timeout:15000}).catch(()=>{});

    const typeField=async(el,text)=>{
      if(headless){await el.fill(text);return;}
      await el.click();
      await page.waitForTimeout(180);
      await el.fill('');
      await el.pressSequentially(String(text),{delay:35});
      await page.waitForTimeout(250);
    };
    const findInput=async(selector,label)=>{
      return await visible(page.locator(selector))
        || await visible(page.getByRole('textbox',{name:label}))
        || await visible(page.getByPlaceholder(label))
        || await visible(page.getByLabel(label))
        || await visible(page.locator('label').filter({hasText:label}).locator('input'))
        || await visible(page.locator('div').filter({hasText:label}).filter({has:page.locator('input')}).last().locator('input'));
    };

    const otpInput=async()=>await findInput(otpSelector,/mã xác nhận|nhập mã|confirmation code|security code/i)
      || (/confirmemail\.php/i.test(page.url())?await visible(page.locator('input[type="text"],input:not([type])')):null);
    const birthdayDateInput=async()=>await visible(page.locator('input[type="date"]'));
    const agreeButton=async()=>await visible(page.getByRole('button',{name:/^(tôi đồng ý|i agree|agree)$/i}));

    const findBirthdayField=async(name,pattern)=>{
      const titleName=name[0].toUpperCase()+name.slice(1)+':';
      return await visible(page.getByRole('combobox',{name:pattern}))
        || await visible(page.locator(`select[name="${name}"],select[name="birthday_${name}"],select[title="${titleName}"]`))
        || await visible(page.locator('[role="combobox"],button[aria-haspopup="listbox"],[role="button"][aria-haspopup="listbox"]').filter({hasText:pattern}))
        || await visible(page.getByRole('button',{name:pattern}));
    };

    const birthdayFields=async()=>{
      const fields=[];
      for(const [name,pattern] of [['day',/^ngày$|^day$/i],['month',/^tháng$|^month$/i],['year',/^năm$|^year$/i]]){
        fields.push([name,await findBirthdayField(name,pattern)]);
      }
      return fields;
    };

    const fillBirthday=async birthday=>{
      const dateInput=await birthdayDateInput();
      if(dateInput){
        await dateInput.fill(birthday);
        await dateInput.press('Tab');
        if(await dateInput.inputValue()!==birthday)throw Error('birthday_value_mismatch');
        return;
      }
      const [year,month,day]=birthday.split('-');
      const mNum=String(+month),dNum=String(+day);
      const enMonths=['January','February','March','April','May','June','July','August','September','October','November','December'];
      const enMonth=enMonths[+month-1]||'';
      const values={
        year:[year],
        month:[`Tháng ${mNum}`,`Tháng ${mNum.padStart(2,'0')}`,...(enMonth?[enMonth,enMonth.slice(0,3)]:[]),mNum,mNum.padStart(2,'0')],
        day:[dNum,dNum.padStart(2,'0')],
      };
      for(const [name,field] of await birthdayFields()){
        if(!field)throw Error('birthday_field_missing');
        const tag=await field.evaluate(el=>el.tagName);
        if(tag==='SELECT'){
          const selected=await field.evaluate((el,candidates)=>{
            const opts=[...el.options];
            for(const c of candidates){
              const byText=opts.find(o=>o.text.trim().toLowerCase()===c.toLowerCase());
              if(byText)return byText.value;
            }
            for(const c of candidates){
              const byVal=opts.find(o=>o.value===c);
              if(byVal)return byVal.value;
            }
            return null;
          },values[name]);
          if(selected===null)throw Error('birthday_option_missing');
          await field.selectOption(selected);
        }else{
          await field.click();
          await page.waitForTimeout(headless?40:200);
          const candidates=values[name];
          let picked=false;
          for(const text of candidates){
            const exact=new RegExp(`^\\s*${text}\\s*$`,'i');
            const opt=await visible(page.getByRole('option',{name:exact}))
              || await visible(page.getByRole('menuitem',{name:exact}))
              || await visible(page.getByRole('radio',{name:exact}))
              || await visible(page.locator('[role="listbox"] [role="option"],[role="menu"] [role="menuitem"],[role="dialog"] [role="button"],[role="dialog"] [role="option"],[role="listbox"] div,[role="menu"] div').filter({hasText:exact}))
              || await visible(page.getByText(exact));
            if(opt){await opt.scrollIntoViewIfNeeded().catch(()=>{});await opt.click();picked=true;break;}
          }
          if(!picked)throw Error('birthday_option_missing');
        }
      }
    };

    return {
      diagnostics(){return {engine:'chromium',device,profile:isMobile?'chrome-android':'desktop',events:observation.snapshot()};},
      async fill(input){
        if(platform==='facebook'){
          const parts=input.name.trim().split(/\s+/);
          const lastName=parts[0]||input.name;
          const firstName=parts.slice(1).join(' ')||lastName;
          let lastEl=await findInput('input[name="lastname"]',/^họ$|surname|last name/i);
          let firstEl=await findInput('input[name="firstname"]',/^tên$|first name/i);
          if(!lastEl&&!firstEl){
            const startBtn=await visible(
              page.getByRole('button',{name:/^(bắt đầu|get started)$/i})
                .or(page.getByRole('link',{name:/^(bắt đầu|get started)$/i}))
                .or(page.locator('[role="button"],button,a').filter({hasText:/^\s*(bắt đầu|get started)\s*$/i}))
            );
            if(startBtn){
              await pressMobileOrClick(startBtn,isMobile);
              await page.locator('input').first().waitFor({state:'visible',timeout:10000}).catch(()=>{});
              lastEl=await findInput('input[name="lastname"]',/^họ$|surname|last name/i);
              firstEl=await findInput('input[name="firstname"]',/^tên$|first name/i);
              if(!lastEl&&!firstEl)return 'pending';
            }else if(isMobile){
              return 'pending';
            }
          }
          const emailEl=await findInput('input[name="reg_email__"],input[name="email"]',/số di động hoặc email|email/i);
          const passEl=await findInput('input[name="reg_passwd__"],input[type="password"]',/mật khẩu mới|mật khẩu|password/i);
          if(lastEl&&firstEl&&!emailEl&&!passEl){
            await typeField(lastEl,lastName);
            await typeField(firstEl,firstName);
            return true;
          }
          if(!lastEl||!firstEl||!emailEl||!passEl)return false;
          await typeField(lastEl,lastName);
          await typeField(firstEl,firstName);
          const fields=await birthdayFields();
          if(await birthdayDateInput()||fields.some(([,field])=>field))await fillBirthday(input.birthday);
          const sexVal=input.gender==='male'?'2':'1';
          const genderRe=input.gender==='male'?/^nam$|^male$/i:/^nữ$|^female$/i;
          const sexEl=await visible(page.locator(`input[name="sex"][value="${sexVal}"]`));
          if(sexEl){await sexEl.click();}
          else{
            const genderBox=await visible(page.getByRole('combobox',{name:/giới tính|gender/i}))
              || await visible(page.locator('[role="combobox"],button[aria-haspopup="listbox"],[role="button"][aria-haspopup="listbox"]').filter({hasText:/chọn giới tính|giới tính|gender/i}));
            if(genderBox){
              await genderBox.click();
              const opt=await visible(page.getByRole('option',{name:genderRe}))
                || await visible(page.getByRole('menuitem',{name:genderRe}))
                || await visible(page.getByRole('radio',{name:genderRe}))
                || await visible(page.locator('[role="listbox"] [role="option"],[role="menu"] [role="menuitem"],[role="dialog"] [role="button"],[role="listbox"] div,[role="menu"] div').filter({hasText:genderRe}));
              if(opt)await opt.click();
            }else{
              const lblEl=await visible(page.getByLabel(genderRe));
              if(lblEl)await lblEl.click();
            }
          }
          await typeField(emailEl,input.email);
          const confirmEl=await visible(page.locator('input[name="reg_email_confirmation__"]'));
          if(confirmEl)await typeField(confirmEl,input.email);
          await typeField(passEl,input.password);
          if(!headless)await passEl.press('Tab').catch(()=>{});
          return true;
        }
        const specs=[
          ['email','input[name="emailOrPhone"],input[name="email"],input[type="email"]',/số di động hoặc email|mobile number or email|email/i],
          ['password','input[name="password"],input[type="password"],input[autocomplete="new-password"]',/mật khẩu|password/i],
          ['name','input[name="fullName"],input[name="full_name"]',/^tên$|tên đầy đủ|full name/i],
          ['username','input[name="username"]',/tên người dùng|username/i],
        ];
        const emailField=await findInput(specs[0][1],specs[0][2]);
        const passField=await findInput(specs[1][1],specs[1][2]);
        if(emailField&&!passField){
          await typeField(emailField,input.email);
          return true;
        }
        for(const [key,selector,label] of specs){
          const field=await findInput(selector,label);
          if(!field)return false;
          await typeField(field,input[key]);
        }
        const fields=await birthdayFields();
        if(await birthdayDateInput()||fields.some(([,field])=>field))await fillBirthday(input.birthday);
        return true;
      },
      fillBirthday,
      async fillStep(step,input){
        if(step==='password'){
          const f=await findInput('input[name="password"],input[name="reg_passwd__"],input[type="password"],input[autocomplete="new-password"]',/mật khẩu|password/i);
          if(!f)throw Error('step_field_missing');
          await typeField(f,input.password);
        }else if(step==='name'){
          const f=await findInput('input[name="fullName"],input[name="full_name"]',/^tên$|tên đầy đủ|full name/i);
          if(!f)throw Error('step_field_missing');
          await typeField(f,input.name);
        }else if(step==='username'){
          const f=await findInput('input[name="username"]',/tên người dùng|username/i);
          if(!f)throw Error('step_field_missing');
          if(await f.inputValue()!==input.username)await typeField(f,input.username);
          await f.press('Tab');
        }else if(step==='fb_name'){
          const parts=input.name.trim().split(/\s+/);
          const lastName=parts[0]||input.name;
          const firstName=parts.slice(1).join(' ')||lastName;
          const lastEl=await findInput('input[name="lastname"]',/^họ$|surname|last name/i) || await visible(page.locator('input').nth(0));
          const firstEl=await findInput('input[name="firstname"]',/^tên$|first name/i) || await visible(page.locator('input').nth(1));
          if(!lastEl||!firstEl)throw Error('step_field_missing');
          await typeField(lastEl,lastName);
          await typeField(firstEl,firstName);
        }else if(step==='fb_name_choice'){
          const firstRadio=await visible(page.locator('input[type="radio"],[role="radio"]'));
          if(firstRadio){
            const checked=await firstRadio.isChecked().catch(()=>false);
            if(!checked)await firstRadio.click();
          }
        }else if(step==='fb_gender'){
          const genderRe=input.gender==='male'?/^nam$|^male$/i:/^nữ$|^female$/i;
          const opt=await visible(page.getByRole('radio',{name:genderRe}))
            || await visible(page.getByLabel(genderRe))
            || await visible(page.locator('label,[role="radio"]').filter({hasText:genderRe}));
          if(!opt)throw Error('step_field_missing');
          await opt.click();
        }else if(step==='fb_email'){
          const f=await findInput('input[name="reg_email__"],input[name="email"],input[type="email"]',/^email$|số di động hoặc email|email/i);
          if(!f)throw Error('step_field_missing');
          await typeField(f,input.email);
        }
      },
      async updateEmail(newEmail){
        const emailEl=await findInput('input[name="reg_email__"],input[name="emailOrPhone"],input[name="email"],input[type="email"]',/số di động hoặc email|mobile number or email|email/i);
        if(!emailEl)return false;
        await typeField(emailEl,newEmail);
        return true;
      },
      async submit(){
        const btn=(platform==='facebook'?await visible(page.locator('button[name="websubmit"]')):null)
          || await visible(
            page.getByRole('button',{name:/^(gửi|đăng ký|sign up|submit|tiếp|tiếp tục|next|continue)$/i})
              .or(page.locator('[role="button"]').filter({hasText:/^\s*(gửi|đăng ký|sign up|submit|tiếp|tiếp tục|next|continue)\s*$/i}))
          );
        if(!btn)throw Error('submit_missing');
        if(!headless)await page.waitForTimeout(1200);
        await pressMobileOrClick(btn,isMobile);
      },
      async submitOtp(code){
        const field=await otpInput();if(!field)throw Error('otp_missing');await typeField(field,code);
        const button=await visible(page.getByRole('button',{name:/^(tiếp|tiếp tục|continue|next|confirm|xác nhận|gửi|submit)$/i}));
        if(!button)throw Error('confirm_missing');await pressMobileOrClick(button,isMobile);
      },
      async agreeToTerms(){
        const button=await agreeButton();if(!button)throw Error('terms_button_missing');await pressMobileOrClick(button,isMobile);
      },
      async skipOnboarding(){
        const button=await visible(
          page.getByRole('button',{name:/^(lúc khác|not now|bỏ qua|skip|đăng ký bằng email|sign up with email|bắt đầu|get started)$/i})
            .or(page.getByRole('link',{name:/^(lúc khác|not now|bỏ qua|skip|đăng ký bằng email|sign up with email|bắt đầu|get started)$/i}))
            .or(page.locator('[role="button"]').filter({hasText:/^\s*(lúc khác|not now|bỏ qua|skip|đăng ký bằng email|sign up with email|bắt đầu|get started)\s*$/i}))
        );
        if(!button)throw Error('skip_onboarding_missing');
        await pressMobileOrClick(button,isMobile);
      },
      async state(){
        if(page.isClosed())throw Error('browser_closed');
        const url=new URL(page.url());
        if(/challenge|checkpoint|two_factor|two_step/i.test(url.pathname) || await visible(page.locator('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="captcha"],input[name="captcha_response"]')))return {kind:'checkpoint'};
        if((platform==='facebook'||/\/accounts\/(?:signup|emailsignup)(?:\/|$)/i.test(url.pathname))&&await agreeButton()&&await visible(page.getByText(/để đăng ký|to sign up|terms|điều khoản/i)))return {kind:'consent'};
        const emailField=await findInput('input[name="reg_email__"],input[name="emailOrPhone"],input[name="email"],input[type="email"]',/số di động hoặc email|mobile number or email|email/i);
        let currentEmail=emailField?String(await emailField.inputValue().catch(()=>'')).trim():'';
        if(!currentEmail){
          currentEmail=await page.evaluate(()=>{
            const txt=document.body?.innerText||'';
            const m=txt.match(/(?:đã gửi (?:tới|đến)|sent to)\s+([^\s<>,"']+@[^\s<>,"']+)/i);
            return m?m[1].replace(/[.,;:!?]+$/,''):'';
          }).catch(()=>'');
        }
        const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail)?currentEmail.toLowerCase():undefined;
        if(await birthdayDateInput()&&!(await visible(page.locator('input[type="password"]'))))return {kind:'birthday',...(validEmail?{email:validEmail}:{})};
        const otpField=await otpInput();
        if(otpField){
          const rejected=await visible(page.getByText(/(?:confirmation|verification|security) code.{0,100}(?:invalid|expired)|(?:invalid|incorrect|expired).{0,50}(?:confirmation|verification|security) code|mã.{0,70}(?:không hợp lệ|không chính xác|hết hạn)/i));
          if(rejected)return {kind:'otp_rejected',reason:'invalid_or_expired',...(validEmail?{email:validEmail}:{})};
          return {kind:'otp',...(validEmail?{email:validEmail}:{})};
        }
        if(await visible(page.getByRole('alert')))return {kind:'error',...(validEmail?{email:validEmail}:{})};
        if(platform==='facebook'){
          const lastEl=await findInput('input[name="lastname"]',/^họ$|surname|last name/i);
          const passEl=await findInput('input[name="reg_passwd__"],input[type="password"]',/mật khẩu|password/i);
          if(lastEl&&!emailField&&!passEl)return {kind:'step',step:'fb_name'};
          if(!lastEl){
            if(await visible(page.getByText(/bạn tên gì|what'?s your name/i)))return {kind:'step',step:'fb_name'};
            const startBtn=await visible(
              page.getByRole('button',{name:/^(bắt đầu|get started)$/i})
                .or(page.getByRole('link',{name:/^(bắt đầu|get started)$/i}))
                .or(page.locator('[role="button"]').filter({hasText:/^\s*(bắt đầu|get started)\s*$/i}))
            );
            if(startBtn)return {kind:'onboarding'};
            if(await visible(page.getByText(/chọn tên của bạn|choose your name/i)))return {kind:'step',step:'fb_name_choice'};
            if(await visible(page.getByText(/giới tính của bạn là gì|what'?s your gender/i)))return {kind:'step',step:'fb_gender'};
            const switchEmailBtn=await visible(
              page.getByRole('button',{name:/^(đăng ký bằng email|sign up with email)$/i})
                .or(page.getByRole('link',{name:/^(đăng ký bằng email|sign up with email)$/i}))
            );
            if(switchEmailBtn)return {kind:'onboarding'};
            if(await visible(page.getByText(/lưu thông tin đăng nhập|save your login info/i))&&await visible(page.getByRole('button',{name:/^(lúc khác|not now)$/i})))return {kind:'onboarding'};
            if(emailField&&!(await visible(page.locator('input[type="password"]'))))return {kind:'step',step:'fb_email'};
            if(await findInput('input[name="reg_passwd__"],input[type="password"]',/mật khẩu|password/i))return {kind:'step',step:'password'};
          }
          if(!/\/r\.php|\/reg/.test(url.pathname)){
            const skipBtn=await visible(
              page.getByRole('button',{name:/^(bỏ qua|skip|lúc khác|not now)$/i})
                .or(page.getByRole('link',{name:/^(bỏ qua|skip|lúc khác|not now)$/i}))
            );
            if(skipBtn)return {kind:'onboarding'};
            const cookies=await context.cookies(['https://www.facebook.com','https://m.facebook.com']).catch(()=>[]);
            const cUser=cookies.find(c=>c.name==='c_user'&&/^\d+$/.test(c.value));
            if(cUser){
              const cookie=cookies.map(c=>`${c.name}=${c.value}`).join('; ');
              return {kind:'success',username:cUser.value,...(cookie?{cookie}:{})};
            }
          }
          return {kind:'unknown',...(validEmail?{email:validEmail}:{})};
        }
        if((await birthdayFields()).every(([,field])=>field) && !(await visible(page.locator('input[type="password"]'))))return {kind:'birthday',...(validEmail?{email:validEmail}:{})};
        if(platform==='instagram'&&!emailField){
          if(await findInput('input[name="password"],input[type="password"],input[autocomplete="new-password"]',/mật khẩu|password/i))return {kind:'step',step:'password'};
          if(await findInput('input[name="fullName"],input[name="full_name"]',/^tên$|tên đầy đủ|full name/i))return {kind:'step',step:'name'};
          if(await findInput('input[name="username"]',/tên người dùng|username/i))return {kind:'step',step:'username'};
        }
        if(platform==='instagram'&&await visible(page.getByText(/lưu thông tin đăng nhập|save your login info|kết nối với facebook|connect to facebook|thêm ảnh đại diện|add a profile photo|tải ứng dụng instagram|get the instagram app|thêm số điện thoại|add phone number/i))&&await visible(page.getByRole('button',{name:/^(lúc khác|not now|bỏ qua|skip)$/i}).or(page.getByRole('link',{name:/^(lúc khác|not now|bỏ qua|skip)$/i})))){
          return {kind:'onboarding'};
        }
        const igCookies=await context.cookies('https://www.instagram.com').catch(()=>[]);
        const hasIgSession=igCookies.some(c=>c.name==='ds_user_id'&&/^\d+$/.test(c.value));
        if(hasIgSession || await visible(page.locator('a[href^="/direct/inbox"],a[href="/explore/"],svg[aria-label="Trang chủ"],svg[aria-label="Home"]'))){
          const identity=await page.evaluate(async()=>{
            try{
              const csrf=(document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)||[])[1]||'';
              const response=await fetch('/api/v1/accounts/current_user/?edit=true',{
                credentials:'include',
                headers:{'X-IG-App-ID':'936619743392459',...(csrf?{'X-CSRFToken':csrf}:{})},
                signal:AbortSignal.timeout(8000),
              });
              if(response.ok){
                const data=await response.json();
                if(data.user?.username)return data.user.username;
              }
            }catch{}
            const profLink=document.querySelector('a[href^="/"]:has(img[alt*="ảnh đại diện" i]),a[href^="/"]:has(img[alt*="profile picture" i])');
            const href=profLink?.getAttribute('href')||'';
            const m=href.match(/^\/([a-z0-9._]+)\/?$/i);
            if(m)return m[1];
            const reserved=new Set(['explore','reels','direct','accounts','stories','p','reel','tv','emails','about','legal','privacy','terms','directory','nametag','your_activity','notifications','create']);
            const navLinks=[...document.querySelectorAll('nav a[href^="/"],[role="navigation"] a[href^="/"],header a[href^="/"]')];
            for(let i=navLinks.length-1;i>=0;i--){
              const h=navLinks[i].getAttribute('href')||'';
              const match=h.match(/^\/([a-z0-9._]+)\/?$/i);
              if(match&&!reserved.has(match[1].toLowerCase()))return match[1];
            }
            return null;
          });
          if(identity||hasIgSession){
            const cookie=igCookies.map(c=>`${c.name}=${c.value}`).join('; ');
            return {kind:'success',...(identity?{username:identity}:{}),...(cookie?{cookie}:{})};
          }
        }
        return {kind:'unknown',...(validEmail?{email:validEmail}:{})};
      },
      async close(){observation.detach();signal?.removeEventListener('abort',abort);await close();},
      async getCookies(){
        const targetUrls=platform==='facebook'?['https://www.facebook.com','https://m.facebook.com']:'https://www.instagram.com';
        const cookies=await context.cookies(targetUrls).catch(()=>[]);
        return cookies.map(c=>`${c.name}=${c.value}`).join('; ');
      },
    };
  }catch(error){signal?.removeEventListener('abort',abort);await close();throw error;}
}
module.exports={openBrowser,navigateToRegistration};
