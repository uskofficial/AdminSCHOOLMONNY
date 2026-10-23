import express from 'express';
import multer from 'multer';
import {createHash, createHmac, timingSafeEqual, randomUUID} from 'node:crypto';

// แยกสิทธิ์นักเรียนออกจากเส้นทางผู้ดูแลระบบโดยสิ้นเชิง
export class PaymentError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new PaymentError(status, message); };
export function safeId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(value)) fail(400, 'รหัสรายการไม่ถูกต้อง');
    return value;
}
export function imageType(buffer) {
    if (!buffer || buffer.length < 12) fail(400, 'ไฟล์รูปภาพไม่ถูกต้อง');
    if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
    if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
    fail(400, 'รองรับเฉพาะภาพ PNG และ JPG');
}
export function assertPayable(payment, studentId, version) {
    if (!payment || payment.studentId !== studentId) fail(404, 'ไม่พบรายการชำระเงิน');
    if (version !== undefined && payment.version !== version) fail(409, 'ยอดเงินเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่');
    if (payment.status !== 'ค้างชำระ') fail(409, 'รายการนี้ไม่อยู่ในสถานะที่ส่งชำระได้ กรุณาตรวจสอบสถานะ');
    if (!Number.isFinite(payment.amount) || payment.amount <= 0 || Math.abs(payment.amount * 100 - Math.round(payment.amount * 100)) > 0.00001) fail(409, 'ยอดเงินไม่ถูกต้อง กรุณาติดต่อผู้ดูแล');
}
export function checkQuote(quote, payment, config, bank, uid, currentTime) {
    if (!quote || quote.uid !== uid || quote.version !== payment.version || quote.amount !== payment.amount) fail(409, 'ข้อมูลชำระเงินเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่');
    if (quote.expiresAt !== null && quote.expiresAt <= currentTime) fail(409, 'รายการหมดอายุ หากโอนแล้วกรุณาติดต่อผู้ดูแล');
    if (!config || !bank || quote.bankId !== config.bankId || quote.configVersion !== config.version || quote.bankUpdatedAt !== bank.updatedAt) fail(409, 'ข้อมูลบัญชีรับเงินเปลี่ยนแปลง กรุณาตรวจสอบบัญชีอีกครั้ง');
}
const hash = value => createHash('sha256').update(value).digest('hex');
const time = () => new Date().toISOString();
const cookieName = 'usk_student_session';
function cookieValue(req) {
    const pair = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));
    if (!pair) return '';
    try { return decodeURIComponent(pair.slice(cookieName.length+1)); } catch { return ''; }
}

