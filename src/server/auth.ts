import { timingSafeEqual } from 'node:crypto';
import { Problem, sha256 } from '../shared/contracts.js';
export function tokenMatches(value: string, expected: string) {
  return timingSafeEqual(Buffer.from(sha256(value)), Buffer.from(sha256(expected)));
}
export function requireSecrets() {
  for (const key of ['ADMIN_TOKEN', 'DEVICE_TOKEN', 'MYSQL_PASSWORD'])
    if ((process.env[key] || '').length < 32) throw new Error(`${key} must contain at least 32 characters`);
  if (process.env.ADMIN_TOKEN === process.env.DEVICE_TOKEN) throw new Error('Admin and device tokens must differ');
}
export function adminAuth(header: string | undefined) {
  if (!header?.startsWith('Bearer ')) throw new Problem('UNAUTHORIZED', 401);
  if (!tokenMatches(header.slice(7), process.env.ADMIN_TOKEN || '')) throw new Problem('FORBIDDEN', 403);
  return 'operator-01';
}
