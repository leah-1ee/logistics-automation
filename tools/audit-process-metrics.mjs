// Loaded before the auditor and TS loader. Measures this Node process, not MySQL/services.
import {writeFileSync} from 'node:fs';
import {getHeapStatistics} from 'node:v8';
const started=performance.now();
process.once('exit',code=>{
  if(process.env.AUDIT_PROCESS_METRICS)writeFileSync(process.env.AUDIT_PROCESS_METRICS,JSON.stringify({
    exitCode:code,nodeElapsedSeconds:(performance.now()-started)/1000,
    peakRssBytes:process.resourceUsage().maxRSS*1024,
    heapSizeLimitBytes:getHeapStatistics().heap_size_limit,
    scope:'Linux Node process lifetime including module/TS loading; excludes MySQL, other services and parent sampler'
  })+'\n');
});
