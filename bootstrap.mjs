import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
initializeApp({credential:applicationDefault(),projectId:'schoolmonnyusk'});
const db=getFirestore(),auth=getAuth();
if(!process.env.BOOTSTRAP_EMAIL||!process.env.BOOTSTRAP_NAME||process.env.BOOTSTRAP_PASSWORD?.length<12)throw Error('กรุณาตั้งค่าบัญชีแรกและรหัสผ่านอย่างน้อย 12 ตัวอักษร');
const u=await auth.createUser({email:process.env.BOOTSTRAP_EMAIL,password:process.env.BOOTSTRAP_PASSWORD,displayName:process.env.BOOTSTRAP_NAME});
try{await db.runTransaction(async tx=>{const s=await tx.get(db.doc('system/adminLimit'));if(s.exists)throw Error('มีบัญชีหลักแล้ว');tx.set(db.doc('system/adminLimit'),{count:1});tx.set(db.doc('admins/'+u.uid),{name:process.env.BOOTSTRAP_NAME,email:u.email,role:'master',active:true});});console.log('สร้างบัญชีหลักสำเร็จ');}catch(e){await auth.deleteUser(u.uid);throw e;}
