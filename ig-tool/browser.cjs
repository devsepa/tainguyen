'use strict';
const {chromium}=require('playwright');

async function visible(locator){for(const item of await locator.all())if(await item.isVisible())return item;return null;}
const otpSelector='input[name="confirmationCode"],input[name="email_confirmation_code"],input[name="code"],input[name="c"],#code_in_cliff,input[autocomplete="one-time-code"],input[inputmode="numeric"]';

async function openBrowser({proxy,signal,headless=false,platform='instagram',startUrl}={}){
  const urlDefault=platform==='facebook'?'https://www.facebook.com/r.php':'https://www.instagram.com/accounts/emailsignup/';
  const targetUrl=startUrl||urlDefault;
  const browser=await chromium.launch({
    headless,
    proxy:proxy?{server:proxy}:undefined,
    args:headless?[]:['--window-size=450,700','--window-position=20,20'],
  });
  const close=async()=>{await browser.close().catch(()=>{});};
  const abort=()=>{void close();};signal?.addEventListener('abort',abort,{once:true});
  try{
    signal?.throwIfAborted();
    const context=await browser.newContext({locale:'vi-VN',viewport:{width:430,height:620}});
    if(!headless){
      await context.addInitScript(()=>{
        const apply=()=>{if(document.documentElement)document.documentElement.style.zoom='0.75';};
        if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
        else apply();
      });
    }
    const page=await context.newPage();page.setDefaultTimeout(8000);
    try{
      await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:45000});
    }catch(err){
      signal?.throwIfAborted();
      await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:45000});
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
      const [year,month,day]=birthday.split('-');
      const mNum=String(+month),dNum=String(+day);
      const values={
        year:[year],
        month:[mNum,mNum.padStart(2,'0'),`Tháng ${mNum}`,`Tháng ${mNum.padStart(2,'0')}`],
        day:[dNum,dNum.padStart(2,'0')],
      };
      for(const [name,field] of await birthdayFields()){
        if(!field)throw Error('birthday_field_missing');
        const tag=await field.evaluate(el=>el.tagName);
        if(tag==='SELECT'){
          const selected=await field.evaluate((el,candidates)=>{
            const option=[...el.options].find(o=>candidates.some(c=>o.value===c||o.text.trim().toLowerCase()===c.toLowerCase()));
            return option?option.value:null;
          },values[name]);
          if(selected===null)throw Error('birthday_option_missing');
          await field.selectOption(selected);
        }else{
          await field.click();
          const candidates=values[name];
          let picked=false;
          for(const text of candidates){
            const exact=new RegExp(`^${text}$`,'i');
            const opt=await visible(page.getByRole('option',{name:exact}))
              || await visible(page.getByRole('menuitem',{name:exact}))
              || await visible(page.getByRole('radio',{name:exact}))
              || await visible(page.locator('[role="listbox"] [role="option"],[role="menu"] [role="menuitem"],[role="dialog"] [role="button"],[role="listbox"] div,[role="menu"] div').filter({hasText:exact}));
            if(opt){await opt.click();picked=true;break;}
          }
          if(!picked)throw Error('birthday_option_missing');
        }
      }
    };

    return {
      async fill(input){
        if(platform==='facebook'){
          const parts=input.name.trim().split(/\s+/);
          const lastName=parts[0]||input.name;
          const firstName=parts.slice(1).join(' ')||lastName;
          const lastEl=await findInput('input[name="lastname"]',/^họ$|surname|last name/i);
          const firstEl=await findInput('input[name="firstname"]',/^tên$|first name/i);
          const emailEl=await findInput('input[name="reg_email__"],input[name="email"]',/số di động hoặc email|email/i);
          const passEl=await findInput('input[name="reg_passwd__"],input[type="password"]',/mật khẩu mới|mật khẩu|password/i);
          if(!lastEl||!firstEl||!emailEl||!passEl)return false;
          await typeField(lastEl,lastName);
          await typeField(firstEl,firstName);
          const fields=await birthdayFields();
          if(fields.some(([,field])=>field))await fillBirthday(input.birthday);
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
        for(const [key,selector,label] of specs){
          const field=await findInput(selector,label);
          if(!field)return false;
          await typeField(field,input[key]);
        }
        const fields=await birthdayFields();
        if(fields.some(([,field])=>field))await fillBirthday(input.birthday);
        return true;
      },
      fillBirthday,
      async updateEmail(newEmail){
        const emailEl=await findInput('input[name="reg_email__"],input[name="emailOrPhone"],input[name="email"],input[type="email"]',/số di động hoặc email|mobile number or email|email/i);
        if(!emailEl)return false;
        await typeField(emailEl,newEmail);
        return true;
      },
      async submit(){
        const btn=(platform==='facebook'?await visible(page.locator('button[name="websubmit"]')):null)
          || await visible(page.getByRole('button',{name:/^(gửi|đăng ký|sign up|submit|tiếp|tiếp tục|next|continue)$/i}));
        if(!btn)throw Error('submit_missing');
        if(!headless)await page.waitForTimeout(1200);
        await btn.click();
      },
      async submitOtp(code){
        const field=await otpInput();if(!field)throw Error('otp_missing');await field.fill(code);
        const button=await visible(page.getByRole('button',{name:/^(tiếp tục|continue|next|confirm|xác nhận|gửi|submit)$/i}));
        if(!button)throw Error('confirm_missing');await button.click();
      },
      async state(){
        if(page.isClosed())throw Error('browser_closed');
        const url=new URL(page.url());
        if(/challenge|checkpoint|two_factor|two_step/i.test(url.pathname) || await visible(page.locator('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="captcha"],input[name="captcha_response"]')))return {kind:'checkpoint'};
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
        if(await otpInput())return {kind:'otp',...(validEmail?{email:validEmail}:{})};
        if(await visible(page.getByRole('alert')))return {kind:'error',...(validEmail?{email:validEmail}:{})};
        if(platform==='facebook'){
          if(!/\/r\.php|\/reg/.test(url.pathname)){
            const cookies=await context.cookies('https://www.facebook.com').catch(()=>[]);
            const cUser=cookies.find(c=>c.name==='c_user'&&/^\d+$/.test(c.value));
            if(cUser)return {kind:'success',username:cUser.value};
          }
          return {kind:'unknown',...(validEmail?{email:validEmail}:{})};
        }
        if((await birthdayFields()).every(([,field])=>field) && !(await visible(page.locator('input[type="password"]'))))return {kind:'birthday',...(validEmail?{email:validEmail}:{})};
        if(await visible(page.locator('a[href^="/direct/inbox"]'))){
          const identity=await page.evaluate(async()=>{
            try{
              const response=await fetch('/api/v1/accounts/current_user/?edit=true',{credentials:'include',headers:{'X-IG-App-ID':'936619743392459'},signal:AbortSignal.timeout(8000)});
              if(!response.ok)return null;const data=await response.json();return data.user?.username || null;
            }catch{return null;}
          });
          if(identity)return {kind:'success',username:identity};
        }
        return {kind:'unknown',...(validEmail?{email:validEmail}:{})};
      },
      async close(){signal?.removeEventListener('abort',abort);await close();}
    };
  }catch(error){signal?.removeEventListener('abort',abort);await close();throw error;}
}
module.exports={openBrowser};
