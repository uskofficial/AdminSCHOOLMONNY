import {readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let tracked=null;
try{
    const top=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,stdio:['ignore','pipe','ignore']}).toString().trim();
    if(path.resolve(top)===root)tracked=execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
}catch{}
async function scan(dir){
    const result=[];
    for(const entry of await readdir(dir,{withFileTypes:true})){
        if(['node_modules','.git'].includes(entry.name))continue;
        const full=path.join(dir,entry.name);
        if(entry.isDirectory())result.push(...await scan(full));
        else if(entry.isFile()&&!entry.name.startsWith('.env'))result.push(path.relative(root,full));
    }
    return result;
}
const files=tracked||await scan(root);
let failed=false;
for(const file of files){
    if(/(^|\/)\.env($|\.)/.test(file)&&!file.endsWith('.env.example')){console.error('พบไฟล์ค่าลับในรายการ Git:',file);failed=true;continue;}
    const text=await readFile(path.join(root,file),'utf8');
    const hasKey=/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(text);
    const tokens=text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[];
    const serviceToken=tokens.some(token=>{try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).role==='service_role';}catch{return false;}});
    if(hasKey||serviceToken||/sb_secret_[A-Za-z0-9_-]{20,}/.test(text)){console.error('พบคีย์ลับในไฟล์:',file);failed=true;}
}
if(failed)process.exitCode=1;else console.log('ตรวจซอร์สแล้ว ไม่พบคีย์ลับตามรูปแบบที่ตรวจ');
