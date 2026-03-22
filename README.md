# ghostv5-image-optimizer

Cloudflare Worker for automatic image optimization on self-hosted Ghost blogs.  
No theme fork. No build step. No cost.

**Blog post:** [211 Lines at the Edge: Optimizing Ghost Images for Free](https://infer.blog/ghost-solo-image-optimization/)

---

## What It Does

A 211-line Cloudflare Worker that rewrites `<img>` URLs in Ghost's HTML to route through Cloudflare's [`/cdn-cgi/image/`](https://developers.cloudflare.com/images/transform-images/transform-via-url/) transformation endpoint. The theme stays untouched. Ghost doesn't know it's happening.

- **Format conversion** — WebP or AVIF via `format=auto`, based on browser support
- **Quality optimization** — Compresses to quality 80 (configurable)
- **Width capping** — Respects Ghost's `/size/w{N}/` path, defaults to 1600px
- **Ghost `/size/` stripping** — Fetches the original to avoid lossy-on-lossy double compression
- **Srcset rewriting** — Rewrites every entry in `srcset`, not just `src`
- **LCP optimization** — First 2 images skip lazy loading; image 2 gets `fetchpriority="high"`
- **Graceful fallback** — `onerror=redirect` serves the original if transformation fails

## Files

```
ghostv5-image-optimizer/
├── README.md                    ← This file
├── LICENSE                      ← MIT
└── infer-image-optimizer.js     ← The Worker (paste into Cloudflare dashboard)
```

## Configuration

Three constants at the top of the Worker:

| Constant | Default | What it controls |
|----------|---------|-----------------|
| `IMAGE_QUALITY` | `80` | Compression quality (1–100) |
| `DEFAULT_WIDTH` | `1600` | Max width when no size hint exists |
| `ABOVE_FOLD_COUNT` | `2` | Number of images that skip lazy loading |

## Quick Start

1. **Enable Image Transformations** — Cloudflare Dashboard → your zone → Images → Transformations → Enable
2. **Create the Worker** — Workers & Pages → Create → Create Worker → paste `infer-image-optimizer.js` → Save and Deploy
3. **Add the route** — Worker Settings → Triggers → Routes → `yourdomain.com/*` with Fail Open
4. **Purge cache** — Caching → Purge Everything (one-time)
5. **Verify** — DevTools → Network → images should show `/cdn-cgi/image/` URLs and `avif`/`webp` content types

## Why Not `cf.image`?

The initial spec used Cloudflare's `cf.image` Worker API. Reading the docs revealed three issues:

1. `format: "auto"` [doesn't work in Workers](https://developers.cloudflare.com/images/transform-images/transform-via-workers/#format) without manually parsing the Accept header
2. `onerror=redirect` [isn't supported in Workers](https://developers.cloudflare.com/images/transform-images/transform-via-workers/#onerror)
3. Cloudflare [warns against `cf.image` on zone-wide routes](https://developers.cloudflare.com/images/transform-images/transform-via-workers/#configure-a-worker)

The `/cdn-cgi/image/` URL format avoids all three. The Worker only rewrites HTML. Cloudflare's built-in handler does the image processing.

## Cost

$0. Cloudflare Workers (100K requests/day) and Image Transformations (5,000 unique transformations/month) both stay within free tier limits for any personal blog.

## What It Doesn't Optimize

- **Direct image requests** — RSS, social crawlers, direct links bypass HTMLRewriter. Social platforms re-encode anyway.
- **Ghost Admin** — `/ghost/*` is explicitly skipped.
- **Email images** — Ghost sends absolute URLs in newsletters. Email clients fetch directly.
- **Ghost's Portal + Sodo Search JS** — 483 KiB from JSDelivr on every page. That's Ghost's architecture, not an image issue.

## Credits

Built by [Daniel Soteldo](https://infer.blog) with Opus (Claude). Daniel directed architecture, debugging strategy, and verification. Opus wrote the code and research.

## References

- [Cathy Sarisky — Fixing Solo](https://www.spectralwebservices.com/blog/fixing-solo/) — srcset analysis that identified the root cause
- [Stanislas Music — HTMLRewriter for Ghost](https://stanislas.blog/2020/05/native-image-lazy-loading-ghost-cloudflare-worker/) — confirmed the HTMLRewriter-on-full-domain pattern
- [Vortexmind — Ghost image Worker](https://github.com/Vortexmind/image-resizing) — Ghost-specific `/size/w{N}/` handling
- [Cloudflare Transform via URL](https://developers.cloudflare.com/images/transform-images/transform-via-url/)
- [Cloudflare HTMLRewriter API](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)
- [Cloudflare Images pricing](https://developers.cloudflare.com/images/pricing/)
