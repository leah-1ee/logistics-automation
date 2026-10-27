import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const contract = parse(readFileSync('docs/openapi.yaml', 'utf8'));
const ajv = new (Ajv2020 as any)({ strict: false, allErrors: true });
(addFormats as any)(ajv);
ajv.addSchema(contract, 'openapi');
export class Problem extends Error {
  constructor(public code: string, public status = 409, public details: Record<string, unknown> = {}) { super(code); }
}
export function validate(name: string, value: unknown): void {
  const check = ajv.getSchema(`openapi#/components/schemas/${name}`);
  if (!check || !check(value)) throw new Problem('INVALID_SCHEMA', 400, { schema: name, errors: check?.errors });
}
export function canonical(value: any): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  throw new Problem('NON_CANONICAL_VALUE', 400);
}
export const hash = (value: any) => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function snapshotHash(snapshot: any): string { const { snapshotHash: _, ...body } = snapshot; return hash(body); }
export type Event = {
  eventId: string; taskId: string; deviceId: string; assignmentVersion: number;
  seq: number; occurredAt: string;
} & ({ type: 'SCAN_ITEM'; payload: { productId: string; quantity: 1 } } |
     { type: 'REVERSE_SCAN'; payload: { targetEventId: string } } | { type: 'COMPLETE'; payload: Record<string, never> });
export const now = () => new Date().toISOString();
export const parseJson = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
export function pageLimit(value: unknown): number {
  const n = value === undefined ? 50 : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 200) throw new Problem('INVALID_LIMIT', 400);
  return n;
}
export function businessDate(time: string, timezone = process.env.BUSINESS_TIMEZONE || 'Asia/Seoul') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
  return ['year','month','day'].map(k => parts.find(p => p.type === k)!.value).join('-');
}
