-- สร้างหรือปรับเฉพาะพื้นที่ของระบบให้เป็นส่วนตัว จำกัดขนาดและชนิดไฟล์
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'schoolmoney-private',
    'schoolmoney-private',
    false,
    8388608,
    array['image/png', 'image/jpeg', 'application/pdf']
)
on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- จำกัดบัญชีสาธารณะและบัญชีผู้ใช้ทั่วไปไม่ให้เข้าถึง bucket นี้โดยตรง
-- เซิร์ฟเวอร์ใช้คีย์ที่มีสิทธิ์บริการ ส่วนการอ่านรูปใช้ลิงก์ที่เซิร์ฟเวอร์ลงนาม
-- นโยบายแบบจำกัดช่วยป้องกันนโยบายเปิดกว้างที่มีอยู่เดิม โดยไม่แตะ bucket อื่น
 drop policy if exists schoolmoney_backend_only on storage.objects;
 create policy schoolmoney_backend_only
 on storage.objects
 as restrictive
 for all
 to anon, authenticated
 using (bucket_id <> 'schoolmoney-private')
 with check (bucket_id <> 'schoolmoney-private');
