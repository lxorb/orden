import { blogRoots, origins } from '../hosts'
import type { Env, Space } from '../types'

export const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

export const DOMAIN_LIMIT = 253

const RESERVED = new Set([
  'www',
  'mail',
  'smtp',
  'imap',
  'pop',
  'pop3',
  'webmail',
  'mx',
  'ns',
  'ns1',
  'ns2',
  'ns3',
  'ns4',
  'dns',
  'cname',
  'localhost',
  'local',

  'autoconfig',
  'autodiscover',
  'mta-sts',
  'dmarc',
  'dkim',
  'spf',
  'wpad',
  'isatap',

  'about',
  'account',
  'accounts',
  'admin',
  'api',
  'app',
  'apps',
  'assets',
  'auth',
  'billing',
  'blog',
  'cdn',
  'changelog',
  'checkout',
  'cloud',
  'connect',
  'dashboard',
  'demo',
  'dev',
  'developer',
  'developers',
  'doc',
  'docs',
  'download',
  'downloads',
  'edge',
  'even',
  'files',
  'forum',
  'git',
  'help',
  'id',
  'img',
  'images',
  'internal',
  'legal',
  'license',
  'login',
  'logout',
  'manage',
  'mcp',
  'media',
  'nib',
  'nibeditor',
  'oauth',
  'ops',
  'orden',
  'pay',
  'payment',
  'payments',
  'plugin',
  'plugins',
  'portal',
  'preview',
  'pricing',
  'privacy',
  'private',
  'public',
  'register',
  'release',
  'releases',
  'rooms',
  'secure',
  'session',
  'settings',
  'shop',
  'signin',
  'signup',
  'sso',
  'staging',
  'static',
  'status',
  'store',
  'support',
  'sync',
  'terms',
  'test',
  'update',
  'updates',
  'upgrade',
  'vpn',
  'ws',

  'abuse',
  'hostmaster',
  'info',
  'marketing',
  'news',
  'noc',
  'postmaster',
  'sales',
  'security',
  'usenet',
  'uucp',
  'webmaster',
  'ftp',
  'sftp',
])

export function reserved(env: Env, subdomain: string): boolean {
  return RESERVED.has(subdomain) || subdomain === env.BLOG_CNAME_TARGET.split('.')[0]
}

export function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
}

export function looksLikeDomain(domain: string): boolean {
  return domain.length <= DOMAIN_LIMIT && DOMAIN.test(domain)
}

export function ours(env: Env, domain: string): boolean {
  const roots = [...blogRoots(env), ...origins(env).map((origin) => new URL(origin).hostname)]
  return roots.some((root) => domain === root || domain.endsWith(`.${root}`))
}

function proofName(domain: string): string {
  return `_orden-verify.${domain}`
}

export function proofNames(domain: string): string[] {
  return [proofName(domain), `_nib-verify.${domain}`]
}

export function dnsRecords(
  env: Env,
  space: Space,
): { type: string; name: string; value: string; note?: string }[] {
  if (!space.blog_domain) return []

  const apex = space.blog_domain.split('.').length === 2
  return [
    {
      type: 'CNAME',
      name: space.blog_domain,
      value: env.BLOG_CNAME_TARGET,
      ...(apex
        ? {
            note: 'At the root of a domain, use an ALIAS or ANAME record, or CNAME flattening, if your provider does not allow a CNAME there.',
          }
        : {}),
    },
    ...(space.blog_domain_token
      ? [
          {
            type: 'TXT',
            name: proofName(space.blog_domain),
            value: space.blog_domain_token,
          },
        ]
      : []),
  ]
}
