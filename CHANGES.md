# รายการเปลี่ยนแปลงและการคงโค้ดเดิม

ตรวจเทียบกับ USK-SCHOOLMONEY(1).zip ที่แนบมา เก็บครบทุกไฟล์เดิม ไม่มีไฟล์เดิมถูกลบ

## ไฟล์เดิมที่เหมือนต้นฉบับทุกไบต์

- firestore.rules
- package-lock.json
- .gitignore
- package.json
- bootstrap.mjs
- tailwind.config.cjs
- public/index.html
- public/input.css
- public/style.css
- public/tailwind.css
- test/domain.test.mjs
- scripts/ui-check.cjs

## ไฟล์ที่เปลี่ยนเฉพาะส่วนเชื่อมการรับชำระเงิน

- USK-SCHOOLMONEY.html
- .env.example
- README.md
- domain.mjs
- server.mjs
- public/app.js

server.mjs เพิ่มเส้นทางนักเรียนและตั้งค่าบัญชี ผูกผลตรวจกลับไปยังรายการส่งชำระ และล้างการผูกบัญชีเมื่อมีการลบนักเรียน domain.mjs เพิ่มการตรวจพร้อมเพย์และรหัสภาพ QR public/app.js เพิ่มฟอร์มที่เกี่ยวข้องและกล่องยืนยันบัญชี USK-SCHOOLMONEY.html สร้างจากหน้าจอและสคริปต์เดียวกันโดยรวมโค้ดครบ ไม่ใช่ไฟล์ตัดย่อ .env.example เพิ่มค่าต้นทางและความลับเซสชัน README.md เก็บเนื้อหาเดิมครบและเพิ่มหมายเหตุส่วนใหม่ด้านบน

## ไฟล์ใหม่

- student-payments.mjs
- public/student-bridge.js
- API-STUDENT.md
- test/student-payments.test.mjs
- scripts/payment-ui-check.cjs
- CHANGES.md

ส่วน CSS, โครงหน้า index.html, เมนูเดิม, รายงาน, งานล่วงหน้า, การจัดการแอดมิน และคำขอล้างประวัติไม่ได้ถูกตัดย่อหรือออกแบบใหม่
