import {deleteApp} from 'firebase-admin/app';
import {validateCloudConfig,initializeFirebase,createStorageClient,verifyConnections} from '../cloud-config.mjs';
let app;
const timeout=setTimeout(()=>{console.error('ตรวจการเชื่อมต่อเกินเวลา กรุณาตรวจเครือข่ายและสิทธิ์');process.exit(1);},60000);
try{
    const config=validateCloudConfig(process.env);
    app=initializeFirebase();
    const results=await verifyConnections(app,createStorageClient(),config.bucket);
    for(const result of results)console.log((result.ok?'เชื่อมต่อสำเร็จ: ':'เชื่อมต่อไม่สำเร็จ: ')+result.service);
    if(results.some(result=>!result.ok))process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
finally{clearTimeout(timeout);if(app)await deleteApp(app);}
