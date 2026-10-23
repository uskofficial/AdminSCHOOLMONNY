// ตัวเชื่อมสำหรับนำไปใช้กับหน้าบ้านที่จะส่งมาเพิ่มเติม
// ต้องให้หน้าบ้านอยู่บนต้นทางเดียวกับเซิร์ฟเวอร์หลังบ้าน
async function request(path, options = {}) {
    const response = await fetch('/api/student' + path, {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {Accept: 'application/json', ...(options.headers || {})}
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'ไม่สามารถดำเนินการได้');
    return data;
}
export async function startStudentSession(firebaseUser) {
    if (!firebaseUser) throw new Error('กรุณาเข้าสู่ระบบนักเรียน');
    return request('/session', {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + await firebaseUser.getIdToken(true)}
    });
}
export async function listStudentPayments() {
    return (await request('/payments')).payments;
}
export async function getStudentPayment(paymentId) {
    return request('/payment' + (paymentId ? '?paymentId=' + encodeURIComponent(paymentId) : ''));
}
export async function submitStudentPayment(payment, file, method = 'transfer') {
    const body = new FormData();
    body.set('paymentId', payment.paymentId);
    body.set('version', String(payment.version));
    body.set('method', method);
    if (method === 'transfer') {
        if (!file) throw new Error('กรุณาแนบหลักฐานการโอนเงิน');
        body.set('slip', file);
    }
    return request('/payment/submit', {
        method: 'POST',
        headers: {
            'X-CSRF-Token': payment.csrfToken,
            'Idempotency-Key': 'payment:' + payment.paymentId + ':version:' + payment.version
        },
        body
    });
}
export async function endStudentSession() {
    const session = await request('/session');
    return request('/session', {method: 'DELETE', headers: {'X-CSRF-Token': session.csrfToken}});
}
