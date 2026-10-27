import { Problem } from '../shared/contracts.js';
export function localAuthorize(req:any,expectedOrigin:string) {
  const host=new URL(expectedOrigin).host;
  if(req.headers.host!==host||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw new Problem('LOCAL_HOST_DENIED',403);
  if(req.headers.origin&&req.headers.origin!==expectedOrigin)throw new Problem('LOCAL_ORIGIN_DENIED',403);
  if(req.method!=='GET'&&req.headers.origin!==expectedOrigin)throw new Problem('LOCAL_ORIGIN_REQUIRED',403);
  if(req.headers['sec-fetch-site']==='cross-site')throw new Problem('LOCAL_ORIGIN_DENIED',403);
}
