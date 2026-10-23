import express from 'express';
import {installStudentRoutes,installPaymentAdminRoutes} from './student-payments.mjs';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {createClient} from '@supabase/supabase-js';
import {amount,text,validate,statuses,paymentId} from './domain.mjs';
initializeApp({credential:applicationDefault(),projectId:'schoolmonnyusk'});
const db=getFirestore(),auth=getAuth(),app=express();
const storage=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY).storage.from(process.env.SUPABASE_BUCKET||'schoolmoney-private');
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.use('/api',rateLimit({windowMs:60000,limit:240}));
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const now=()=>new Date().toISOString();
const log=(tx,uid,action)=>tx.set(db.collection('logs').doc(),{uid,action,createdAt:now()});
const collections=['students','payments','banks','posts','issues','replies','faqs','tasks','admins','logs','requests','settings','files','paymentConfig','studentAccounts','paymentSubmissions'];
app.get('/api/public',wrap(async(req,res)=>{const s=(await db.doc('settings/main').get()).data()||{};let logo='';if(s.logoId){const f=(await db.doc('files/'+s.logoId).get()).data();if(f){const r=await storage.createSignedUrl(f.path,60);logo=r.data?.signedUrl||'';}}res.json({logo});}));
// ติดตั้งเส้นทางนักเรียนก่อนตัวตรวจสิทธิ์ผู้ดูแล
installStudentRoutes(app,{db,auth,storage,log,origin:process.env.APP_ORIGIN||'http://localhost:3000',secret:process.env.STUDENT_SESSION_SECRET});
app.use('/api',wrap(async(req,res,next)=>{
 const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token)return res.status(401).json({error:'กรุณาเข้าสู่ระบบ'});
 let decoded;try{decoded=await auth.verifyIdToken(token,true);}catch{return res.status(401).json({error:'การเข้าสู่ระบบหมดอายุ'});}
 const a=await db.doc('admins/'+decoded.uid).get();if(!a.exists||a.data().active===false)return res.status(403).json({error:'ไม่มีสิทธิ์ผู้ดูแลระบบ'});
 req.user={uid:decoded.uid,...a.data()};next();
}));
const master=(req,res,next)=>req.user.role==='master'?next():res.status(403).json({error:'เฉพาะบัญชีหลักสูงสุด'});
installPaymentAdminRoutes(app,{db,auth,master,wrap,log});
app.get('/api/state',wrap(async(req,res)=>{const data={};await Promise.all(collections.map(async c=>{const snap=await db.collection(c).get();data[c]=snap.docs.map(d=>({id:d.id,...d.data()}));}));res.json({user:req.user,data});}));
app.post('/api/session',wrap(async(req,res)=>{await db.runTransaction(async tx=>log(tx,req.user.uid,req.body.logout?'ออกจากระบบ':'เข้าสู่ระบบ'));res.json({ok:true});}));
app.post('/api/record/:kind',wrap(async(req,res)=>{
 const kind=req.params.kind;if(['settings','tasks'].includes(kind)&&req.user.role!=='master')return res.sendStatus(403);
 const data=validate(kind,req.body.data),id=kind==='settings'?'main':(req.body.id||db.collection(kind).doc().id);if(!/^[\w-]+$/.test(id))throw Error('รหัสไม่ถูกต้อง');
 if(['posts'].includes(kind))await requireFile(data.fileId);
 if(kind==='banks'){if(req.body.confirmed!==true)throw Error('กรุณายืนยันข้อมูลบัญชีรับเงิน');if(data.qrFileId){await requireFile(data.qrFileId);const f=(await db.doc('files/'+data.qrFileId).get()).data();if(f.category!=='bankqr')throw Error('ประเภทไฟล์คิวอาร์ไม่ถูกต้อง');}}
 if(kind==='issues'&&data.fileId)await requireFile(data.fileId);
 if(kind==='settings')for(const k of ['logoId','welcomeId'])if(data[k])await requireFile(data[k]);
 if(kind==='tasks'&&req.body.confirmed!==true)throw Error('กรุณายืนยันข้อมูลการเงิน');
 await db.runTransaction(async tx=>{if(req.body.id){const old=await tx.get(db.doc(kind+'/'+id));if(!old.exists)throw Error('ไม่พบข้อมูล');}tx.set(db.doc(kind+'/'+id),{...data,updatedBy:req.user.uid,updatedAt:now()});log(tx,req.user.uid,'บันทึก '+kind+' '+id);});res.json({id});
}));
app.delete('/api/students/:id',wrap(async(req,res)=>{const ref=db.doc('students/'+req.params.id);await db.runTransaction(async tx=>{const p=await tx.get(db.collection('payments').where('studentId','==',req.params.id).limit(1));if(!p.empty)throw Error('มีประวัติการเงิน ไม่สามารถลบนักเรียนได้');const links=await tx.get(db.collection('studentAccounts').where('studentId','==',req.params.id));links.docs.forEach(d=>tx.delete(d.ref));tx.delete(ref);log(tx,req.user.uid,'ลบนักเรียน '+req.params.id);});res.json({ok:true});}));
app.post('/api/payments',wrap(async(req,res)=>{
 if(req.body.confirmed!==true)throw Error('กรุณายืนยันข้อมูลการเงิน');const rows=req.body.rows;if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('เลือกครั้งละ 1 ถึง 100 รายการ');
 const prepared=rows.map(r=>{if(!/^[\w-]+$/.test(r.studentId)||!/^\d{4}$/.test(r.year)||!/^\d{1,2}$/.test(r.semester)||!/^\d{4}-\d{2}$/.test(r.month)||!statuses.includes(r.status))throw Error('ข้อมูลการเงินไม่ถูกต้อง');return {...r,amount:amount(r.amount),id:paymentId(r.studentId,r.year,r.semester,r.month)};});
 await db.runTransaction(async tx=>{const students=await Promise.all(prepared.map(r=>tx.get(db.doc('students/'+r.studentId))));if(students.some(s=>!s.exists))throw Error('ไม่พบนักเรียน');const refs=prepared.map(r=>db.doc('payments/'+r.id));const olds=await Promise.all(refs.map(r=>tx.get(r)));prepared.forEach((r,i)=>{if((olds[i].data()?.version||0)!==(r.version||0))throw Error('ข้อมูลถูกแก้ไขโดยผู้ดูแลอื่น กรุณารีเฟรช');tx.set(refs[i],{...olds[i].data(),studentId:r.studentId,year:r.year,semester:r.semester,month:r.month,amount:r.amount,status:r.status,version:(r.version||0)+1,updatedBy:req.user.uid,updatedAt:now()});if(olds[i].data()?.lastSubmissionId)tx.update(db.doc('paymentSubmissions/'+olds[i].data().lastSubmissionId),{status:r.status,reviewedBy:req.user.uid,reviewedAt:now()});});log(tx,req.user.uid,'ปรับข้อมูลการเงิน '+rows.length+' รายการ');});res.json({ok:true});
}));
app.post('/api/issues/:id',wrap(async(req,res)=>{const ref=db.doc('issues/'+req.params.id);await db.runTransaction(async tx=>{if(!(await tx.get(ref)).exists)throw Error('ไม่พบเรื่อง');if(req.body.reply)tx.set(db.collection('replies').doc(),{issueId:ref.id,body:text(req.body.reply),uid:req.user.uid,createdAt:now()});else {if(!['ยอมรับ','ปฏิเสธ'].includes(req.body.status))throw Error('สถานะไม่ถูกต้อง');tx.update(ref,{status:req.body.status});}log(tx,req.user.uid,'ตอบรับเรื่อง '+ref.id);});res.json({ok:true});}));
app.post('/api/admins',master,wrap(async(req,res)=>{
 const email=text(req.body.email),name=text(req.body.name),password=text(req.body.password),role=req.body.role;if(!['master','admin'].includes(role)||password.length<12)throw Error('รหัสผ่านอย่างน้อย 12 ตัวอักษร');
 const user=await auth.createUser({email,password,displayName:name});try{await db.runTransaction(async tx=>{const ref=db.doc('system/adminLimit'),s=await tx.get(ref);if(!s.exists)throw Error('กรุณาตั้งค่าบัญชีแรกก่อน');const n=s.data().count;if(n>=10)throw Error('บัญชีผู้ดูแลครบ 10 บัญชีแล้ว');tx.set(db.doc('admins/'+user.uid),{name,email,role,active:true});tx.update(ref,{count:n+1});log(tx,req.user.uid,'เพิ่มผู้ดูแล '+name);});}catch(e){await auth.deleteUser(user.uid);throw e;}res.json({ok:true});
}));
app.patch('/api/admins/:id',master,wrap(async(req,res)=>{const role=req.body.role;if(!['master','admin'].includes(role))throw Error('สิทธิ์ไม่ถูกต้อง');await db.runTransaction(async tx=>{const ref=db.doc('admins/'+req.params.id),old=await tx.get(ref),admins=await tx.get(db.collection('admins'));if(!old.exists)throw Error('ไม่พบบัญชี');if(old.data().role==='master'&&role==='admin'&&admins.docs.filter(d=>d.data().role==='master'&&d.data().active!==false).length<=1)throw Error('ต้องมีบัญชีหลักอย่างน้อยหนึ่งบัญชี');tx.update(ref,{role});log(tx,req.user.uid,'เปลี่ยนสิทธิ์ผู้ดูแล '+old.data().name);});res.json({ok:true});}));
app.post('/api/log-requests',wrap(async(req,res)=>{const id=db.collection('requests').doc().id;await db.runTransaction(async tx=>{const admins=await tx.get(db.collection('admins'));if(!admins.docs.some(d=>d.id!==req.user.uid&&d.data().active!==false))throw Error('ต้องมีผู้ดูแลคนอื่นอนุมัติ');tx.set(db.doc('requests/'+id),{requester:req.user.uid,state:'รออนุมัติ',cutoff:now(),createdAt:now()});log(tx,req.user.uid,'ขออนุมัติล้างประวัติ');});res.json({id});}));
app.post('/api/log-requests/:id',wrap(async(req,res)=>{const ref=db.doc('requests/'+req.params.id);if(!['ยอมรับ','ปฏิเสธ'].includes(req.body.decision))throw Error('คำตอบไม่ถูกต้อง');await db.runTransaction(async tx=>{const s=await tx.get(ref),r=s.data();if(!r||r.state!=='รออนุมัติ'||r.requester===req.user.uid)throw Error('ไม่สามารถอนุมัติคำขอนี้');tx.update(ref,{state:req.body.decision==='ยอมรับ'?'กำลังลบ':'ปฏิเสธ',reviewer:req.user.uid});log(tx,req.user.uid,'พิจารณาคำขอล้างประวัติ '+req.body.decision);});await clearApproved();res.json({ok:true});}));
async function clearApproved(){const requests=await db.collection('requests').where('state','==','กำลังลบ').get();for(const r of requests.docs){let snap;do{snap=await db.collection('logs').where('createdAt','<=',r.data().cutoff).limit(400).get();if(snap.empty)break;const b=db.batch();snap.docs.forEach(d=>b.delete(d.ref));await b.commit();}while(!snap.empty);await db.runTransaction(async tx=>{tx.update(r.ref,{state:'ลบแล้ว'});log(tx,r.data().reviewer,'ล้างประวัติที่ได้รับอนุมัติแล้ว '+r.id);});}}
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1}});
async function requireFile(id){if(!/^[\w-]+$/.test(id)||!(await db.doc('files/'+id).get()).exists)throw Error('ไม่พบไฟล์');}
app.post('/api/files',upload.single('file'),wrap(async(req,res)=>{
 const f=req.file;if(!f)throw Error('กรุณาเลือกไฟล์');const b=f.buffer;let ext=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':b[0]===255&&b[1]===216&&b[2]===255?'jpg':b.subarray(0,5).toString()==='%PDF-'?'pdf':'';if(!ext)throw Error('รองรับรูป PNG, JPG และเอกสาร PDF');
 const category=req.body.category;if(!['slip','pr','logo','welcome','attachment','bankqr'].includes(category))throw Error('ประเภทไฟล์ไม่ถูกต้อง');if(['logo','welcome'].includes(category)&&req.user.role!=='master')return res.sendStatus(403);if(['logo','welcome','pr','slip','bankqr'].includes(category)&&ext==='pdf')throw Error('กรุณาเลือกไฟล์รูปภาพ');
 const metadata={};if(category==='slip'){for(const k of ['studentId','year','semester','month'])metadata[k]=text(req.body[k]);if(!(await db.doc('students/'+metadata.studentId).get()).exists)throw Error('ไม่พบนักเรียน');}
 const id=randomUUID(),path=category+'/'+id+'.'+ext;const {error}=await storage.upload(path,b,{contentType:ext==='pdf'?'application/pdf':ext==='jpg'?'image/jpeg':'image/png',upsert:false});if(error)throw Error('อัปโหลดไม่สำเร็จ กรุณาตรวจสอบพื้นที่เก็บไฟล์');
 try{await db.runTransaction(async tx=>{tx.set(db.doc('files/'+id),{path,category,name:f.originalname,type:ext,...metadata,createdAt:now(),uid:req.user.uid});log(tx,req.user.uid,'อัปโหลดไฟล์ '+id);});}catch(e){await storage.remove([path]);throw e;}res.json({id});
}));
app.get('/api/files/:id',wrap(async(req,res)=>{await requireFile(req.params.id);const f=(await db.doc('files/'+req.params.id).get()).data();const {data,error}=await storage.createSignedUrl(f.path,120);if(error)throw Error('ไม่สามารถเปิดไฟล์');res.json({url:data.signedUrl,type:f.type});}));
// ประมวลผลงานล่วงหน้าแบบทำซ้ำได้โดยไม่สร้างยอดซ้ำ
async function scheduled(){const tasks=await db.collection('tasks').where('state','==','รอดำเนินการ').get();for(const t of tasks.docs){if(Date.parse(t.data().runAt)>Date.now())continue;const students=await db.collection('students').get();for(const s of students.docs){const d=t.data(),ref=db.doc('payments/'+paymentId(s.id,d.year,d.semester,d.month));await db.runTransaction(async tx=>{if(!(await tx.get(ref)).exists)tx.set(ref,{studentId:s.id,year:d.year,semester:d.semester,month:d.month,amount:d.amount,status:'ค้างชำระ',version:1,updatedAt:now(),updatedBy:'ระบบ'});});}await db.runTransaction(async tx=>{tx.update(t.ref,{state:'ดำเนินการแล้ว'});log(tx,'ระบบ','สร้างยอดตามกำหนด '+t.id);});}await clearApproved();}
let working=false;setInterval(async()=>{if(working)return;working=true;try{await scheduled();}catch{console.error('ประมวลผลงานล่วงหน้าไม่สำเร็จ');}finally{working=false;}},30000);
app.use(express.static('public'));
app.use((err,req,res,next)=>{console.error('คำขอไม่สำเร็จ',err.code||err.name);res.status(400).json({error:err.code?'ทำรายการไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อและข้อมูล':err.message||'ไม่สามารถทำรายการได้'});});
app.listen(process.env.PORT||3000,()=>console.log('เริ่มระบบเรียบร้อย'));