export function installStudentRoutes(app, {db, auth, storage, log, origin, secret}) {
    const configuredOrigin = new URL(origin);
    if (configuredOrigin.origin !== origin || (configuredOrigin.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(configuredOrigin.hostname))) throw Error('APP_ORIGIN ต้องเป็นต้นทาง HTTPS หรือ localhost เท่านั้น');
    if (typeof secret !== 'string' || secret.length < 32) throw Error('กรุณากำหนด STUDENT_SESSION_SECRET อย่างน้อย 32 ตัวอักษร');
    const cookieOptions = {httpOnly:true, secure:configuredOrigin.protocol === 'https:', sameSite:'strict', path:'/api/student', maxAge:30*60*1000};
    const router = express.Router();
    const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
    const csrf = cookie => createHmac('sha256',secret).update(cookie).digest('hex');
    const checkOrigin = (req,res,next) => req.get('Origin') === origin ? next() : next(new PaymentError(403,'ต้นทางคำขอไม่ถูกต้อง'));
    const requireCsrf = (req,res,next) => {
        const supplied = Buffer.from(req.get('X-CSRF-Token') || '');
        const expected = Buffer.from(csrf(req.studentCookie));
        if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) return next(new PaymentError(403,'ข้อมูลยืนยันความปลอดภัยไม่ถูกต้อง'));
        next();
    };
    const quoteRef = (uid,id) => db.doc('paymentQuotes/'+hash(uid+'|'+id));
    async function membership(uid, tx) {
        const get = ref => tx ? tx.get(ref) : ref.get();
        const member = (await get(db.doc('studentAccounts/'+safeId(uid)))).data();
        if (!member || member.active !== true) fail(403,'บัญชียังไม่ได้ผูกกับข้อมูลนักเรียน');
        const student = (await get(db.doc('students/'+safeId(member.studentId)))).data();
        if (!student) fail(403,'ไม่พบข้อมูลนักเรียนที่ผูกไว้');
        return member;
    }

    // แลกโทเคนจากการเข้าสู่ระบบนักเรียนเป็นคุกกี้ที่สคริปต์อ่านไม่ได้
    router.post('/session', checkOrigin, wrap(async(req,res)=>{
        const token = req.get('Authorization')?.replace(/^Bearer /,'');
        let decoded;
        try { decoded = await auth.verifyIdToken(token,true); } catch { fail(401,'กรุณาเข้าสู่ระบบนักเรียนใหม่'); }
        if (!decoded.auth_time || Date.now()/1000-decoded.auth_time > 300) fail(401,'กรุณาเข้าสู่ระบบใหม่ก่อนสร้างเซสชัน');
        await membership(decoded.uid);
        const session = await auth.createSessionCookie(token,{expiresIn:cookieOptions.maxAge});
        res.cookie(cookieName,session,cookieOptions);
        res.json({success:true,csrfToken:csrf(session)});
    }));
    router.use(wrap(async(req,res,next)=>{
        const cookie = cookieValue(req);
        let decoded;
        try { decoded = await auth.verifySessionCookie(cookie,true); } catch { fail(401,'กรุณาเข้าสู่ระบบนักเรียนก่อนทำรายการ'); }
        req.student = {uid:decoded.uid,...await membership(decoded.uid)};
        req.studentCookie = cookie;
        next();
    }));
    router.get('/session', (req,res)=>res.json({success:true,csrfToken:csrf(req.studentCookie)}));
    router.delete('/session', checkOrigin, requireCsrf, (req,res)=>{
        res.clearCookie(cookieName,{...cookieOptions,maxAge:undefined});
        res.json({success:true});
    });
    router.get('/payments', wrap(async(req,res)=>{
        const snap = await db.collection('payments').where('studentId','==',req.student.studentId).get();
        res.json({payments:snap.docs.map(d=>{
            const p=d.data();return {paymentId:d.id,year:p.year,semester:p.semester,month:p.month,amount:p.amount,status:p.status,version:p.version};
        })});
    }));
    router.get('/payment', wrap(async(req,res)=>{
        let id = req.query.paymentId;
        if (!id) {
            const snap = await db.collection('payments').where('studentId','==',req.student.studentId).get();
            const payable = snap.docs.filter(d=>d.data().status === 'ค้างชำระ');
            if (!payable.length) fail(404,'ไม่มีรายการค้างชำระ');
            if (payable.length > 1) fail(409,'กรุณาเลือกรายการจากรายการค่าใช้จ่ายก่อน');
            id = payable[0].id;
        }
        safeId(id);
        const result = await db.runTransaction(async tx=>{
            const member = await membership(req.student.uid,tx);
            const payment = (await tx.get(db.doc('payments/'+id))).data();
            assertPayable(payment,member.studentId);
            const config = (await tx.get(db.doc('paymentConfig/main'))).data();
            if (!config?.bankId) fail(409,'ผู้ดูแลยังไม่ได้เลือกบัญชีรับเงินสำหรับหน้าบ้าน');
            const bank = (await tx.get(db.doc('banks/'+safeId(config.bankId)))).data();
            if (!bank?.accountName || !bank.bankName || !bank.accountNumber) fail(409,'ข้อมูลบัญชีรับเงินไม่ครบ');
            let qrFile = null;
            if (bank.qrFileId) {
                qrFile = (await tx.get(db.doc('files/'+safeId(bank.qrFileId)))).data();
                if (!qrFile || qrFile.category !== 'bankqr') fail(409,'ไม่พบภาพคิวอาร์ของบัญชีรับเงิน');
            }
            const ref = quoteRef(req.student.uid,id);
            const old = (await tx.get(ref)).data();
            const compatible = old && old.version === payment.version && old.configVersion === config.version && old.bankUpdatedAt === bank.updatedAt;
            // ไม่ต่ออายุรายการเดิมอย่างเงียบ ๆ เมื่อกดโหลดซ้ำ
            const expiresAt = compatible ? old.expiresAt : config.expiryMinutes ? Date.now()+config.expiryMinutes*60000 : null;
            const quote = {uid:req.student.uid,studentId:member.studentId,paymentId:id,version:payment.version,amount:payment.amount,bankId:config.bankId,bankUpdatedAt:bank.updatedAt,configVersion:config.version,expiresAt};
            tx.set(ref,quote);
            return {payment,config,bank,qrFile,quote};
        });
        let qrImageUrl = null;
        if (result.qrFile) {
            const signed = await storage.createSignedUrl(result.qrFile.path,3600);
            if (signed.error) fail(503,'ไม่สามารถโหลดภาพคิวอาร์ กรุณาลองอีกครั้ง');
            qrImageUrl = signed.data.signedUrl;
        }
        const {payment,bank,config,quote}=result;
        res.json({paymentId:id,amount:payment.amount,currency:'THB',version:payment.version,
            bank:{accountName:bank.accountName,bankName:bank.bankName,accountNumber:bank.accountNumber,promptpayNumber:bank.promptpayNumber||''},
            qrImageUrl,allowedMethods:config.allowCash?['transfer','cash']:['transfer'],serverTime:time(),expiresAt:quote.expiresAt===null?null:new Date(quote.expiresAt).toISOString(),csrfToken:csrf(req.studentCookie)});
    }));
    const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1,fields:3,fieldSize:512}});
    router.post('/payment/submit', checkOrigin, requireCsrf, upload.single('slip'), wrap(async(req,res)=>{
        const id = safeId(req.body.paymentId);
        const version = Number(req.body.version);
        if (req.body.version === undefined || !Number.isSafeInteger(version) || version < 0) fail(400,'รุ่นข้อมูลไม่ถูกต้อง');
        const method = req.body.method;
        if (!['transfer','cash'].includes(method)) fail(400,'วิธีชำระเงินไม่ถูกต้อง');
        if (method === 'cash' && req.file) fail(400,'รายการเงินสดไม่ต้องแนบสลิป');
        const key = req.get('Idempotency-Key');
        if (!key || key.length > 250) fail(400,'ไม่พบรหัสป้องกันส่งรายการซ้ำ');
        const ref = db.doc('paymentSubmissions/'+hash(req.student.uid+'|'+key));
        function replay(record) {
            if (record.paymentId !== id || record.version !== version || record.method !== method) fail(409,'รหัสส่งรายการซ้ำไม่ตรงกับรายการเดิม');
            return {success:true,status:record.status,submissionId:ref.id};
        }
        const prior = (await ref.get()).data();
        if (prior) return res.json(replay(prior));
        const ext = method === 'transfer' ? imageType(req.file?.buffer) : null;
        const fileId = method === 'transfer' ? randomUUID() : null;
        const path = fileId ? 'slip/'+fileId+'.'+ext : null;
        let uploaded = false;
        let committed = false;
        try {
            if (path) {
                const result = await storage.upload(path,req.file.buffer,{contentType:ext==='png'?'image/png':'image/jpeg',upsert:false});
                if (result.error) fail(503,'อัปโหลดหลักฐานไม่สำเร็จ');
                uploaded = true;
            }
            const result = await db.runTransaction(async tx=>{
                const previous = (await tx.get(ref)).data();
                if (previous) return {...replay(previous),reused:true};
                const member = await membership(req.student.uid,tx);
                const paymentRef = db.doc('payments/'+id);
                const payment = (await tx.get(paymentRef)).data();
                assertPayable(payment,member.studentId,version);
                const config = (await tx.get(db.doc('paymentConfig/main'))).data();
                const bank = config?.bankId ? (await tx.get(db.doc('banks/'+safeId(config.bankId)))).data() : null;
                const quote = (await tx.get(quoteRef(req.student.uid,id))).data();
                checkQuote(quote,payment,config,bank,req.student.uid,Date.now());
                if (method === 'cash' && !config.allowCash) fail(409,'ยังไม่เปิดให้ชำระเงินสด');
                const record = {uid:req.student.uid,studentId:member.studentId,paymentId:id,version,amount:payment.amount,method,fileId,bankId:config.bankId,
                    bankSnapshot:{accountName:bank.accountName,bankName:bank.bankName,accountNumber:bank.accountNumber,promptpayNumber:bank.promptpayNumber||''},status:'รอตรวจสอบ',createdAt:time()};
                if (fileId) tx.set(db.doc('files/'+fileId),{path,category:'slip',name:'หลักฐานการโอนเงิน.'+ext,type:ext,studentId:member.studentId,paymentId:id,year:payment.year,semester:payment.semester,month:payment.month,createdAt:time(),uid:req.student.uid});
                tx.set(ref,record);
                tx.update(paymentRef,{status:'รอตรวจสอบ',version:version+1,lastSubmissionId:ref.id,updatedBy:req.student.uid,updatedAt:time()});
                log(tx,req.student.uid,'นักเรียนส่ง'+(method==='cash'?'รายการเงินสด':'หลักฐานโอนเงิน')+' '+id+' รอตรวจสอบ');
                return {success:true,status:'รอตรวจสอบ',submissionId:ref.id,reused:false};
            });
            committed = !result.reused;
            if (result.reused && uploaded) await storage.remove([path]);
            res.json({success:result.success,status:result.status,submissionId:result.submissionId});
        } catch(error) {
            // ตรวจผลธุรกรรมก่อนลบไฟล์ กรณีฐานข้อมูลตอบกลับขาดหายหลังบันทึกสำเร็จ
            if (uploaded && !committed) {
                try {
                    const saved = (await ref.get()).data();
                    if (saved?.fileId === fileId) return res.json(replay(saved));
                    await storage.remove([path]);
                } catch { console.error('กรุณาตรวจสอบไฟล์ที่อาจค้างจากการอัปโหลด',fileId); }
            }
            throw error;
        }
    }));
    router.use((req,res)=>res.status(404).json({message:'ไม่พบเส้นทางนักเรียน'}));
    router.use((error,req,res,next)=>{
        const status = error instanceof PaymentError ? error.status : error instanceof multer.MulterError ? 400 : 500;
        const message = error instanceof PaymentError ? error.message : error instanceof multer.MulterError ? 'ไฟล์หรือจำนวนข้อมูลเกินข้อกำหนด' : 'บริการชำระเงินขัดข้อง กรุณาลองอีกครั้ง';
        if (status === 500) console.error('บริการนักเรียนขัดข้อง',error.code||error.name);
        res.status(status).json({message});
    });
    app.use('/api/student',router);
}

