import {createStorageClient} from '../cloud-config.mjs';
// สร้างพื้นที่ส่วนตัวสำหรับระบบนี้เท่านั้น ไม่แก้พื้นที่อื่น
const client=createStorageClient();
const bucket=process.env.SUPABASE_BUCKET||'schoolmoney-private';
const options={public:false,fileSizeLimit:8*1024*1024,allowedMimeTypes:['image/png','image/jpeg','application/pdf']};
const existing=await client.storage.getBucket(bucket);
if(existing.error){
    if(String(existing.error.status)!=='404'&&String(existing.error.statusCode)!=='404')throw Error('อ่าน bucket ไม่สำเร็จ กรุณาตรวจสิทธิ์ Supabase ก่อน');
    const created=await client.storage.createBucket(bucket,options);
    if(created.error)throw Error('สร้าง bucket ไม่สำเร็จ');
    console.log('สร้างพื้นที่เก็บไฟล์ส่วนตัวแล้ว');
}else{
    const updated=await client.storage.updateBucket(bucket,options);
    if(updated.error)throw Error('ตั้งค่า bucket ไม่สำเร็จ');
    console.log('ตั้งค่าพื้นที่เก็บไฟล์ส่วนตัวแล้ว');
}
