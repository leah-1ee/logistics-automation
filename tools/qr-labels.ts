import { DatabaseSync } from 'node:sqlite';
import { QRCodeWriter,BarcodeFormat } from '@zxing/library';
import { mkdirSync,writeFileSync } from 'node:fs';
const db=new DatabaseSync(process.env.PREPARED_DB!,{readOnly:true});
try {
  const manifest=JSON.parse((db.prepare("SELECT value FROM meta WHERE key='manifest'").get() as any).value);
  const products=db.prepare('SELECT id FROM products ORDER BY id LIMIT 12').all() as any[];
  const labels=products.map(({id})=>{
    if(!/^[a-f0-9]{32}$/.test(id))throw new Error('Invalid product ID; raw source preserved for review');
    const text='LOPS1:PRODUCT:'+id,matrix=new QRCodeWriter().encode(text,BarcodeFormat.QR_CODE,0,0,new Map());
    const commands=[];for(let y=0;y<matrix.getHeight();y++)for(let x=0;x<matrix.getWidth();x++)if(matrix.get(x,y))commands.push(`M${x} ${y}h1v1h-1z`);
    return `<article><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${matrix.getWidth()} ${matrix.getHeight()}" width="220" height="220" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${commands.join('')}"/></svg><p>${id}</p><small>프로젝트 모의 출고 표식 · ${manifest.synthetic?'SYNTHETIC':'Olist 원본 상품 ID'}</small></article>`;
  });
  mkdirSync('var',{recursive:true});writeFileSync('var/qr-labels.html',`<!doctype html><html lang="ko"><meta charset="utf-8"><title>LOPS QR 표식</title><style>body{font-family:system-ui;display:flex;flex-wrap:wrap}article{border:1px solid #999;margin:12px;padding:20px;text-align:center;break-inside:avoid}p{font-size:12px}small{font-size:11px}</style>${labels.join('')}</html>`);console.log('Wrote',labels.length,'labels to var/qr-labels.html; actual webcam verification remains BLOCKED');
} finally{db.close();}
