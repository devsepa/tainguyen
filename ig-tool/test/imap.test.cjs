const {test}=require('node:test');
const assert=require('node:assert/strict');
const tls=require('node:tls');
const {execFileSync}=require('node:child_process');
const {ImapMailbox}=require('../imap.cjs');

// Generate self-signed cert in-memory via node:crypto? Node 22 doesn't have built-in X509 generator,
// so test ImapMailbox against a real TLS server only if openssl is available, or test parseHeaders/decodeBody + mock ImapClient.
const {parseHeaders,decodeBody}=require('../imap.cjs');

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