// เส้นทางจัดการค่าที่เชื่อมหน้าบ้าน ต้องติดตั้งหลังตัวตรวจสิทธิ์ผู้ดูแล
export function installPaymentAdminRoutes(app,{db,auth,master,wrap,log}) {
    app.post('/api/payment-config',master,wrap(async(req,res)=>{
        const bankId = safeId(req.body.bankId);
        const expiryMinutes = Number(req.body.expiryMinutes);
        if (!Number.isInteger(expiryMinutes) || expiryMinutes < 0 || expiryMinutes > 60 || typeof req.body.allowCash !== 'boolean') fail(400,'ค่าการรับชำระเงินไม่ถูกต้อง');
        if (req.body.confirmed !== true) fail(400,'กรุณายืนยันการตั้งค่ารับชำระ');
        await db.runTransaction(async tx=>{
            const bank = await tx.get(db.doc('banks/'+bankId));
            const ref=db.doc('paymentConfig/main'),previous=await tx.get(ref);
            if (!bank.exists) fail(404,'ไม่พบบัญชีธนาคาร');
            tx.set(ref,{bankId,expiryMinutes,allowCash:req.body.allowCash,version:(previous.data()?.version||0)+1,updatedAt:time(),updatedBy:req.user.uid});
            log(tx,req.user.uid,'กำหนดบัญชีรับเงินสำหรับหน้าบ้าน');
        });
        res.json({ok:true});
    }));
    app.post('/api/student-accounts',master,wrap(async(req,res)=>{
        const studentId=safeId(req.body.studentId),uid=safeId(req.body.uid);
        const account=await auth.getUser(uid);
        if (account.disabled) fail(400,'บัญชีนี้ถูกปิดใช้งาน');
        await db.runTransaction(async tx=>{
            const student=await tx.get(db.doc('students/'+studentId));
            const admin=await tx.get(db.doc('admins/'+uid));
            const current=await tx.get(db.doc('studentAccounts/'+uid));
            const others=await tx.get(db.collection('studentAccounts').where('studentId','==',studentId));
            if (!student.exists || admin.exists) fail(400,'ไม่พบนักเรียนหรือบัญชีนี้เป็นบัญชีผู้ดูแล');
            if (current.exists && current.data().studentId !== studentId) fail(409,'บัญชีนี้ผูกกับนักเรียนคนอื่นแล้ว');
            if (others.docs.some(d=>d.id!==uid)) fail(409,'นักเรียนนี้มีบัญชีที่ผูกไว้แล้ว กรุณายกเลิกการผูกเดิมก่อน');
            tx.set(db.doc('studentAccounts/'+uid),{studentId,active:true,email:account.email||'',updatedAt:time(),updatedBy:req.user.uid});
            log(tx,req.user.uid,'ผูกบัญชีเข้าสู่ระบบนักเรียน '+studentId);
        });
        res.json({ok:true});
    }));
    app.delete('/api/student-accounts/:uid',master,wrap(async(req,res)=>{
        const uid=safeId(req.params.uid);
        await db.runTransaction(async tx=>{tx.delete(db.doc('studentAccounts/'+uid));log(tx,req.user.uid,'ยกเลิกการผูกบัญชีนักเรียน '+uid);});
        res.json({ok:true});
    }));
}
