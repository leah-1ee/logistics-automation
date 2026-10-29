/** Disposable disk index for the independent CSV oracle. No production/domain imports. */
import { DatabaseSync,type StatementSync } from 'node:sqlite';
import { createReadStream,mkdtempSync,chmodSync,rmSync,statSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';

const key=/^[a-f0-9]{32}$/;
const timestamp=(v:string)=>/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)&&Number.isFinite(Date.parse(v.replace(' ','T')+'Z'))&&new Date(v.replace(' ','T')+'Z').toISOString().slice(0,19).replace('T',' ')===v;
const files={
  orders:{file:'olist_orders_dataset.csv',headers:['order_id','order_status','order_approved_at','order_purchase_timestamp']},
  products:{file:'olist_products_dataset.csv',headers:['product_id','product_category_name']},
  sellers:{file:'olist_sellers_dataset.csv',headers:['seller_id']},
  items:{file:'olist_order_items_dataset.csv',headers:['order_id','order_item_id','product_id','seller_id','shipping_limit_date']}
};
export class SourceIndex {
  readonly directory=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'olist-audit-'));
  readonly db:DatabaseSync;
  readonly fileRows:Record<string,number>={};
  fileChecks=0;
  maxOrderItems=0;
  readonly counts:Record<string,number>={};
  readonly duplicateRows:Record<string,number>={};
  readonly conflictingKeys:Record<string,number>={};
  private order!:StatementSync;private product!:StatementSync;private seller!:StatementSync;private items!:StatementSync;private mark!:StatementSync;
  constructor(private fail:(code:string,count?:number)=>void){
    chmodSync(this.directory,0o700);
    this.db=new DatabaseSync(join(this.directory,'source.sqlite'));
    // Only this disposable derivative uses relaxed durability; event SQLite is untouched.
    this.db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-8192; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;
      CREATE TABLE source_orders(row_no INTEGER PRIMARY KEY,id TEXT,status TEXT,approved TEXT,purchased TEXT,row_hash TEXT,seen INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE source_products(row_no INTEGER PRIMARY KEY,id TEXT,payload TEXT,row_hash TEXT);
      CREATE TABLE source_sellers(row_no INTEGER PRIMARY KEY,id TEXT,row_hash TEXT);
      CREATE TABLE source_items(row_no INTEGER PRIMARY KEY,order_id TEXT,order_item_id TEXT,product_id TEXT,seller_id TEXT,shipping_limit_date TEXT);
      CREATE TABLE page_events(row_no INTEGER PRIMARY KEY,task_id TEXT,seq INTEGER,payload TEXT);
      CREATE INDEX page_event_order ON page_events(task_id,seq,row_no);
      CREATE TABLE event_scans(event_id TEXT PRIMARY KEY,product TEXT,reversed INTEGER);
      CREATE TABLE daily_expected(day TEXT PRIMARY KEY,tasks INTEGER,items INTEGER);
      CREATE TABLE daily_saved(day TEXT PRIMARY KEY,tasks INTEGER,items INTEGER);
      CREATE TABLE product_expected(day TEXT,product TEXT,qty INTEGER,PRIMARY KEY(day,product));
      CREATE TABLE product_saved(day TEXT,product TEXT,qty INTEGER,PRIMARY KEY(day,product));`);
  }
  async build(root:string,manifest:any){
    const listed=new Map<string,any>();
    for(const f of manifest.files||[]){if(listed.has(f.fileName))this.fail('SOURCE_MANIFEST_FILES');listed.set(f.fileName,f);}
    if(listed.size!==4||Object.values(files).some(f=>!listed.has(f.file)))this.fail('SOURCE_MANIFEST_FILES');
    this.db.exec('BEGIN');
    for(const [kind,definition] of Object.entries(files)){
      const meta=listed.get(definition.file),hash=createHash('sha256');let bytes=0,rows=0;
      const statement=this.db.prepare(kind==='orders'?'INSERT INTO source_orders(row_no,id,status,approved,purchased,row_hash) VALUES(?,?,?,?,?,?)':
        kind==='products'?'INSERT INTO source_products VALUES(?,?,?,?)':kind==='sellers'?'INSERT INTO source_sellers VALUES(?,?,?)':'INSERT INTO source_items VALUES(?,?,?,?,?,?)');
      const tap=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;hash.update(chunk);done(null,chunk);}});
      await pipeline(createReadStream(join(root,definition.file)),tap,parse({bom:true,columns:(headers:string[])=>{
        if(new Set(headers).size!==headers.length||definition.headers.some(h=>!headers.includes(h)))this.fail('CSV_HEADER');return headers;
      }}),async source=>{
        for await(const r of source as AsyncIterable<any>){
          rows++;
          const payload=kind==='items'?'':JSON.stringify(r),rowHash=kind==='items'?'':createHash('sha256').update(payload).digest('hex');
          if(kind==='orders')statement.run(rows,r.order_id||'',r.order_status||'',r.order_approved_at||'',r.order_purchase_timestamp||'',rowHash);
          else if(kind==='products')statement.run(rows,r.product_id||'',payload,rowHash);
          else if(kind==='sellers')statement.run(rows,r.seller_id||'',rowHash);
          else statement.run(rows,r.order_id||'',r.order_item_id||'',r.product_id||'',r.seller_id||'',r.shipping_limit_date||'');
        }
      });
      this.fileRows[kind]=rows;
      if(!meta||hash.digest('hex')!==meta.fileSha256||bytes!==meta.fileBytes)this.fail('RAW_FILE_FINGERPRINT');else this.fileChecks++;
      if(meta&&meta.rowCount!==rows)this.fail('SOURCE_ROW_COUNT');
    }
    this.db.exec(`COMMIT;
      CREATE INDEX order_key ON source_orders(id,row_no);
      CREATE INDEX product_key ON source_products(id,row_no);
      CREATE INDEX seller_key ON source_sellers(id);
      CREATE INDEX item_order ON source_items(order_id,row_no);
      CREATE INDEX item_identity ON source_items(order_id,order_item_id);
      BEGIN;`);
    for(const [kind,table,column] of [['orders','source_orders','id'],['products','source_products','id'],['sellers','source_sellers','id'],['items','source_items','row_no']]){
      this.counts[kind]=Number((this.db.prepare(`SELECT COUNT(DISTINCT ${column}) n FROM ${table}`).get() as any).n);
      if(kind!=='items'){
        const duplicate=Number((this.db.prepare(`SELECT COALESCE(SUM(n-1),0) n FROM (SELECT COUNT(*) n FROM ${table} GROUP BY id HAVING COUNT(*)>1)`).get() as any).n);
        this.duplicateRows[kind]=duplicate;
        const conflicts=Number((this.db.prepare(`SELECT COUNT(*) n FROM (SELECT id FROM ${table} GROUP BY id HAVING COUNT(DISTINCT row_hash)>1)`).get() as any).n);
        this.conflictingKeys[kind]=conflicts;
        if(conflicts)this.fail('SOURCE_KEY_CONFLICT_'+kind.toUpperCase(),conflicts);
      }
    }
    const duplicateItems=Number((this.db.prepare('SELECT COALESCE(SUM(n-1),0) n FROM (SELECT COUNT(*) n FROM source_items GROUP BY order_id,order_item_id HAVING COUNT(*)>1)').get() as any).n);
    // Repeated item identity is an INVALID_ITEM_KEY classification case; it can be correctly quarantined.
    this.duplicateRows.items=duplicateItems;
    const orphans=Number((this.db.prepare('SELECT COUNT(*) n FROM source_items i WHERE NOT EXISTS(SELECT 1 FROM source_orders o WHERE o.id=i.order_id)').get() as any).n);
    if(orphans)this.fail('ORPHAN_SOURCE_ITEM',orphans);
    this.order=this.db.prepare('SELECT id order_id,status order_status,approved order_approved_at,purchased order_purchase_timestamp,seen FROM source_orders WHERE id=? ORDER BY row_no DESC LIMIT 1');
    this.product=this.db.prepare('SELECT payload FROM source_products WHERE id=? ORDER BY row_no DESC LIMIT 1');
    this.seller=this.db.prepare('SELECT 1 FROM source_sellers WHERE id=? LIMIT 1');
    this.mark=this.db.prepare('UPDATE source_orders SET seen=1 WHERE id=?');
    this.items=this.db.prepare(`SELECT i.*,p.payload product,EXISTS(SELECT 1 FROM source_sellers s WHERE s.id=i.seller_id) seller_exists
      FROM source_items i LEFT JOIN source_products p ON p.row_no=(SELECT row_no FROM source_products WHERE id=i.product_id ORDER BY row_no DESC LIMIT 1)
      WHERE i.order_id=? ORDER BY i.row_no`);
  }
  getOrder(id:string):any{return this.order.get(id);}
  markSeen(id:string){this.mark.run(id);}
  seenCount(){return Number((this.db.prepare('SELECT COUNT(DISTINCT id) n FROM source_orders WHERE seen=1').get() as any).n);}
  getProduct(id:string):any{const row=this.product.get(id) as any;return row?JSON.parse(row.payload):undefined;}
  hasSeller(id:string){return Boolean(this.seller.get(id));}
  expected(order:any){
    // Only one order is materialized; no assumption about CSV order or contiguous item rows.
    const lines=(this.items.all(order.order_id) as any[]).sort((a,b)=>Number(a.order_item_id)-Number(b.order_item_id));
    this.maxOrderItems=Math.max(this.maxOrderItems,lines.length);
    const hold=new Set<string>(),unsupported=new Set<string>(),flags=new Set<string>(),ids=new Set<number>(),vendors=new Set<string>(),quantities=new Map<string,number>();
    if(!key.test(order.order_id))hold.add('INVALID_ORDER_KEY');if(!order.order_status)hold.add('MISSING_SOURCE_STATUS');
    if(!timestamp(order.order_approved_at))hold.add('MISSING_OR_INVALID_APPROVAL');if(!lines.length)hold.add('NO_ITEMS');
    for(const r of lines){
      const id=Number(r.order_item_id);if(!Number.isInteger(id)||id<1||ids.has(id))hold.add('INVALID_ITEM_KEY');ids.add(id);
      if(!key.test(r.product_id)||!r.product)hold.add('MISSING_PRODUCT');else quantities.set(r.product_id,(quantities.get(r.product_id)||0)+1);
      if(!r.seller_exists)hold.add('MISSING_SELLER');else vendors.add(r.seller_id);
      r.product=r.product?JSON.parse(r.product):undefined;
      if(!r.product?.product_category_name)flags.add('MISSING_CATEGORY');
      if(r.product)for(const name of ['product_weight_g','product_length_cm','product_height_cm','product_width_cm']){
        if(!r.product[name])flags.add(name.toUpperCase()+'_MISSING');else if(!Number.isFinite(Number(r.product[name]))||Number(r.product[name])<=0)flags.add(name.toUpperCase()+'_INVALID');
      }
    }
    if(!['approved','processing','shipped','delivered'].includes(order.order_status))unsupported.add('UNSUPPORTED_SOURCE_STATUS');
    if(vendors.size>1)unsupported.add('MULTIPLE_SELLERS');
    return {status:hold.size?'DATA_HOLD':unsupported.size?'UNSUPPORTED':'TASK_CREATED',reasons:[...hold,...unsupported].sort(),flags:[...flags].sort(),quantities,seller:vendors.size===1?[...vendors][0]:null,
      items:lines.map(r=>({sourceItemId:Number(r.order_item_id),productId:r.product_id||null,sellerId:r.seller_id||null,shipByRaw:r.shipping_limit_date||null,category:r.product?.product_category_name||null}))};
  }
  finish(){if(this.db.isTransaction)this.db.exec('COMMIT');}
  disk(){let bytes=0;for(const name of readdirSync(this.directory))bytes+=statSync(join(this.directory,name)).size;return bytes;}
  close(){this.db.close();if(process.env.AUDIT_KEEP_TEMP!=='1')rmSync(this.directory,{recursive:true,force:true});}
}
