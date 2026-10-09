import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../api/account.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { profileInput, contactUrl, eventInput } from '../lib/validation.js';
const adminPassword='A secure admin password 123';
process.env.UPSTASH_REDIS_REST_URL='https://redis.example.test';process.env.UPSTASH_REDIS_REST_TOKEN='test';process.env.GITHUB_CONTENT_TOKEN='test';process.env.SITE_ORIGIN='https://community.example.test';process.env.ADMIN_PASSWORD_HASH=await hashPassword(adminPassword);
const strings=new Map(),users=new Map();let site=JSON.parse(await readFile('public/data/site.json','utf8')),sha='initial',githubBroken=false;
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 if(String(url).startsWith('https://redis.example.test')){
  const [cmd,...args]=JSON.parse(options.body);let result;
  if(cmd==='HGET')result=users.get(args[1])||null;
  if(cmd==='HSET'||cmd==='HSETNX'){if(cmd==='HSETNX'&&users.has(args[1]))result=0;else{users.set(args[1],args[2]);result=1;}}
  if(cmd==='HVALS')result=[...users.values()];
  if(cmd==='HDEL')result=Number(users.delete(args[1]));
  if(cmd==='SET'){if(args.includes('NX')&&strings.has(args[0]))result=null;else{strings.set(args[0],args[1]);result='OK';}}
  if(cmd==='GET')result=strings.get(args[0])||null;
  if(cmd==='DEL')result=Number(strings.delete(args[0]));
  if(cmd==='EVAL'){const [script,count,k,value]=args;if(script.includes('INCR')){result=Number(strings.get(k)||0)+1;strings.set(k,String(result));}else if(strings.get(k)===value){strings.delete(k);result=1;}else result=0;}
  return Response.json({result});
 }
 if(String(url).includes('api.github.com')){
  if(githubBroken)return Response.json({message:'Unavailable'},{status:503});
  if(options.method==='PUT'){const b=JSON.parse(options.body);if(b.sha!==sha)return Response.json({}, {status:409});site=JSON.parse(Buffer.from(b.content,'base64'));sha=crypto.randomUUID();return Response.json({content:{sha}});}
  return Response.json({sha,content:Buffer.from(JSON.stringify(site)).toString('base64')});
 }
 if(String(url).includes('purge.jsdelivr.net'))return Response.json({status:'finished'});
 throw new Error('Unexpected network URL');
};
const call=async(action,body={},sessionCookie='',extra={})=>{
 const req={method:action==='me'?'GET':'POST',headers:{host:'community.example.test',origin:process.env.SITE_ORIGIN,'content-type':'application/json',cookie:sessionCookie,'x-vercel-forwarded-for':crypto.randomUUID(),...extra},body:{action,...body},query:{}};
 const headers={};let result;const res={setHeader:(k,v)=>headers[k]=v,end:s=>{result={status:res.statusCode,data:JSON.parse(s),headers};}};await handler(req,res);return result;
};
const cookie=r=>r.headers['Set-Cookie']?.split(';')[0];
test('passwords are salted and constant-length; unsafe contacts are rejected',async()=>{
 const a=await hashPassword('A long passphrase 123'),b=await hashPassword('A long passphrase 123');assert.notEqual(a,b);assert.equal(await verifyPassword('A long passphrase 123',a),true);assert.equal(await verifyPassword('wrong',a),false);assert.throws(()=>contactUrl('javascript:alert(1)'));assert.throws(()=>contactUrl('https://user:password@example.org'));assert.equal(contactUrl('tel:+79001234567'),'tel:+79001234567');assert.throws(()=>eventInput({title:'x',type:'x',location:'x',startsAt:'bad'}));
});
test('admin → account → mandatory password → publish → reset → deletion',async()=>{
 let admin=await call('login',{login:'admin',password:adminPassword});assert.equal(admin.status,200);assert.equal(admin.data.user.role,'admin');let ac=cookie(admin);
 if(admin.data.user.mustChange){admin=await call('change-password',{currentPassword:adminPassword,newPassword:'A new admin password 123'},ac);ac=cookie(admin);}
 let create=await call('create-account',{login:'anna',name:'Анна'},ac);assert.equal(create.status,201);assert.equal(create.data.account.profile.published,false);const temp=create.data.tempPassword;
 let logged=await call('login',{login:'anna',password:temp});assert.equal(logged.status,200);let tc=cookie(logged);assert.equal(logged.data.user.mustChange,true);
 assert.equal((await call('save-profile',{},tc)).status,403);
 let change=await call('change-password',{currentPassword:temp,newPassword:'A personal password 123'},tc);assert.equal(change.status,200);const old=tc;tc=cookie(change);assert.equal((await call('me',{},old)).status,401);
 const profile={...create.data.account.profile,name:'Анна <script>',summary:'О встречах',contacts:[{label:'Telegram',url:'https://t.me/test'}],topics:['Тревога'],published:true};
 let saved=await call('save-profile',{profile,revision:0,login:'admin'},tc);assert.equal(saved.status,200);assert.equal(saved.data.user.login,'anna');assert.equal(site.therapists.length,1);assert.equal(site.therapists[0].id,create.data.account.id);assert.equal(JSON.stringify(site).includes('passwordHash'),false);
 assert.equal((await call('create-account',{login:'evil',name:'x'},tc)).status,403);
 assert.equal((await call('save-profile',{profile,revision:0},tc)).status,409);
 assert.equal((await call('save-profile',{profile:{...profile,photo:'uploads/deadbeef.webp'},revision:1},tc)).status,400);
 const cross=await call('reset-password',{login:'anna'},ac,{origin:'https://evil.example'});assert.equal(cross.status,403);
 const html=await call('reset-password',{login:'anna'},ac,{'content-type':'text/plain'});assert.equal(html.status,415);
 const reset=await call('reset-password',{login:'anna'},ac);assert.equal(reset.status,200);assert.equal((await call('me',{},tc)).status,401);assert.equal((await call('login',{login:'anna',password:'A personal password 123'})).status,401);
 const relog=await call('login',{login:'anna',password:reset.data.tempPassword});assert.equal(relog.status,200);assert.equal(relog.data.user.mustChange,true);
 const deleted=await call('delete-account',{login:'anna'},ac);assert.equal(deleted.status,200);assert.equal(site.therapists.length,0);assert.equal((await call('me',{},cookie(relog))).status,401);
 assert.equal((await call('delete-account',{login:'admin'},ac)).status,404);
});
test('draft is retained if publication fails; rate limits and maximum accounts hold',async()=>{
 const existing=JSON.parse(users.get('admin'));const admin=await call('login',{login:'admin',password:existing.mustChange?adminPassword:'A new admin password 123'});assert.equal(admin.status,200);const ac=cookie(admin);
 const create=await call('create-account',{login:'boris',name:'Борис'},ac);const account=create.data.account;
 githubBroken=true;const r=await call('save-profile',{login:'boris',revision:0,profile:{...account.profile,summary:'Пример',contacts:[{label:'Почта',url:'mailto:test@example.org'}],published:true}},ac);assert.equal(r.status,200);assert.ok(r.data.publishError);assert.equal(JSON.parse(users.get('boris')).profile.published,true);githubBroken=false;
 for(let i=0;i<29;i++)users.set('filler'+i,JSON.stringify({login:'filler'+i,id:crypto.randomUUID(),role:'therapist'}));assert.equal((await call('create-account',{login:'one-more',name:'Лишний'},ac)).status,409);
 const ip='same-ip';let response;for(let i=0;i<21;i++)response=await call('login',{login:'missing'+i,password:'wrong' },'',{'x-vercel-forwarded-for':ip});assert.equal(response.status,429);
});
test('published profiles require contacts, IDs and roles cannot come from input',()=>{
 const p={name:'Test',summary:'Summary',formats:['online'],topics:[],published:true,contacts:[]};assert.throws(()=>profileInput(p,'server-id'));
 const safe=profileInput({...p,id:'hacked',role:'admin',contacts:[{label:'Mail',url:'mailto:test@example.org'}]},'server-id');assert.equal(safe.id,'server-id');assert.equal(safe.role,undefined);
});
test.after(()=>{globalThis.fetch=realFetch;});
