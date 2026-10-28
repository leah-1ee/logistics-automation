import { DatabaseSync } from 'node:sqlite';
import { QRCodeWriter,BarcodeFormat } from '@zxing/library';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
const taskIndex=process.argv.indexOf('--task-id'),taskId=taskIndex>=0?process.argv[taskIndex+1]:null;
if(taskIndex>=0&&(!taskId||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).test(taskId)))throw new Error('Valid task UUID required');
const db=new DatabaseSync(process.env.PREPARED_DB!,{readOnly:true});
try {
  const manifest=JSON.parse((db.prepare("SELECT value FROM meta WHERE key='manifest'").get() as any).value);
  let products=db.prepare('SELECT id FROM products ORDER BY id LIMIT 12').all() as any[];
  if(taskId){
    const response=await fetch(new URL('/api/v1/tasks/'+taskId,process.env.SERVER_URL!),{headers:{Authorization:'Bearer '+process.env.ADMIN_TOKEN},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Task lookup failed: '+response.status);
    const detail=await response.json();
    if(detail.task.datasetRunId!==process.env.DATASET_RUN_ID)throw new Error('Task does not belong to selected dataset run');
    products=detail.task.items.map((i:any)=>({id:i.productId,requiredQty:i.requiredQty}));
    for(const p of products)if(!db.prepare('SELECT id FROM products WHERE id=?').get(p.id))throw new Error('Task product is absent from selected source');
  }
  const labels=products.map(({id,requiredQty})=>{
    if(!/^[a-f0-9]{32}$/.test(id))throw new Error('Invalid product ID; raw source preserved for review');
    const text='LOPS1:PRODUCT:'+id,matrix=new QRCodeWriter().encode(text,BarcodeFormat.QR_CODE,0,0,new Map());
    const commands=[];for(let y=0;y<matrix.getHeight();y++)for(let x=0;x<matrix.getWidth();x++)if(matrix.get(x,y))commands.push(`M${x} ${y}h1v1h-1z`);
    const quantity=requiredQty===undefined?'':`<p>필요 수량 ${Number.isSafeInteger(requiredQty)&&requiredQty>0?requiredQty:'확인 필요'}</p>`;
    return `<article><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${matrix.getWidth()} ${matrix.getHeight()}" width="220" height="220" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${commands.join('')}"/></svg><p>${id}</p>${quantity}<small>프로젝트 모의 출고 표식 · ${manifest.synthetic?'SYNTHETIC':'Olist 원본 상품 ID'}</small></article>`;
  });
  const directory=process.env.QR_OUTPUT_DIR||'var',path=join(directory,taskId?'qr-labels-'+taskId+'.html':'qr-labels.html');
  mkdirSync(directory,{recursive:true});writeFileSync(path,`<!doctype html><html lang="ko"><meta charset="utf-8"><title>LOPS QR 표식</title><style>body{font-family:system-ui;display:flex;flex-wrap:wrap}article{border:1px solid #999;margin:12px;padding:20px;text-align:center;break-inside:avoid}p{font-size:12px}small{font-size:11px}</style>${labels.join('')}</html>`);console.log('Wrote',labels.length,'labels to',path,'; actual webcam verification remains BLOCKED');
} finally{db.close();}
