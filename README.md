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

**Release path:** GitHub Actions builds/tests and deploys main through pinned Wrangler. Native Cloudflare Builds is not connected; do not enable a second deployment owner. Main deployment, rollback to the prior live version, and redeployment from GitHub passed on 2026-09-15 (America/Chicago).

- Existing Worker: `infer-image-optimizer`.
- Repository: `cassthebandit/infer-ghost-solo-image-optimization`, production branch `main`.
- Workflow: `.github/workflows/check.yml`; Node 22, `npm ci`, `npm test`, `npm run check`, then main-only `npm run deploy`.
- `CLOUDFLARE_API_TOKEN` is a GitHub repository secret; `CLOUDFLARE_ACCOUNT_ID` is a repository variable. Never commit tokens. The deployment token uses **Workers Scripts Write**, limited to the hosting account, with no DNS, route, storage, or account-management permissions. This legacy permission can edit other Workers in that account; it is not per-Worker isolation. The newer Individual Workers Editor role was tested but rejected by the version-upload endpoint on 2026-09-15. Reassess that compatibility during hardening.
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

## Verified delivery evidence (2026-09-15)

GitHub [run 35049009783](https://github.com/cassthebandit/infer-ghost-solo-image-optimization/actions/runs/35049009783) deployed commit `39f20ec` as version `e0d2bd15-3ce0-45c2-896f-078f15f1f5f1`. Rollback restored previous version `c4ab28ca-77fd-4723-99d4-1999f138a12f` at 100%. GitHub [run 35049726157](https://github.com/cassthebandit/infer-ghost-solo-image-optimization/actions/runs/35049726157) redeployed the source as `521d814e-9a32-4a9d-bcd8-e1148bf916e7`. Route identities and fail-open settings stayed unchanged.

Public video byte-range checks returned 206 with the requested 1024-byte ranges. Transformed images loaded and video playback/seeking worked in desktop/mobile-width Chromium. Safari/iOS was not separately tested.

The documented [Cloudflare GitHub Actions path](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) is the release owner. The [version-upload endpoint](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/create/) currently requires the compatible Workers Scripts Write token used here.
