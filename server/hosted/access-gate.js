import { createHash, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = 'gev_access';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

const digest = (value) => createHash('sha256').update(String(value)).digest();

/** Constant-time comparison that does not leak the key's length. */
export function accessKeyMatches(candidate, accessKey) {
  if (!candidate || !accessKey) return false;
  return timingSafeEqual(digest(candidate), digest(accessKey));
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Admit a request that carries the access key, either as `?key=` (which sets
 * a long-lived cookie and redirects to the same URL without it) or as that
 * cookie. Everything else, pages and `/api` alike, gets a 401.
 */
export function createAccessGate(accessKey) {
  if (!accessKey || String(accessKey).length < 16) {
    throw new Error(
      'GEV_ACCESS_KEY must be set to at least 16 characters before the hosted server starts.',
    );
  }
  return (req, res, next) => {
    const url = new URL(req.url || '/', 'http://gev.invalid');
    const queryKey = url.searchParams.get('key');
    if (queryKey !== null) {
      if (!accessKeyMatches(queryKey, accessKey)) return deny(res);
      url.searchParams.delete('key');
      res.writeHead(302, {
        Location: `${url.pathname}${url.search}`,
        'Set-Cookie': `${ACCESS_COOKIE}=${encodeURIComponent(accessKey)}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    if (
      accessKeyMatches(readCookie(req.headers.cookie, ACCESS_COOKIE), accessKey)
    )
      return next();
    return deny(res);
  };
}

function deny(res) {
  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end('Access key required.');
}

/** Vite plugin that installs the gate ahead of every provider middleware. */
export function accessGatePlugin(accessKey) {
  const gate = createAccessGate(accessKey);
  return {
    name: 'gev-access-gate',
    enforce: 'pre',
    configurePreviewServer(server) {
      server.middlewares.use(gate);
    },
  };
}
