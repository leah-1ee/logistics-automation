"""Generate clearly synthetic CSVs; never use as F1/F2 Olist evidence."""
from pathlib import Path
import csv
root=Path('data/fixtures');root.mkdir(parents=True,exist_ok=True)
def write(name,headers,rows):
 p=root/name
 if p.exists(): raise SystemExit('Refusing to replace '+str(p))
 with p.open('w',newline='') as f:
  w=csv.writer(f);w.writerow(headers);w.writerows(rows)
write('olist_products_dataset.csv',['product_id','product_category_name','product_weight_g','product_length_cm','product_height_cm','product_width_cm'],[['a'*32,'synthetic',100,1,2,3],['b'*32,'synthetic',200,2,3,4]])
write('olist_sellers_dataset.csv',['seller_id'],[['d'*32]])
write('olist_orders_dataset.csv',['order_id','order_status','order_purchase_timestamp','order_approved_at'],[[f'{i:032x}','delivered','2017-01-01 10:00:00','2017-01-01 10:05:00'] for i in range(1,11)])
write('olist_order_items_dataset.csv',['order_id','order_item_id','product_id','seller_id','shipping_limit_date'],[[f'{i:032x}',j,'a'*32 if j<3 else 'b'*32,'d'*32,'2017-01-02 00:00:00'] for i in range(1,11) for j in range(1,4)])
print('SYNTHETIC fixture generated; not Olist original data')
