"""Stream the four immutable Olist CSVs into a NEW SQLite preparation index.
No source modifications and no whole-file JSON arrays. Existing output is refused.
"""
import argparse, csv, hashlib, json, sqlite3, os
from pathlib import Path
from datetime import datetime, timezone

FILES = {
 'orders': ('olist_orders_dataset.csv', ['order_id','order_status','order_purchase_timestamp','order_approved_at']),
 'items': ('olist_order_items_dataset.csv', ['order_id','order_item_id','product_id','seller_id','shipping_limit_date']),
 'products': ('olist_products_dataset.csv', ['product_id','product_category_name','product_weight_g','product_length_cm','product_height_cm','product_width_cm']),
 'sellers': ('olist_sellers_dataset.csv', ['seller_id'])
}
def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for block in iter(lambda:f.read(1024*1024), b''): h.update(block)
 return h.hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--raw',required=True);p.add_argument('--out',required=True);p.add_argument('--manifest',required=True);p.add_argument('--synthetic',action='store_true');p.add_argument('--downloaded-at');p.add_argument('--verify-source-only',action='store_true');a=p.parse_args()
 raw=Path(a.raw);out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
 if not a.verify_source_only and (out.exists() or Path(a.manifest).exists()): raise SystemExit('Existing output/manifest refused; use a new version path.')
 provenance=json.loads((raw/'download.json').read_text()) if (raw/'download.json').exists() else {}
 downloaded_at=None
 if not a.synthetic:
  downloaded_at=a.downloaded_at or provenance.get('downloadedAt')
  try:
   parsed_time=datetime.fromisoformat(downloaded_at.replace('Z','+00:00'));assert parsed_time.tzinfo is not None
  except (AttributeError,ValueError,AssertionError):raise SystemExit('Record actual downloadedAt with an offset in download.json, or use --downloaded-at. Preparation time is not download time.')
  reference=json.loads(Path('manifests/olist-v2.json').read_text())
  for file in reference['files']:
   source=raw/file['fileName']
   if not source.is_file() or source.stat().st_size!=file['fileBytes'] or digest(source)!=file['fileSha256']:
    raise SystemExit('Actual Olist v2 source hash mismatch; generated/changed input cannot be labeled actual: '+file['fileName'])
 if a.verify_source_only:
  print('Verified source fingerprints; no index or manifest created.');return
 for name,(file,required) in FILES.items():
  with open(raw/file,newline='',encoding='utf-8-sig') as f:
   headers=next(csv.reader(f));assert all(k in headers for k in required),(file,required,headers)
 db=sqlite3.connect(out);db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL')
 db.executescript('''
 CREATE TABLE source_rows(kind TEXT, row_number INTEGER, file_hash TEXT, source_key TEXT, payload TEXT, PRIMARY KEY(kind,row_number));
 CREATE INDEX source_key_idx ON source_rows(kind,source_key);
 CREATE TABLE orders(position INTEGER PRIMARY KEY, source_key TEXT, sort_time TEXT, payload TEXT);
 CREATE TABLE items(order_id TEXT, source_item_id TEXT, product_id TEXT, seller_id TEXT, ship_by TEXT);
 CREATE INDEX items_order ON items(order_id);
 CREATE TABLE products(id TEXT PRIMARY KEY, payload TEXT);
 CREATE TABLE sellers(id TEXT PRIMARY KEY);
 CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
 ''')
 manifest={'datasetVersion':'synthetic-fixture-v1' if a.synthetic else 'olist-v2','synthetic':a.synthetic,
  'downloadedAt':downloaded_at,'preparedAt':datetime.now(timezone.utc).isoformat(),'downloadProvenance':provenance, 'sourceUrl':'generated:test-fixture' if a.synthetic else 'https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce',
  'licenseNotice':'Synthetic fixture; no actual Olist rows' if a.synthetic else 'CC BY-NC-SA 4.0 — Olist / Kaggle; preserve attribution; no raw redistribution in Git', 'files':[]}
 for kind,(file,required) in FILES.items():
  path=raw/file;filehash=digest(path);count=0;keys=set()
  db.execute('BEGIN')
  with open(path,newline='',encoding='utf-8-sig') as f:
   reader=csv.DictReader(f)
   fingerprint=hashlib.sha256(json.dumps(reader.fieldnames,separators=(',',':')).encode()).hexdigest()
   for count,row in enumerate(reader,1):
    sourcekey=row.get({'orders':'order_id','items':'order_id','products':'product_id','sellers':'seller_id'}[kind],'')
    keys.add(sourcekey+':'+row.get('order_item_id','') if kind=='items' else sourcekey);body=json.dumps(row,ensure_ascii=False,separators=(',',':'))
    db.execute('INSERT INTO source_rows VALUES(?,?,?,?,?)',(kind,count,filehash,sourcekey,body))
    if kind=='items': db.execute('INSERT INTO items VALUES(?,?,?,?,?)',tuple(row.get(k,'') for k in ['order_id','order_item_id','product_id','seller_id','shipping_limit_date']))
    elif kind=='products':
     found=db.execute('SELECT payload FROM products WHERE id=?',(sourcekey,)).fetchone()
     if found and found[0]!=body: raise ValueError('Conflicting product master key '+sourcekey)
     db.execute('INSERT OR IGNORE INTO products VALUES(?,?)',(sourcekey,body))
    elif kind=='sellers': db.execute('INSERT OR IGNORE INTO sellers VALUES(?)',(sourcekey,))
    else: db.execute('INSERT INTO orders(source_key,sort_time,payload) VALUES(?,?,?)',(sourcekey or filehash+':'+str(count),row.get('order_approved_at') or row.get('order_purchase_timestamp') or '',body))
  db.commit();manifest['files'].append({'fileName':file,'fileSha256':filehash,'fileBytes':path.stat().st_size,'rowCount':count,'distinctKeyCount':len(keys),'keyDefinition':'order_id+order_item_id' if kind=='items' else required[0],'schemaFingerprint':fingerprint})
  print(kind,count)
 manifest['importConfigHash']=hashlib.sha256(b'csv-stream-v1;row-count-qty;raw-preserved').hexdigest()
 # Source rows remain untouched; order serving uses a stable indexed virtual sort.
 db.execute('CREATE INDEX order_sort ON orders(sort_time,source_key,position)')
 db.execute('CREATE INDEX order_source_key ON orders(source_key)')
 manifest['orphanItemRows']=db.execute("SELECT COUNT(*) FROM items i WHERE NOT EXISTS(SELECT 1 FROM orders o WHERE o.source_key=i.order_id)").fetchone()[0]
 db.execute('INSERT INTO meta VALUES(?,?)',('manifest',json.dumps(manifest)));db.commit()
 db.execute('PRAGMA wal_checkpoint(TRUNCATE)');db.execute('PRAGMA journal_mode=DELETE');db.close()
 Path(a.manifest).parent.mkdir(parents=True,exist_ok=True);Path(a.manifest).write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 print('Prepared',out,'manifest',a.manifest)
if __name__=='__main__': main()
