const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseProxy, validateInput} = require('../input.cjs');
const {Mailbox, selectOtp} = require('../mailbox.cjs');

const valid = () => ({email:'person@example.edu',name:'Test Person',username:'test.person',password:'example-password',birthday:'2000-04-12',proxy:'',protocol:'auto'});
test('proxy parsing retains colons in passwords and encodes credentials', () => {
  const p = parseProxy('127.0.0.1:8123:test:pass:with:@symbols', 'auto');
  assert.equal(p.password,'pass:with:@symbols');
  assert.equal(p.host,'127.0.0.1'); assert.equal(p.port,8123);
  assert.throws(()=>parseProxy('127.0.0.1:0:a:b'), /port/i);
  assert.throws(()=>parseProxy('https://host:12:a:b'), /định dạng/i);
  assert.throws(()=>parseProxy('host:123:a:b','invalid'), /giao thức/i);
});
test('registration validates calendar dates and mandatory data before opening browser', () => {
  assert.equal(validateInput(valid()).username,'test.person');
  for (const patch of [{birthday:'2001-02-29'},{birthday:'2099-01-01'},{email:'bad'},{username:'space name'},{name:''},{password:'123'}]) {
    assert.throws(()=>validateInput({...valid(),...patch}));
  }
});
const since = Date.parse('2026-11-26T10:00:00Z');
const message = (patch={}) => ({id:2,from:{address:'security@mail.instagram.com'},to:'person@example.edu',subject:'Instagram confirmation 123456',body:'Your confirmation code is 123456',created_at:'2026-11-26T10:00:05Z',...patch});
test('OTP ignores old IDs, old dates, unrelated senders, wrong recipients, and ambiguous codes', () => {
  const opts = {email:'person@example.edu',since,seen:new Set(['1']),now:since+20000};
  for (const patch of [{id:1},{created_at:'2026-11-26T09:59:00Z'},{from:'attacker@example.com'},{to:'other@example.edu'},{created_at:null},{body:'codes 123456 and 654321',subject:'Instagram'}]) {
    assert.equal(selectOtp([message(patch)],opts),null,JSON.stringify(patch));
  }
  assert.deepEqual(selectOtp([message()],opts),{id:'2',code:'123456'});
  assert.deepEqual(selectOtp([message({created_at:'2026-11-26 10:00:05'})],opts),{id:'2',code:'123456'});
});
test('mailbox binds access and subsequent messages to the chosen key',async()=>{
  const calls=[];
  const box = new Mailbox({email:'person@example.edu',accessKey:'12345678-1234-4234-8234-123456789abc'}, {fetch:async(url,init)=>{
    calls.push([url,Object.fromEntries(init.body)]);
    return {ok:true,json:async()=>url.endsWith('/manage')?{client:{uuid:'client-id'}}:{messages:[message()]}};
  }});
  const seen=await box.snapshot(); assert(seen.has('2'));
  assert.equal(await box.findOtp({since,seen,now:since+20000}),null);
  assert.equal(calls.length,3); assert.equal(calls[1][1].client_uuid,'client-id');
  assert.equal(calls[2][1].email_uuid,'12345678-1234-4234-8234-123456789abc');
});
test('mailbox rejects provider failures rather than treating an unreadable inbox as empty',async()=>{
  const box=new Mailbox({email:'person@example.edu',accessKey:'12345678-1234-4234-8234-123456789abc'}, {fetch:async()=>({ok:true,json:async()=>({error:'denied'})})});
  await assert.rejects(()=>box.snapshot(),/hộp thư/i);
});
