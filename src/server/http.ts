import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Problem, contract, validate } from '../shared/contracts.js';
import { adminAuth } from './auth.js';

@Module({})
class ApiModule {}
const express = createRequire(import.meta.url)('express');
export type Handler = (req: any, params: Record<string,string>) => Promise<any>;
export async function httpApp(prefix: string, handlers: Record<string,Handler>, authorize?: (req:any,security:any)=>Promise<void>) {
  const app = await NestFactory.create(ApiModule, { bodyParser: false, logger: ['error','warn'] });
  app.enableShutdownHooks();
  app.use(express.json({limit:'256kb',strict:true}));
  const routes = Object.entries(contract.paths).filter(([p])=>p.startsWith(prefix)).flatMap(([path,methods]:any) => Object.entries(methods).map(([method,op]:any)=>({
    path, method:method.toUpperCase(), op, names:[...path.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]),
    regex:new RegExp('^'+path.replace(/\{[^}]+\}/g,'([^/]+)')+'$')
  })));
  app.use(async (req:any,res:any,next:any)=>{
    if (!req.path.startsWith(prefix)) return next();
    const requestId = randomUUID();
    try {
      const route = routes.find(r=>r.method===req.method && r.regex.test(req.path));
      if (!route || !handlers[route.op.operationId]) throw new Problem('NOT_FOUND',404);
      if (authorize) await authorize(req,route.op.security || []);
      else if (route.op.security?.some((s:any)=>s.adminAuth)) req.actorId=adminAuth(req.headers.authorization);
      const values = route.regex.exec(req.path)!.slice(1);
      const params = Object.fromEntries(route.names.map((k:string,i:number)=>[k,values[i]]));
      for (const p of route.op.parameters || []) {
        const value = p.in==='path'?params[p.name]:req.query[p.name];
        if (value===undefined && p.required) throw new Problem('MISSING_PARAMETER',400,{field:p.name});
        if (value!==undefined) {
          if (typeof value!=='string') throw new Problem('INVALID_PARAMETER',400,{field:p.name});
          const schema=p.schema;
          if (schema.format==='uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Problem('INVALID_UUID',400);
          if (schema.enum && !schema.enum.includes(value)) throw new Problem('INVALID_FILTER',400);
          if (schema.type==='integer' && (!/^\d+$/.test(value) || +value<schema.minimum || +value>schema.maximum)) throw new Problem('INVALID_LIMIT',400);
          if (schema.format==='date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)) throw new Problem('INVALID_DATE',400);
        }
      }
      const input=route.op.requestBody?.content?.['application/json']?.schema?.$ref?.split('/').pop();
      if(input) validate(input,req.body);
      const result = await handlers[route.op.operationId](req,params);
      if (result?.$http) { res.status(result.status).json(result.body); return; }
      const success = Object.keys(route.op.responses).find(k=>/^2/.test(k))!;
      const output=route.op.responses[success].content;
      if (output?.['text/csv']) { res.type('text/csv; charset=utf-8').send(result); return; }
      const schema=output?.['application/json']?.schema?.$ref?.split('/').pop();
      if(schema) validate(schema,result);
      res.status(Number(success)).json(result);
    } catch(e:any) {
      const known=e instanceof Problem;
      if(!known) console.error('Request failed',requestId,e.code || e.message);
      res.status(known?e.status:503).json({code:known?e.code:'TEMPORARY_UNAVAILABLE',message:known?e.message:'Service temporarily unavailable',requestId,...(known?{details:e.details}:{})});
    }
  });
  app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status===413?413:400).json({code:err.status===413?'BODY_TOO_LARGE':'INVALID_JSON',message:'Invalid request body',requestId:randomUUID()}));
  return app;
}
