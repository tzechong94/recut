// Guard for server-side fetches of caller-supplied urls. Two routes fetch urls that originate
// from the client (an input image in /api/generate, an asset's imageUrl in the download route),
// and on ECS an unguarded fetch reaches the instance metadata service at 100.100.100.200, which
// hands out RAM role credentials. Resolve the host first and refuse anything not publicly routable.

import { lookup } from 'node:dns/promises';

/** A caller-supplied url pointed somewhere it must not. `reason` is safe to return to the client. */
export class BlockedUrl extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`refusing to fetch ${url}: ${reason}`);
    this.name = 'BlockedUrl';
  }
}

/** IPv4 space that is not routable on the public internet, including the cloud metadata nets. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT: Alibaba metadata sits at 100.100.100.200
  if (a === 169 && b === 254) return true; // link-local: metadata on most other clouds
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** IPv6 equivalents: loopback, unique-local, link-local, and IPv4-mapped forms. */
function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().split('%')[0] ?? '';
  if (s === '::' || s === '::1') return true;
  if (/^f[cd]/.test(s)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(s)) return true; // fe80::/10 link-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

/**
 * Resolve `raw` and refuse it unless every address it maps to is public.
 * This does not close a determined DNS-rebinding race (fetch resolves again), but it stops the
 * realistic attack: an address literal, or a hostname pointed straight at a private range.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrl(raw, 'not a valid url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrl(raw, `scheme ${url.protocol} is not allowed`);
  }
  const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new BlockedUrl(raw, 'host does not resolve');
  for (const { address, family } of addrs) {
    if (family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address)) {
      throw new BlockedUrl(raw, `resolves to non-public address ${address}`);
    }
  }
  return url;
}

/** fetch() for caller-supplied urls. Redirects are refused so a 302 cannot walk back into the VPC. */
export async function safeFetch(raw: string, init?: RequestInit): Promise<Response> {
  await assertPublicUrl(raw);
  return fetch(raw, { ...init, redirect: 'error' });
}
