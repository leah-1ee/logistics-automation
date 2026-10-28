"""Extract exactly the four MVP files, preserving the downloaded archive and refusing overwrite."""
import argparse,zipfile,hashlib,json
from pathlib import Path
from datetime import datetime,timezone
p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('--out',default='data/raw/olist-v2');a=p.parse_args()
archive=Path(a.archive);out=Path(a.out)
names=['olist_orders_dataset.csv','olist_order_items_dataset.csv','olist_products_dataset.csv','olist_sellers_dataset.csv']
with zipfile.ZipFile(archive) as z:
 infos=[z.getinfo(n) for n in names];print('MVP extracted bytes:',sum(i.file_size for i in infos))
 if any(i.file_size>1000000000 for i in infos):raise SystemExit('A file exceeds 1GB; obtain user approval before extraction.')
 out.mkdir(parents=True,exist_ok=True)
 if any((out/n).exists() for n in names):raise SystemExit('Existing raw source refused; use a new version directory.')
 for info in infos:
  with z.open(info) as source,(out/info.filename).open('xb') as target:
   for block in iter(lambda:source.read(1024*1024),b''):target.write(block)
  (out/info.filename).chmod(0o444)
h=hashlib.sha256()
with archive.open('rb') as f:
 for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
(out/'download.json').write_text(json.dumps({'sourceUrl':'https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce','datasetVersion':2,'licenseNotice':'CC BY-NC-SA 4.0','archiveSha256':h.hexdigest(),'archiveBytes':archive.stat().st_size,'fileObservedAt':datetime.now(timezone.utc).isoformat(),'downloadedAt':'USER_MUST_RECORD_ACTUAL_DOWNLOAD_TIME'},indent=2)+'\n')
print('Original archive retained. Do not commit archive or extracted CSVs.')
