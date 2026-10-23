export const dorms=['หอพักญะมาอะห์ชาย','หอพักญะมาอะห์หญิง','หอพักกีฬา','หอพักฮาฟิซอัลกุรอ่าน'];
export const statuses=['ชำระแล้ว','ค้างชำระ','รอตรวจสอบ','ยังไม่ถึงกำหนด'];
export function amount(v){const n=Number(v);if(v===''||!Number.isFinite(n)||n<0||n>10000000||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('ยอดเงินไม่ถูกต้อง');return n;}
export function text(v,max=2000){if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('กรุณากรอกข้อมูลให้ถูกต้อง');return v.trim();}
export function paymentId(studentId,year,semester,month){return [studentId,year,semester,month].join('_');}
export function validate(kind,d){
 const fields={students:['code','name','grade','dorm'],banks:['accountName','bankName','accountNumber'],posts:['title','body','fileId'],faqs:['question','answer'],issues:['studentId','subject','body'],tasks:['year','semester','month','runAt'],settings:['documentName','address','documentId']}[kind];
 if(!fields)throw Error('ไม่พบประเภทข้อมูล');
 const result={};for(const f of fields)result[f]=text(d[f]);
 if(kind==='banks'){result.promptpayNumber=typeof d.promptpayNumber==='string'?d.promptpayNumber.trim():'';result.qrFileId=typeof d.qrFileId==='string'?d.qrFileId.trim():'';if(result.promptpayNumber&&!/^(0[0-9]{9}|[0-9]{13}|[0-9]{15})$/.test(result.promptpayNumber))throw Error('หมายเลขพร้อมเพย์ไม่ถูกต้อง');if(result.qrFileId&&!/^[A-Za-z0-9_-]+$/.test(result.qrFileId))throw Error('รหัสไฟล์คิวอาร์ไม่ถูกต้อง');}
 if(kind==='students'&&!dorms.includes(d.dorm))throw Error('หอพักไม่ถูกต้อง');
 if(kind==='issues'){result.status='รอตรวจสอบ';result.fileId=typeof d.fileId==='string'?d.fileId:'';}
 if(kind==='tasks'){result.amount=amount(d.amount);if(!/^\d{4}$/.test(d.year)||!/^\d{1,2}$/.test(d.semester)||!/^\d{4}-\d{2}$/.test(d.month))throw Error('ช่วงเวลาไม่ถูกต้อง');if(!Number.isFinite(Date.parse(d.runAt))||Date.parse(d.runAt)<=Date.now())throw Error('กรุณาระบุเวลาในอนาคต');result.state='รอดำเนินการ';}
 if(kind==='settings'){result.timeout=Number(d.timeout);result.countdown=Number(d.countdown);if(!Number.isInteger(result.timeout)||result.timeout<1||result.timeout>120||!Number.isInteger(result.countdown)||result.countdown<1||result.countdown>60)throw Error('เวลาไม่ถูกต้อง');result.logoId=d.logoId||'';result.welcomeId=d.welcomeId||'';result.timezone='Asia/Bangkok';result.language='th';result.currency='THB';}
 return result;
}
