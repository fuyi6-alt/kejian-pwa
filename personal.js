(function(global){'use strict';
const KEY='kejian.personal.v1',DB='kejian.personal.files.v1',MAX_FILE=8*1024*1024,MAX_BACKUP=80*1024*1024;
const empty=()=>({version:1,timetableImported:false,tasks:[],collections:[],focus:[]});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9._:-]{1,100}$/.test(x);
const string=(x,n=10000)=>typeof x==='string'&&x.length<=n;
const unique=items=>new Set(items).size===items.length;
const validTimetable=t=>object(t)&&string(t.schemaVersion,12)&&Array.isArray(t.courseOccurrences)&&t.courseOccurrences.length>0&&t.courseOccurrences.length<=5000&&t.courseOccurrences.every(c=>object(c)&&string(c.date,10)&&/^\d{4}-\d{2}-\d{2}$/.test(c.date)&&string(c.courseName,200)&&Array.isArray(c.periods)&&c.periods.length>0&&c.periods.length<=20&&c.periods.every(n=>Number.isSafeInteger(n)&&n>=1&&n<=30)&&(!c.startTime||string(c.startTime,10))&&(!c.endTime||string(c.endTime,10)));
function validState(s){
  if(!object(s)||s.version!==1||typeof s.timetableImported!=='boolean'||!Array.isArray(s.tasks)||!Array.isArray(s.collections)||!Array.isArray(s.focus))return false;
  if(s.timetable!==undefined&&!validTimetable(s.timetable))return false;
  const ids=new Set(),collections=new Set(),taskIds=new Set();
  for(const c of s.collections){
    if(!object(c)||!validId(c.id)||ids.has(c.id)||!string(c.title,160)||!c.title.trim()||!string(c.body)||!string(c.url||'',3000)||!!c.url&&!/^https?:\/\//i.test(c.url)||!Array.isArray(c.files||[]))return false;
    ids.add(c.id);collections.add(c.id);
    if((c.files||[]).some(f=>!object(f)||!validId(f.id)||!string(f.name,180)||!string(f.mime,120)||!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_FILE))return false;
    if(!unique((c.files||[]).map(f=>f.id)))return false;
  }
  const fileIds=s.collections.flatMap(c=>(c.files||[]).map(f=>f.id));if(!unique(fileIds))return false;
  for(const t of s.tasks){
    if(!object(t)||!validId(t.id)||ids.has(t.id)||!string(t.title,160)||!t.title.trim()||!string(t.body)||!['study','general'].includes(t.kind)||!string(t.deadline||'',30)||typeof t.done!=='boolean'||!string(t.schedule||'',100)||!Array.isArray(t.collectionIds||[]))return false;
    if((t.collectionIds||[]).some(id=>!collections.has(id))||!unique(t.collectionIds||[]))return false;ids.add(t.id);taskIds.add(t.id);
  }
  for(const f of s.focus){if(!object(f)||!validId(f.id)||ids.has(f.id)||!taskIds.has(f.taskId)||!Number.isSafeInteger(f.duration)||f.duration<60||f.duration>10800||typeof f.elapsed!=='number'||!Number.isFinite(f.elapsed)||f.elapsed<0||!['running','paused','finished'].includes(f.state)||f.state==='running'&&(!Number.isFinite(f.startedAt)||f.startedAt<=0)||f.state!=='running'&&f.startedAt!==null)return false;ids.add(f.id)}
  return s.focus.filter(f=>f.state==='running'||f.state==='paused').length<=1;
}
function read(){const raw=localStorage.getItem(KEY);if(!raw)return empty();const state=JSON.parse(raw);if(!validState(state))throw Error('个人记录格式损坏或版本不兼容，原数据已保留。');return state}
function save(state){if(!validState(state))throw Error('个人记录校验失败，未保存。');localStorage.setItem(KEY,JSON.stringify(state));}
let dbPromise;
function db(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{if(!global.indexedDB){reject(Error('此浏览器不支持本地文件存储。'));return}const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('files'))req.result.createObjectStore('files')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('无法打开本地文件库。'))});return dbPromise}
async function fileGet(id){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('files','readonly'),req=tx.objectStore('files').get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)})}
async function filePut(id,blob){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('files','readwrite');tx.objectStore('files').put(blob,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function fileDelete(id){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('files','readwrite');tx.objectStore('files').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function addCollection(state,collection,files){const next=structuredClone(state),stored=[];try{for(const file of files){if(file.size>MAX_FILE||file.size===0)throw Error('每个文件须大于 0 且不超过 8 MB。');const id=crypto.randomUUID();await filePut(id,file);stored.push(id);collection.files.push({id,name:file.name.slice(0,180),mime:(file.type||'application/octet-stream').slice(0,120),size:file.size})}next.collections.push(collection);save(next);return next}catch(e){for(const id of stored)await fileDelete(id).catch(()=>{});throw e}}
function bytesToBase64(bytes){let out='';for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(out)}
function base64ToBytes(data){if(!/^[A-Za-z0-9+/]*={0,2}$/.test(data)||data.length%4)throw Error('附件编码无效。');const raw=atob(data),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes}
async function sha(bytes){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')}
async function exportBackup(state){if(!validState(state))throw Error('个人记录校验失败，无法导出。');const files=[];for(const c of state.collections)for(const meta of c.files||[]){const blob=await fileGet(meta.id);if(!blob||blob.size!==meta.size)throw Error('附件缺失或大小不符：'+meta.name);const bytes=new Uint8Array(await blob.arrayBuffer());files.push({id:meta.id,data:bytesToBase64(bytes),sha256:await sha(bytes)})}const result={format:'kejian-personal-backup',version:1,exportedAt:new Date().toISOString(),data:structuredClone(state),files};if(JSON.stringify(result).length>MAX_BACKUP)throw Error('个人备份超过 80 MB 的单文件上限，请分批整理附件后再导出。');return result}
async function inspectBackup(text,current){if(text.length>MAX_BACKUP)throw Error('备份超过 80 MB，未导入。');let b;try{b=JSON.parse(text)}catch(e){throw Error('备份不是有效 JSON。')}if(!object(b)||b.format!=='kejian-personal-backup'||b.version!==1||!validState(b.data)||!Array.isArray(b.files))throw Error('备份格式或个人记录结构无效。');const metas=b.data.collections.flatMap(c=>c.files||[]),wanted=new Map(metas.map(f=>[f.id,f]));if(b.files.length!==wanted.size||!unique(b.files.map(f=>f.id)))throw Error('备份附件清单不完整或重复。');const blobs=new Map();for(const f of b.files){if(!object(f)||!wanted.has(f.id)||!string(f.data,MAX_FILE*2)||!string(f.sha256,64)||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('备份附件结构无效。');const bytes=base64ToBytes(f.data);if(bytes.length!==wanted.get(f.id).size||await sha(bytes)!==f.sha256)throw Error('备份附件校验失败。');blobs.set(f.id,new Blob([bytes],{type:wanted.get(f.id).mime}))}
  const existing={tasks:new Set(current.tasks.map(x=>x.id)),collections:new Set(current.collections.map(x=>x.id)),focus:new Set(current.focus.map(x=>x.id))};
  const added={tasks:b.data.tasks.filter(x=>!existing.tasks.has(x.id)),collections:b.data.collections.filter(x=>!existing.collections.has(x.id)),focus:b.data.focus.filter(x=>!existing.focus.has(x.id))};
  const skipped={tasks:b.data.tasks.length-added.tasks.length,collections:b.data.collections.length-added.collections.length,focus:b.data.focus.length-added.focus.length};
  const next=structuredClone(current);next.collections.push(...added.collections);next.tasks.push(...added.tasks);next.focus.push(...added.focus);if(!next.timetableImported&&b.data.timetableImported)next.timetableImported=true;
  // A task whose collection ID collides with an existing local collection keeps the local collection.
  if(!validState(next))throw Error('合并后记录不一致，未导入。');
  return {next,added,skipped,blobs,sourceImported:b.data.timetableImported,existingImported:current.timetableImported};
}
async function commitImport(preview){const written=[];try{for(const collection of preview.added.collections)for(const meta of collection.files||[]){const existing=await fileGet(meta.id),incoming=preview.blobs.get(meta.id);if(existing){const a=new Uint8Array(await existing.arrayBuffer()),b=new Uint8Array(await incoming.arrayBuffer());if(a.length!==b.length||await sha(a)!==await sha(b))throw Error('附件 ID 已存在且内容不同，未覆盖本机文件。');continue}await filePut(meta.id,incoming);written.push(meta.id)}save(preview.next);return preview.next}catch(e){for(const id of written)await fileDelete(id).catch(()=>{});throw e}}
global.Personal={KEY,read,save,validState,validTimetable,fileGet,addCollection,exportBackup,inspectBackup,commitImport};
})(window);
