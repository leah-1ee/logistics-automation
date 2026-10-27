const key = /^[a-f0-9]{32}$/;
const rawTime = (v: unknown) => typeof v==='string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) && Number.isFinite(Date.parse(v.replace(' ','T')+'Z'));
export function normalize(source: any, products: Set<string>, sellers: Set<string>) {
  const errors = new Set<string>(), unsupported = new Set<string>(), flags = new Set<string>(source.qualityFlags || []);
  if(!key.test(source.sourceOrderId || '')) errors.add('INVALID_ORDER_KEY');
  if(!source.sourceStatus) errors.add('MISSING_SOURCE_STATUS');
  if(!rawTime(source.sourceApprovedAtRaw)) errors.add('MISSING_OR_INVALID_APPROVAL');
  if(!source.items.length) errors.add('NO_ITEMS');
  const counts = new Map<string,number>(), sellerIds = new Set<string>(), itemIds = new Set<number>();
  for(const item of source.items) {
    if(!Number.isInteger(item.sourceItemId)||item.sourceItemId<1||itemIds.has(item.sourceItemId)) errors.add('INVALID_ITEM_KEY');
    itemIds.add(item.sourceItemId);
    if(!key.test(item.productId || '')||!products.has(item.productId)) errors.add('MISSING_PRODUCT');
    else counts.set(item.productId,(counts.get(item.productId)||0)+1);
    if(!item.sellerId || !sellers.has(item.sellerId)) errors.add('MISSING_SELLER');
    else sellerIds.add(item.sellerId);
    if(!item.category) flags.add('MISSING_CATEGORY');
  }
  if(!['approved','processing','shipped','delivered'].includes(source.sourceStatus)) unsupported.add('UNSUPPORTED_SOURCE_STATUS');
  if(sellerIds.size>1) unsupported.add('MULTIPLE_SELLERS');
  const holdReasons=[...errors,...unsupported].sort();
  return {status:errors.size?'DATA_HOLD':unsupported.size?'UNSUPPORTED':'READY',
    holdReasons,qualityFlags:[...flags].sort(),sellerId:sellerIds.size===1?[...sellerIds][0]:null,
    items:[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([productId,requiredQty])=>({productId,requiredQty,displayLabel:productId.slice(0,8)}))};
}
