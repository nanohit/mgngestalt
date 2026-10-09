export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export function requireValue(condition,message,status=400){if(!condition)throw new HttpError(status,message);}
export function text(value,max=300,required=false){requireValue(typeof value==='string'||(!required&&value==null),'Неверный формат текста.');const s=String(value??'').trim();requireValue(s.length<=max,`Текст должен быть не длиннее ${max} символов.`);requireValue(!required||s.length>0,'Заполните обязательные поля.');return s;}
export function loginName(value){const s=text(value,40,true).toLowerCase();requireValue(/^[a-z0-9][a-z0-9._-]{2,39}$/.test(s),'Логин: 3–40 латинских букв, цифр, точек, дефисов или подчёркиваний.');return s;}
export function password(value){requireValue(typeof value==='string'&&value.length>=12&&value.length<=128,'Пароль должен содержать от 12 до 128 символов.');return value;}
export function contactUrl(value){const s=text(value,500);if(!s)return '';try{const u=new URL(s);requireValue(['https:','http:','tel:','mailto:'].includes(u.protocol)&&!u.username&&!u.password,'Используйте ссылку https://, телефон tel: или почту mailto:.');return u.href;}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Проверьте ссылку для связи.');}}
const TOPICS=['Отношения','Тревога','Самооценка','Кризисы','Утрата','Семья','Выгорание','Самопознание'];
export function profileInput(input,id){
 requireValue(input&&typeof input==='object','Заполните профиль.');
 const formats=Array.isArray(input.formats)?[...new Set(input.formats)]:[];
 requireValue(formats.length>0&&formats.every(f=>['inperson','online'].includes(f)),'Выберите формат консультаций.');
 const topics=Array.isArray(input.topics)?[...new Set(input.topics)]:[];
 requireValue(topics.length<=8&&topics.every(t=>TOPICS.includes(t)),'Проверьте темы работы.');
 const contacts=Array.isArray(input.contacts)?input.contacts:[];requireValue(contacts.length<=4,'Можно указать до четырёх контактов.');
 const cleanContacts=contacts.filter(c=>c&&c.url).map(c=>({label:text(c.label,60,true),url:contactUrl(c.url)}));
 const price=input.price===''||input.price==null?null:Number(input.price),duration=Number(input.duration||50);
 requireValue(price===null||(Number.isInteger(price)&&price>=0&&price<=100000),'Проверьте стоимость.');requireValue(Number.isInteger(duration)&&duration>=15&&duration<=240,'Продолжительность: от 15 до 240 минут.');
 const photo=text(input.photo,100);requireValue(!photo||/^uploads\/[a-f0-9-]+\.webp$/.test(photo),'Проверьте фотографию.');
 const published=input.published===true;requireValue(!published||cleanContacts.length>0,'Для публикации укажите хотя бы один контакт.');
 return {id,name:text(input.name,100,true),summary:text(input.summary,240,true),about:text(input.about,5000),education:text(input.education,3000),formats,topics,price,duration,contacts:cleanContacts,photo,published};
}
export function eventInput(input){
 requireValue(input&&typeof input==='object','Заполните событие.');const startsAt=text(input.startsAt,40,true);
 requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(startsAt)&&Number.isFinite(Date.parse(startsAt)),'Проверьте дату и время события.');
 return {title:text(input.title,120,true),type:text(input.type,60,true),startsAt:new Date(startsAt).toISOString(),location:text(input.location,200,true),description:text(input.description,5000),price:text(input.price,80),contactLabel:text(input.contactLabel,60),contactUrl:contactUrl(input.contactUrl)};
}
export function settingsInput(input){return {about:text(input.about,3000,true),contactLabel:text(input.contactLabel,60),contactUrl:contactUrl(input.contactUrl)};}
