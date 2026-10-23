const {JSDOM}=require('jsdom');
const fs=require('fs');
const assert=require('node:assert/strict');
// ตรวจปุ่มและข้อมูลที่ส่งออกจากแบบฟอร์มส่วนเชื่อมหน้าบ้าน
(async()=>{
 const dom=new JSDOM(fs.readFileSync('public/index.html','utf8'),{url:'http://localhost',runScripts:'outside-only'});
 const w=dom.window;w.setInterval=()=>0;w.scrollTo=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const state={students:[{id:'s1',code:'001',name:'ทดสอบ',grade:'ม.1',dorm:'หอพักกีฬา'}],banks:[],files:[],admins:[]};const calls=[];
 w.fetch=async(url,o)=>{const body=o?.body?JSON.parse(o.body):null;calls.push({url,body});if(url==='/api/record/banks')state.banks=[{id:'b1',...body.data}];return {ok:true,json:async()=>url==='/api/state'?{user:{uid:'m',name:'ทดสอบ',role:'master'},data:state}:{ok:true}};};
 let code=fs.readFileSync('public/app.js','utf8');code=code.slice(0,code.indexOf('try{const firebase=await import'));
 await w.eval('(async()=>{'+code+"\nauth={currentUser:{getIdToken:async()=> 'token'}};await refresh();window.go=i=>{page=i;render();};})()");
 const pause=()=>new Promise(r=>setTimeout(r,15));
 w.go(2);let f=w.document.querySelector('[data-form=banks]');for(const [key,value]of Object.entries({accountName:'ทดสอบ',bankName:'ทดสอบ',accountNumber:'0000123',promptpayNumber:'0812345678'}))f.querySelector('[name='+key+']').value=value;
 f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await pause();assert.equal(w.document.querySelector('#modal').open,true);w.document.querySelector('[data-choice="0"]').click();await pause();let posted=calls.find(c=>c.url==='/api/record/banks');assert.equal(posted.body.confirmed,true);assert.equal(posted.body.data.promptpayNumber,'0812345678');
 f=w.document.querySelector('[data-form=payment-config]');f.querySelector('[name=bankId]').value='b1';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await pause();w.document.querySelector('[data-choice="0"]').click();await pause();posted=calls.find(c=>c.url==='/api/payment-config');assert.equal(posted.body.bankId,'b1');assert.equal(posted.body.allowCash,false);
 w.go(1);f=w.document.querySelector('[data-form=student-account]');f.querySelector('[name=studentId]').value='s1';f.querySelector('[name=uid]').value='studentUid';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await pause();posted=calls.find(c=>c.url==='/api/student-accounts');assert.equal(posted.body.studentId,'s1');assert.equal(posted.body.uid,'studentUid');
 console.log('ผ่าน: บันทึกพร้อมเพย์พร้อมยืนยัน เลือกบัญชีรับเงิน และผูกบัญชีนักเรียน');dom.window.close();
})().catch(e=>{console.error(e);process.exit(1);});
