import {initializeApp,applicationDefault,cert} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {createClient} from '@supabase/supabase-js';

// ตรวจเฉพาะรูปแบบการตั้งค่า โดยไม่พิมพ์ค่าลับลงบันทึก
export function validateCloudConfig(env) {
    const projectId=env.FIREBASE_PROJECT_ID||'schoolmonnyusk';
    const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','STUDENT_SESSION_SECRET'];
    for(const key of required)if(!env[key]?.trim())throw Error('ยังไม่ได้ตั้งค่า '+key);
    if(env.STUDENT_SESSION_SECRET.length<32)throw Error('STUDENT_SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
    const url=new URL(env.SUPABASE_URL);
    if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash)throw Error('SUPABASE_URL ต้องเป็นต้นทาง HTTPS โดยไม่ต่อ /rest/v1 หรือคีย์');
    const origin=env.APP_ORIGIN||env.RENDER_EXTERNAL_URL||'http://localhost:3000';
    const parsed=new URL(origin);
    if(parsed.origin!==origin)throw Error('APP_ORIGIN ต้องไม่มีเส้นทางหรือเครื่องหมาย / ต่อท้าย');
    if(env.NODE_ENV==='production'&&parsed.protocol!=='https:')throw Error('การใช้งานจริงต้องตั้ง APP_ORIGIN เป็น HTTPS');
    if(!env.GOOGLE_APPLICATION_CREDENTIALS&&!env.FIREBASE_SERVICE_ACCOUNT_JSON)throw Error('ต้องตั้งค่า Firebase service account ฝั่งเซิร์ฟเวอร์');
    return {projectId,origin,bucket:env.SUPABASE_BUCKET||'schoolmoney-private'};
}
export function initializeFirebase() {
    const projectId=process.env.FIREBASE_PROJECT_ID||'schoolmonnyusk';
    let credential=applicationDefault();
    if(process.env.FIREBASE_SERVICE_ACCOUNT_JSON){
        let account;
        try{account=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);}catch{throw Error('รูปแบบ FIREBASE_SERVICE_ACCOUNT_JSON ไม่ถูกต้อง');}
        if(account.project_id!==projectId)throw Error('โครงการใน service account ไม่ตรงกับ FIREBASE_PROJECT_ID');
        credential=cert(account);
    }
    return initializeApp({credential,projectId});
}
export function createStorageClient(){
    return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
// อ่านข้อมูลบริการจริงอย่างละเล็กน้อย ไม่ส่งข้อมูลนักเรียนหรือค่าลับออกทางผลตรวจ
export async function verifyConnections(firebaseApp,client,bucket){
    const results=[];
    for(const [name,check] of [
        ['Firebase Authentication',()=>getAuth(firebaseApp).listUsers(1)],
        ['Cloud Firestore',()=>getFirestore(firebaseApp).doc('system/adminLimit').get()],
        ['Supabase Storage',async()=>{const {data,error}=await client.storage.getBucket(bucket);if(error)throw Error('อ่าน bucket ไม่สำเร็จ');if(data.public)throw Error('bucket ต้องเป็นแบบส่วนตัว');const r=await client.storage.from(bucket).list('',{limit:1});if(r.error)throw Error('อ่านรายการไฟล์ไม่สำเร็จ');}]
    ]){
        try{await check();results.push({service:name,ok:true});}
        catch{results.push({service:name,ok:false});}
    }
    return results;
}
