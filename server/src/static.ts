// Tiny static file server for the built UI. "/" is index.html, anything
// else must be a real file under the root. No SPA fallback needed.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// vite hashes everything under /assets, so those can be cached forever
function cacheControl(urlPath: string): string {
  return urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

export type StaticHandler = (urlPath: string, method: string, res: ServerResponse) => Promise<void>;

export function createStaticHandler(root: string): StaticHandler {
  const base = path.resolve(root);

  return async (urlPath, method, res) => {
    let relative: string;
    try {
      relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).slice(1);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }

    // resolve() collapses "..", so a prefix check is enough against traversal
    const file = path.resolve(base, relative);
    const inside = file === base || file.startsWith(base + path.sep);
    const info = inside ? await stat(file).catch(() => undefined) : undefined;
    if (!info?.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }

    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': cacheControl(urlPath),
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}
