const {test}=require('node:test');
const assert=require('node:assert/strict');
const tls=require('node:tls');
const {execFileSync}=require('node:child_process');
const {ImapMailbox,ImapClient,parseMessage}=require('../imap.cjs');

test('startup snapshot searches UIDs without downloading message bodies',async()=>{
  const commands=[];
  const box=new ImapMailbox({email:'person@example.com',imap:{user:'test@gmail.com',pass:'test'}},{clientFactory:()=>({
    async connect(){},async command(cmd){commands.push(cmd);return {lines:cmd==='UID SEARCH ALL'?['* SEARCH 12 18 30']:[]};},close(){}
  })});
  assert.deepEqual(await box.snapshot(),new Set(['12','18','30']));
  assert.equal(commands.some(cmd=>cmd.includes('FETCH')),false);
});

// Generate self-signed cert in-memory via node:crypto? Node 22 doesn't have built-in X509 generator,
// so test ImapMailbox against a real TLS server only if openssl is available, or test parseHeaders/decodeBody + mock ImapClient.
const {parseHeaders,decodeBody}=require('../imap.cjs');

test('IMAP reads both literals when Gmail returns body before header on the continuation line',async()=>{
  const body='Your code is 123456\r\n',header='From: security@mail.instagram.com\r\nSubject: Instagram code\r\n\r\n';
  const client=new ImapClient();client.socket={write(){}};
  client.buffer=Buffer.from(`* 1 FETCH (BODY[TEXT] {${Buffer.byteLength(body)}}\r\n${body} BODY[HEADER.FIELDS (FROM SUBJECT)] {${Buffer.byteLength(header)}}\r\n${header} UID 55)\r\nA1 OK completed\r\n`);
  const response=await client.command('UID FETCH 55 (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)] BODY.PEEK[TEXT])');
  assert.deepEqual(response.literals,[body,header]);
});

test('closing IMAP rejects pending reads instead of leaving mailbox loading forever',async()=>{
  for(const method of ['readLine','readBytes']){
    const client=new ImapClient();client.socket={destroyed:false,destroy(){this.destroyed=true;}};
    const result=client[method](5).then(()=> 'resolved',()=> 'closed');client.close();
    const outcome=await Promise.race([result,new Promise(r=>setTimeout(()=>r('still-pending'),25))]);
    assert.equal(outcome,'closed',method);
  }
});

test('full Gmail MIME message decodes headers, multipart alternatives and original recipient',async()=>{
  const html='<p>Mã xác nhận Instagram của bạn: <b>123456</b></p>';
  const raw=Buffer.from([
    'From: Instagram <security@mail.instagram.com>',
    'To: Test User <person@devsepa.id.vn>',
    'Subject: =?UTF-8?B?'+Buffer.from('Mã xác nhận Instagram').toString('base64')+'?=',
    'Date: Thu, 26 Nov 2026 12:00:00 +0000',
    'MIME-Version: 1.0','Content-Type: multipart/alternative; boundary="test-boundary"','',
    '--test-boundary','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: quoted-printable','','Your Instagram code is 123456',
    '--test-boundary','Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(html).toString('base64'),'--test-boundary--',''
  ].join('\r\n'));
  const mail=await parseMessage(raw,'55');
  assert.equal(mail.id,'55');assert.equal(mail.subject,'Mã xác nhận Instagram');
  assert.match(mail.from,/security@mail.instagram.com/);assert.match(mail.to,/person@devsepa.id.vn/);
  assert.equal(mail.created_at,'2026-11-26T12:00:00.000Z');assert.equal(mail.body,html);
  assert(!mail.body.includes('test-boundary'));
});

test('parseHeaders and decodeBody handle MIME encoded subjects and quoted-printable bodies',()=>{
  const hdr='From: Instagram <security@mail.instagram.com>\r\nTo: User <u1@devsepa.id.vn>\r\nSubject: =?UTF-8?B?TcOjIHjDoWMgbmgqbiBJbnN0YWdyYW0=?=\r\nDate: Thu, 26 Nov 2026 07:00:00 +0000\r\nContent-Transfer-Encoding: quoted-printable';
  const parsed=parseHeaders(hdr);
  assert.equal(parsed.from,'Instagram <security@mail.instagram.com>');
  assert.equal(parsed.to,'User <u1@devsepa.id.vn>');
  assert.match(parsed.subject,/Instagram/);
  const body=decodeBody('Your code=20is=3A=20123456=0D=0A',hdr);
  assert.match(body,/Your code is: 123456/);
});

test('ImapMailbox filters messages by recipient, time and seen set',async()=>{
  const box=new ImapMailbox({email:'u1@devsepa.id.vn',imap:{user:'c@devsepa.id.vn',pass:'p'}});
  box.fetchRecent=async()=>[
    {id:'10',created_at:'2026-11-26T06:50:00Z',from:'security@mail.instagram.com',to:'u1@devsepa.id.vn',subject:'Instagram code',body:'Your code is 111111'},
    {id:'11',created_at:'2026-11-26T07:01:00Z',from:'security@mail.instagram.com',to:'other@devsepa.id.vn',subject:'Instagram code',body:'Your code is 222222'},
    {id:'12',created_at:'2026-11-26T07:02:00Z',from:'security@mail.instagram.com',to:'u1@devsepa.id.vn',subject:'Instagram code',body:'Your Instagram code is 333333'},
  ];
  const seen=new Set(['10']);
  const otp=await box.findOtp({since:Date.parse('2026-11-26T07:00:00Z'),seen,platform:'instagram',now:Date.parse('2026-11-26T07:05:00Z')});
  assert.deepEqual(otp,{id:'12',code:'333333'});
});
