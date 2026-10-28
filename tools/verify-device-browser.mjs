/** Actual browser acceptance harness; requires an explicitly enabled loopback CDP profile.
 * JSON stdin: {action, taskId?, image?, captureFrame?}.
 * scan decodes a saved image and types into the software form; scan-camera clicks
 * the real webcam button. invalid/wrong deliberately use synthetic text.
 * Never prints QR text, source order/product IDs, tokens, device IDs, or images.
 */
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
process.umask(0o077);
import {execFileSync} from 'node:child_process';
import zxing from '@zxing/library';
const input=JSON.parse(readFileSync(0,'utf8'));
const port=readFileSync('var/browser-profile/DevToolsActivePort','utf8').split('\n')[0];
const page=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:3200/device'));
if(!page)throw Error('Device tab missing');
const ws=new WebSocket(page.webSocketDebuggerUrl);let seq=0;const pending=new Map();
ws.addEventListener('message',m=>{const v=JSON.parse(String(m.data));if(pending.has(v.id)){const {resolve,reject,timer}=pending.get(v.id);clearTimeout(timer);pending.delete(v.id);v.error?reject(Error(JSON.stringify(v.error))):resolve(v.result);}});
await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout'));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
if(input.action==='camera-probe'){
 await call('Browser.grantPermissions',{origin:'http://127.0.0.1:3200',permissions:['videoCapture']});
 console.log(JSON.stringify(await evaluate(`(async()=>{const p=await navigator.permissions.query({name:'camera'});return {permission:p.state,devices:await Promise.race([navigator.mediaDevices.enumerateDevices().then(d=>d.map(x=>({kind:x.kind,label:x.label}))),new Promise(r=>setTimeout(()=>r('TIMEOUT'),8000))])};})()`)));
}else{
 const observe=`(async()=>{const l=await(await fetch('/local/v1/tasks?limit=200')).json();const target=${JSON.stringify(input.taskId||null)};if(!target&&l.items.length!==1)throw Error('Supply taskId when more than one task is present');const selected=target?l.items.find(t=>t.snapshot.taskId===target):l.items[0];if(!selected)throw Error('Selected task not visible');const s=await(await fetch('/local/v1/tasks/'+selected.snapshot.taskId)).json(),h=await(await fetch('/local/v1/tasks/'+s.snapshot.taskId+'/history')).json();return {taskId:s.snapshot.taskId,localStatus:s.localStatus,syncStatus:s.syncStatus,nextSeq:s.nextSeq,appliedTotal:s.items.reduce((n,i)=>n+i.appliedQty,0),requiredTotal:s.items.reduce((n,i)=>n+i.requiredQty,0),completeDisabled:[...document.querySelectorAll('button')].find(b=>b.textContent==='로컬 완료 기록')?.disabled,states:[...document.querySelectorAll('.states .badge')].map(x=>x.textContent),alert:document.querySelector('[role=alert]')?.textContent||null,events:h.events.map(e=>({seq:e.event.seq,type:e.event.type,status:e.status,receiptResult:e.receipt?.result||null})),pending:h.events.filter(e=>e.status!=='ACKED').length};})()`;
 if(!input.keepSelection)await evaluate(`(async()=>{const l=await(await fetch('/local/v1/tasks?limit=200')).json();const target=${JSON.stringify(input.taskId||null)};if(!target&&l.items.length!==1)throw Error('Supply taskId');const t=target?l.items.find(t=>t.snapshot.taskId===target):l.items[0];if(!t)throw Error('Selected task missing');const prefix=t.snapshot.externalOrderId.slice(0,12),buttons=[...document.querySelectorAll('button.task')].filter(b=>b.firstChild.textContent===prefix);if(buttons.length!==1)throw Error('Ambiguous task button');buttons[0].click();return true;})()`);
 await new Promise(r=>setTimeout(r,300));const before=await evaluate(observe);let source='UI_ACTION';
 if(input.action==='scan-camera'){
  source='ACTUAL_C270_LIVE_BROWSER_CAMERA';
  await call('Browser.grantPermissions',{origin:'http://127.0.0.1:3200',permissions:['videoCapture']});
  await evaluate(`(()=>{window.__liveCamera=null;document.querySelector('video').addEventListener('loadedmetadata',()=>{const v=document.querySelector('video'),t=v.srcObject?.getVideoTracks()[0];if(t)window.__liveCamera={label:t.label,width:v.videoWidth,height:v.videoHeight};},{once:true});const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='웹캠으로 QR 1개 읽기');if(!b||b.disabled)throw Error('Camera unavailable');b.click();return true;})()`);
  for(let n=0;n<40;n++){await new Promise(r=>setTimeout(r,200));const ended=await evaluate(`!([...document.querySelectorAll('button')].some(x=>x.textContent==='카메라 중지'))`);if(ended)break;}
 }else if(input.action==='scan'||input.action==='invalid'||input.action==='wrong'){
  let text;
  if(input.action==='scan'){
   const md=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=width,height','-of','json',input.image],{encoding:'utf8'}));const {width,height}=md.streams[0];const gray=execFileSync('ffmpeg',['-v','error','-i',input.image,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','pipe:1'],{maxBuffer:16777216});
   text=new zxing.QRCodeReader().decode(new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(new Uint8ClampedArray(gray),width,height)))).getText();source='SAVED_ACTUAL_C270_PHOTO_VIA_UI_TEXT_FORM';
  }else{text=input.action==='invalid'?'INVALID-C270-TEST':'LOPS1:PRODUCT:'+'f'.repeat(32);source='SYNTHETIC_TEXT_VIA_ACTUAL_PI_UI';}
  await evaluate(`(()=>{const d=document.querySelector('details');d.open=true;const i=document.querySelector('input[aria-label="QR 문자열"]');i.focus();i.select();return true;})()`);
  await call('Input.insertText',{text});await evaluate(`(()=>{document.querySelector('input[aria-label="QR 문자열"]').form.requestSubmit();return true;})()`);
 }else if(input.action==='reverse')await evaluate(`(()=>{const b=[...document.querySelectorAll('.event button')].at(-1);if(!b||b.disabled)throw Error('Reversal unavailable');b.click();return true;})()`);
 else if(input.action==='complete'||input.action==='retry')await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(input.action==='complete'?'로컬 완료 기록':'일시 오류 동기화 재시도')});if(!b||b.disabled)throw Error('Action unavailable');b.click();return true;})()`);
 else if(input.action!=='observe')throw Error('Unknown action');
 await new Promise(r=>setTimeout(r,350));let after=await evaluate(observe);
 const camera=await evaluate(`window.__liveCamera||null`);let framePath,frameSha256;
 if(input.action==='scan-camera'&&input.captureFrame){const frame=await evaluate(`(()=>{const v=document.querySelector('video');if(!v.videoWidth)return null;const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/jpeg').split(',')[1];})()`);if(frame){mkdirSync('var/browser-camera-frames',{recursive:true,mode:0o700});framePath=mkdtempSync('var/browser-camera-frames/frame-')+'/frame.jpg';const bytes=Buffer.from(frame,'base64');writeFileSync(framePath,bytes,{mode:0o600,flag:'wx'});frameSha256=createHash('sha256').update(bytes).digest('hex');}}
 if(input.action==='scan-camera')await evaluate(`(()=>{[...document.querySelectorAll('button')].find(x=>x.textContent==='카메라 중지')?.click();return true;})()`);console.log(JSON.stringify({at:new Date().toISOString(),action:input.action,source,before,after,...(input.action==='scan-camera'?{camera,...(framePath?{framePath,frameSha256}:{})}:{})}));
}
}finally{ws.close();}
