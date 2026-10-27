import { DatabaseSync } from 'node:sqlite';
import { hash, Problem, pageLimit } from '../shared/contracts.js';
export class Source {
  db: DatabaseSync; manifest:any; scenario:any; scenarioHash:string;
  constructor(path:string, public runId:string, options:any={}) {
    this.db=new DatabaseSync(path,{readOnly:true});
    this.manifest=JSON.parse((this.db.prepare("SELECT value FROM meta WHERE key='manifest'").get() as any).value);
    this.scenario={datasetRunId:runId,simulationClockAnchor:'2026-10-27T00:00:00Z',originalClockInterpretation:'naive virtual clock, not actual UTC',replaySpeed:1000000,orderingRule:'approved||purchased,orderId,row',filterVersion:'v1',adapterVersion:'v1',seed:42,faultPlanHash:hash({}),...options};
    this.scenarioHash=hash({...this.scenario,manifest:this.manifest});
  }
  page(cursor:string|undefined,limitInput:any,scenarioNow=new Date()) {
    const limit=pageLimit(limitInput);let offset=0;
    if(cursor) {
      let value:any;
      try {value=JSON.parse(Buffer.from(cursor,'base64url').toString());} catch {throw new Problem('INVALID_CURSOR',400);}
      if(value.run!==this.runId||value.scenario!==this.scenarioHash||value.limit!==limit) throw new Problem('CURSOR_RUN_MISMATCH');
      if(!Number.isSafeInteger(value.offset)||value.offset<0) throw new Problem('INVALID_CURSOR',400);
      offset=value.offset;
    }
    const rows=this.db.prepare('SELECT * FROM orders ORDER BY sort_time,source_key,position LIMIT ? OFFSET ?').all(limit,offset) as any[];
    const first=this.db.prepare("SELECT sort_time FROM orders WHERE sort_time!='' ORDER BY sort_time LIMIT 1").get() as any;
    const origin=first?Date.parse(first.sort_time.replace(' ','T')+'Z'):0;
    const anchor=Date.parse(this.scenario.simulationClockAnchor);
    const items=rows.map(row=>{
      const raw=JSON.parse(row.payload);
      const t=Date.parse(row.sort_time.replace(' ','T')+'Z');
      const available=anchor+Math.max(0,Number.isFinite(t)?Math.floor((t-origin)/this.scenario.replaySpeed):0);
      const sourceItems=this.db.prepare('SELECT i.*,p.payload FROM items i LEFT JOIN products p ON p.id=i.product_id WHERE i.order_id=? ORDER BY CAST(i.source_item_id AS INTEGER),i.rowid').all(raw.order_id) as any[];
      return {sourceRecordId:row.source_key,sourceOrderId:raw.order_id||null,sourceStatus:raw.order_status||null,sourcePurchasedAtRaw:raw.order_purchase_timestamp||null,sourceApprovedAtRaw:raw.order_approved_at||null,sourceAvailableAt:new Date(available).toISOString(),qualityFlags:[],
        items:sourceItems.map(i=>({sourceItemId:Number(i.source_item_id)||0,productId:i.product_id||null,sellerId:i.seller_id||null,shipByRaw:i.ship_by||null,category:i.payload?JSON.parse(i.payload).product_category_name||null:null}))};
    });
    // Fixed page boundaries ensure every non-empty cursor response is reproducible.
    const latest=items.length?Math.max(...items.map(i=>Date.parse(i.sourceAvailableAt))):0;
    if(latest>scenarioNow.getTime()) return {datasetRunId:this.runId,items:[],nextCursor:cursor||null,exhausted:false,nextPollAfterMs:Math.min(60000,latest-scenarioNow.getTime())};
    const count=Number((this.db.prepare('SELECT COUNT(*) n FROM orders').get() as any).n);
    const exhausted=offset+rows.length>=count;
    return {datasetRunId:this.runId,items,nextCursor:exhausted?null:Buffer.from(JSON.stringify({run:this.runId,scenario:this.scenarioHash,limit,offset:offset+rows.length})).toString('base64url'),exhausted,nextPollAfterMs:0};
  }
  close(){this.db.close();}
}
