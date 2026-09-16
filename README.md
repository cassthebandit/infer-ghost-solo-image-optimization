# ghostv5-image-optimizer

Cloudflare Worker for automatic image optimization on self-hosted Ghost blogs.  
Independent of the theme. Source-controlled Worker deployment. Usage is subject to your Cloudflare plan.

**Blog post:** [211 Lines at the Edge: Optimizing Ghost Images for Free](https://infer.blog/bringing-image-optimization-to-ghost-v5-solo/)

---

## What It Does

A Cloudflare Worker that rewrites `<img>` URLs in Ghost's HTML to route through Cloudflare's [`/cdn-cgi/image/`](https://developers.cloudflare.com/images/transform-images/transform-via-url/) transformation endpoint. The theme stays untouched. Ghost doesn't know it's happening.

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
├── infer-image-optimizer.js     ← Worker source
├── wrangler.jsonc               ← Worker runtime configuration
├── package-lock.json            ← Pinned deployment dependencies
└── test/                        ← Request-preservation and image URL checks
```

## Configuration

Three constants at the top of the Worker:

| Constant | Default | What it controls |
|----------|---------|-----------------|
| `IMAGE_QUALITY` | `80` | Compression quality (1–100) |
| `DEFAULT_WIDTH` | `1600` | Max width when no size hint exists |
| `ABOVE_FOLD_COUNT` | `2` | Number of images that skip lazy loading |

## Production deployment

Production source baseline was reconciled with the live Worker on 2026-09-15. In particular, media requests pass through unchanged, preserving origin byte-range handling. The earlier repository version removed an encoding header; that was not the deployed behavior.

**Release path:** GitHub Actions builds/tests and deploys main through pinned Wrangler. Native Cloudflare Builds is not connected; do not enable a second deployment owner. Deployment activation and live proof are being completed in the 2026-09-15 cutover.

- Existing Worker: `infer-image-optimizer`.
- Repository: `cassthebandit/infer-ghost-solo-image-optimization`, production branch `main`.
- Workflow: `.github/workflows/check.yml`; Node 22, `npm ci`, `npm test`, `npm run check`, then main-only `npm run deploy`.
- `CLOUDFLARE_API_TOKEN` is a GitHub repository secret; `CLOUDFLARE_ACCOUNT_ID` is a repository variable. Never commit tokens.
- Pull requests test without deployment credentials. Push watch paths cover source, Wrangler config, package files, tests and the workflow. Documentation-only pushes do not deploy.
- Deployment messages record the Git commit. A manual workflow dispatch on main can redeploy the current source.

Local checks use Node 22 or later:

```sh
npm ci
npm test
npm run check
```

The six focused tests check request/range preservation and image URL construction. Wrangler dry-run checks packaging. Neither substitutes for real Cloudflare execution and browser testing.

### Routes and external configuration

Cloudflare owns the existing zone route `infer.blog/*`, fail-open. Routes are deliberately omitted from Wrangler so code deployment does not replace the dashboard-owned route set or its fail-open behavior. Image Transformations must remain enabled separately. The historical `dev.infer.blog/*` Worker route remains recorded in Cloudflare but does not establish a working staging site.

Runtime compatibility date stays `2026-03-21`; existing Workers subdomain remains enabled and preview URLs disabled. No runtime secrets or bindings are required. This code deployment does not change DNS, tunnel, Ghost, database or media storage.

### Verify and roll back

After a main change, inspect the GitHub Worker run and Cloudflare version message tied to that exact commit. Check public homepage/post HTML contains `/cdn-cgi/image/` URLs, transformed images load, Ghost Admin remains untouched, and a real video Range request returns 206 with the expected `Content-Range`. Play and seek the video in a browser.

For rollback, use Cloudflare's previous deployment, then revert the faulty Git change before the next release. Retain the last known-good version ID. Do not change routes or restore Ghost data to roll back this Worker.

## Why Not `cf.image`?

The initial spec used Cloudflare's `cf.image` Worker API. Reading the docs revealed three issues:

1. `format: "auto"` [doesn't work in Workers](https://developers.cloudflare.com/images/transform-images/transform-via-workers/#format) without manually parsing the Accept header
2. `onerror=redirect` [isn't supported in Workers](https://developers.cloudflare.com/images/transform-images/transform-via-workers/#onerror)
3. Cloudflare [warns against `cf.image` on zone-wide routes](https://developers.cloudflare.com/images/transform-images/transform-via-workers/#configure-a-worker)

The `/cdn-cgi/image/` URL format avoids all three. The Worker only rewrites HTML. Cloudflare's built-in handler does the image processing.

## Cost

Worker and image transformation usage have plan limits. Check your Cloudflare account's current usage and pricing; do not treat the historical free-tier estimate as a guarantee.

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
