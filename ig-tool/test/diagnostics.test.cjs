const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registrationStage,summarizeResponse}=require('../diagnostics.cjs');

test('diagnostics classify registration routes without retaining URLs or query values',()=>{
  assert.equal(registrationStage('/api/v1/accounts/check_confirmation_code/'),'verify_code');
  assert.equal(registrationStage('/api/v1/accounts/send_verify_email/'),'send_code');
  assert.equal(registrationStage('/api/v1/accounts/send_confirmation_code/'),'send_code');
  assert.equal(registrationStage('/api/v1/bloks/apps/com.bloks.www.bloks.caa.reg.async/'),'registration');
  assert.equal(registrationStage('/ajax/bz'),'other');
});
test('diagnostics preserve only known error enums, not OTP, tokens or arbitrary messages',()=>{
  const summary=summarizeResponse(JSON.stringify({status:'fail',error_type:'invalid_nonce',message:'secret 849920',password:'invalid_code',csrftoken:'private',nested:{error_code:'rate_limit_error'}}));
  assert.deepEqual(summary,{outcome:'fail',errors:['invalid_nonce','rate_limit_error']});
  assert(!JSON.stringify(summary).includes('849920'));
  assert.deepEqual(summarizeResponse('for (;;);'+JSON.stringify({status:'ok',error_type:'private-user@example.edu'})),{outcome:'ok',errors:[]});
  assert.deepEqual(summarizeResponse('<html>not-json secret</html>'),{errors:[]});
});
