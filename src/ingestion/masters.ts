import { type Db,transaction } from '../server/db.js';

// File preparation uses the same bounded 200-record unit as MVP source pages.
// Existing batches survive interruption; manifest validation remains the caller's responsibility.
export async function importMasters(db:Db,runId:string,products:Iterable<any>,sellers:Iterable<any>,progress?:(kind:string,count:number)=>void) {
  let productsImported=0,sellersImported=0;
  let batch:any[]=[];
  const saveProducts=async()=>{
    if(!batch.length)return;
    const rows=batch;batch=[];
    await transaction(db,async tx=>{await tx.execute('INSERT INTO products(run_id,product_id,category,attributes) VALUES '+rows.map(()=>'(?,?,?,?)').join(',')+' ON DUPLICATE KEY UPDATE product_id=product_id',rows.flatMap(row=>{
      const p=JSON.parse(row.payload);return [runId,row.id,p.product_category_name||null,row.payload];
    }));});
    productsImported+=rows.length;progress?.('products',productsImported);
  };
  for(const row of products){batch.push(row);if(batch.length===200)await saveProducts();}
  await saveProducts();
  const saveSellers=async()=>{
    if(!batch.length)return;
    const rows=batch;batch=[];
    await transaction(db,async tx=>{await tx.execute('INSERT INTO sellers(run_id,seller_id) VALUES '+rows.map(()=>'(?,?)').join(',')+' ON DUPLICATE KEY UPDATE seller_id=seller_id',rows.flatMap(row=>[runId,row.id]));});
    sellersImported+=rows.length;progress?.('sellers',sellersImported);
  };
  for(const row of sellers){batch.push(row);if(batch.length===200)await saveSellers();}
  await saveSellers();return {productsImported,sellersImported};
}
