import { randomUUID, randomBytes } from 'node:crypto';
import { HttpError, requireValue, loginName, password, profileInput, eventInput, settingsInput, text } from '../lib/validation.js';
import { hashPassword, verifyPassword, digest, sessionToken, cookie, readCookie } from '../lib/auth.js';
import { redis, key, rateLimit, withLock, userRead, userWrite, listUsers, readContent, writeContent, writePhoto } from '../lib/storage.js';
const configured=()=>['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','GITHUB_CONTENT_TOKEN','ADMIN_PASSWORD_HASH'].every(k=>!!process.env[k]);
const adminLogin=()=>process.env.ADMIN_LOGIN||'admin';
const publicUser=u=>({login:u.login,id:u.id,role:u.role,mustChange:u.mustChange,profile:u.profile||null,revision:u.revision||0});
const secure=()=>process.env.NODE_ENV!=='development';
async function session(req){const token=readCookie(req.headers);requireValue(token,'Войдите в кабинет.',401);const raw=await redis('GET',key(`session:${digest(token)}`));requireValue(raw,'Сессия завершилась. Войдите снова.',401);const s=JSON.parse(raw),u=await userRead(s.login);requireValue(u&&u.version===s.version,'Сессия завершилась. Войдите снова.',401);return {user:u,token};}
async function issueSession(res,u){const token=sessionToken();await redis('SET',key(`session:${digest(token)}`),JSON.stringify({login:u.login,version:u.version}),'EX',604800);res.setHeader('Set-Cookie',cookie(token,secure()));}
function sameOrigin(req){
 const origin=req.headers.origin;let expected=process.env.SITE_ORIGIN;
 if(!expected)expected=`${secure()?'https':'http'}://${req.headers.host}`;
 requireValue(origin===expected,'Запрос с другого сайта отклонён.',403);
 requireValue(String(req.headers['content-type']||'').split(';')[0]==='application/json','Ожидается JSON.',415);
}
async function publishProfile(u){const {site,sha}=await readContent();site.therapists=site.therapists.filter(p=>p.id!==u.id);if(u.profile?.published)site.therapists.push(u.profile);return writeContent(site,sha);}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
 const send=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
 try{
  requireValue(req.method==='GET'||req.method==='POST','Метод не поддерживается.',405);
  if(req.method==='GET'&&req.query?.action==='status')return send(200,{configured:configured()});
  requireValue(configured(),'Кабинеты скоро откроются. Администратор завершает подключение.',503);
  if(req.method==='GET'){const {user}=await session(req);return send(200,{user:publicUser(user)});}
  sameOrigin(req);
  let body=req.body;if(typeof body==='string'){requireValue(Buffer.byteLength(body)<=300000,'Слишком большой запрос.',413);body=JSON.parse(body);}requireValue(body&&typeof body==='object'&&!Array.isArray(body),'Проверьте запрос.');
  requireValue(Buffer.byteLength(JSON.stringify(body))<=300000,'Слишком большой запрос.',413);
  const ip=digest(String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim());
  const action=body.action;
  if(action==='login'){
   await rateLimit('login-ip',ip,20,600);
   const login=loginName(body.login);await rateLimit('login-user',digest(login),15,600);
   requireValue(typeof body.password==='string'&&body.password.length<=128,'Неверный логин или пароль.',401);
   let u=await userRead(login);
   if(!u&&login===adminLogin()&&await verifyPassword(body.password,process.env.ADMIN_PASSWORD_HASH)){
    const initial={id:'admin',login,role:'admin',passwordHash:process.env.ADMIN_PASSWORD_HASH,version:1,mustChange:true,revision:0};
    await redis('HSETNX',key('users'),login,JSON.stringify(initial));u=await userRead(login);
   }
   // Use a real hash even for unknown users to avoid a cheap username timing oracle.
   const ok=await verifyPassword(body.password,u?.passwordHash||process.env.ADMIN_PASSWORD_HASH);
   requireValue(u&&ok,'Неверный логин или пароль.',401);await issueSession(res,u);return send(200,{user:publicUser(u)});
  }
  const {user,token}=await session(req);
  const locked=work=>withLock(async()=>{const live=await userRead(user.login);requireValue(live&&live.version===user.version,'Сессия завершилась. Войдите снова.',401);return work();});
  await rateLimit('account',digest(user.login),120,600);
  if(action==='logout'){await redis('DEL',key(`session:${digest(token)}`));res.setHeader('Set-Cookie',cookie('',secure()));return send(200,{ok:true});}
  if(action==='change-password'){
   requireValue(await verifyPassword(body.currentPassword,user.passwordHash),'Текущий пароль неверен.',400);const newHash=await hashPassword(password(body.newPassword));
   const updated=await locked(async()=>{const u=await userRead(user.login);requireValue(u&&u.version===user.version,'Данные изменились. Войдите снова.',409);u.passwordHash=newHash;u.version++;u.mustChange=false;await userWrite(u);return u;});
   await redis('DEL',key(`session:${digest(token)}`));await issueSession(res,updated);return send(200,{user:publicUser(updated)});
  }
  requireValue(!user.mustChange,'Сначала замените временный пароль.',403);
  if(action==='save-profile'){
   requireValue(user.role==='therapist'||user.role==='admin','Доступ запрещён.',403);
   const target=user.role==='admin'?loginName(body.login):user.login;
   const result=await locked(async()=>{
    const u=await userRead(target);requireValue(u?.role==='therapist','Профиль не найден.',404);requireValue(u.revision===body.revision,'Профиль изменился. Обновите страницу, чтобы не потерять изменения.',409);
    const p=profileInput(body.profile,u.id);
    // A therapist may only use their existing photo or upload their own compressed file.
    requireValue(p.photo===(u.profile?.photo||''),'Для смены фотографии используйте загрузку файла.');
    if(body.photo){requireValue(typeof body.photo==='string'&&body.photo.length<=245760&&/^[A-Za-z0-9+/]+={0,2}$/.test(body.photo),'Некорректный файл фотографии.');const buffer=Buffer.from(body.photo,'base64');requireValue(buffer.length>=20&&buffer.length<=180000&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP','Загрузите фотографию WebP не больше 180 КБ.');p.photo=await writePhoto(body.photo);}
    if(body.removePhoto===true)p.photo='';
    u.profile=p;u.revision++;await userWrite(u);
    try{return {user:publicUser(u),publication:await publishProfile(u)};}catch(e){return {user:publicUser(u),publishError:e.message};}
   });return send(200,result);
  }
  requireValue(user.role==='admin','Доступ только для администратора.',403);
  if(action==='list-accounts')return send(200,{accounts:(await listUsers()).filter(u=>u.role==='therapist').map(publicUser)});
  if(action==='admin-content'){const {site}=await readContent();return send(200,{site});}
  if(action==='create-account'){
   const login=loginName(body.login);requireValue(login!==adminLogin(),'Этот логин занят.');const name=text(body.name,100,true);const tempPassword=randomBytes(15).toString('base64url');const passwordHash=await hashPassword(tempPassword);
   const account=await locked(async()=>{requireValue(!(await userRead(login)),'Этот логин уже занят.',409);const users=await listUsers();requireValue(users.filter(u=>u.role==='therapist').length<30,'Достигнут лимит 30 терапевтов.',409);const u={id:randomUUID(),login,role:'therapist',passwordHash,version:1,mustChange:true,revision:0,profile:{id:'',name,summary:'',about:'',education:'',topics:[],formats:['inperson','online'],price:null,duration:50,photo:'',contacts:[],published:false}};u.profile.id=u.id;await userWrite(u);return u;});return send(201,{account:publicUser(account),tempPassword});
  }
  if(action==='reset-password'){
   const login=loginName(body.login);const tempPassword=randomBytes(15).toString('base64url'),passwordHash=await hashPassword(tempPassword);
   await locked(async()=>{const u=await userRead(login);requireValue(u?.role==='therapist','Кабинет не найден.',404);u.passwordHash=passwordHash;u.version++;u.mustChange=true;await userWrite(u);});return send(200,{login,tempPassword});
  }
  if(action==='delete-account'){
   const login=loginName(body.login);await locked(async()=>{const u=await userRead(login);requireValue(u?.role==='therapist','Кабинет не найден.',404);const {site,sha}=await readContent();site.therapists=site.therapists.filter(p=>p.id!==u.id);await writeContent(site,sha);await redis('HDEL',key('users'),login);});return send(200,{ok:true});
  }
  if(action==='save-event'||action==='delete-event'||action==='save-settings'){
   const result=await locked(async()=>{const {site,sha}=await readContent();requireValue(body.updatedAt===site.updatedAt,'Календарь или настройки изменились. Обновите раздел и повторите изменение.',409);
    if(action==='save-settings')site.settings=settingsInput(body.settings);
    else if(action==='delete-event'){requireValue(site.events.some(e=>e.id===body.id),'Событие не найдено.',404);site.events=site.events.filter(e=>e.id!==body.id);}
    else{const e=eventInput(body.event);if(body.id)requireValue(site.events.some(e=>e.id===body.id),'Событие не найдено.',404);requireValue(body.id||site.events.length<200,'Достигнут лимит 200 событий.');e.id=body.id||randomUUID();site.events=site.events.filter(x=>x.id!==e.id);site.events.push(e);}
    const publication=await writeContent(site,sha);return {site,publication};});return send(200,result);
  }
  throw new HttpError(400,'Неизвестное действие.');
 }catch(e){const status=e instanceof HttpError?e.status:e instanceof SyntaxError?400:500;send(status,{error:e instanceof HttpError?e.message:status===400?'Некорректный запрос.':'Не удалось выполнить действие. Попробуйте позже.'});}
}
