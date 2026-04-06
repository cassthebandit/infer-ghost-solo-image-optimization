// infer-image-optimizer.js
// Cloudflare Worker for Ghost image optimization via HTMLRewriter + /cdn-cgi/image/ URL format
// Spec: ghost-image-optimization-spec-v3.1.md
// Deploy: Cloudflare Dashboard → Workers & Pages → Create Worker → paste this → Save and Deploy
// Route: infer.blog/* (set in Worker Settings → Triggers → Routes)

// --- Configuration ---
const IMAGE_QUALITY = 80;
const DEFAULT_WIDTH = 1600;
const ABOVE_FOLD_COUNT = 2; // Skip lazy loading for first N images (logo + first featured image)
const CDN_CGI_OPTIONS = `format=auto,quality=${IMAGE_QUALITY},fit=scale-down`;

// --- Helpers ---

/**
 * Strips Ghost's /size/w{N}/ from an image path and returns the width and cleaned path.
 * Ghost pre-resizes images at this path — we want Cloudflare to fetch the original
 * and do the resize itself to avoid lossy-on-lossy double compression.
 * Pattern from: https://github.com/Vortexmind/image-resizing
 *
 * @param {string} imagePath - e.g. "/content/images/size/w600/2026/03/photo.jpg"
 * @returns {{ width: number, path: string }} - e.g. { width: 600, path: "/content/images/2026/03/photo.jpg" }
 */
function stripGhostSize(imagePath) {
  const sizeMatch = imagePath.match(/\/size\/w(\d+)\//);
  if (sizeMatch) {
    const width = parseInt(sizeMatch[1], 10);
    const strippedPath = imagePath.replace(/\/size\/w\d+\//, "/");
    return { width, path: strippedPath };
  }
  return { width: DEFAULT_WIDTH, path: imagePath };
}

/**
 * Extracts the pathname from a URL string. Handles both relative paths and absolute URLs.
 *
 * @param {string} url - e.g. "/content/images/photo.jpg" or "https://infer.blog/content/images/photo.jpg"
 * @returns {string|null} - the pathname, or null if it doesn't contain /content/images/
 */
function extractImagePath(url) {
  if (!url || !url.includes("/content/images/")) {
    return null;
  }
  if (url.startsWith("http")) {
    try {
      return new URL(url).pathname;
    } catch (e) {
      return null;
    }
  }
  return url;
}

/**
 * Builds a /cdn-cgi/image/ URL for a given image path and width.
 * Docs: https://developers.cloudflare.com/images/transform-images/transform-via-url/
 *
 * URL format: /cdn-cgi/image/<OPTIONS>/<SOURCE-IMAGE>
 * The source image path starts with / which serves as the separator.
 * onerror=redirect: if transformation fails, serve original. Only works in URL format, not cf.image.
 *
 * @param {string} imagePath - must start with /
 * @param {number} width
 * @returns {string}
 */
function buildCdnCgiUrl(imagePath, width) {
  return `/cdn-cgi/image/${CDN_CGI_OPTIONS},width=${width},onerror=redirect${imagePath}`;
}

/**
 * Rewrites a srcset string, routing each image entry through /cdn-cgi/image/.
 *
 * @param {string} srcset - e.g. "/content/images/size/w300/photo.jpg 300w, /content/images/size/w600/photo.jpg 600w"
 * @returns {string}
 */
function rewriteSrcset(srcset) {
  return srcset.split(",").map(entry => {
    const trimmed = entry.trim();
    if (!trimmed) return entry;

    const parts = trimmed.split(/\s+/);
    const url = parts[0];
    const descriptor = parts.slice(1).join(" ");

    const imagePath = extractImagePath(url);
    if (!imagePath) return entry;

    // Use width from descriptor (e.g. "300w") if available
    const wMatch = descriptor.match(/(\d+)w/);
    const descriptorWidth = wMatch ? parseInt(wMatch[1], 10) : null;

    // Strip Ghost's /size/w{N}/ and get the original path
    const { width: ghostWidth, path: strippedPath } = stripGhostSize(imagePath);

    // Prefer descriptor width (it's what the browser actually wants), fall back to Ghost's size
    const finalWidth = descriptorWidth || ghostWidth;

    const newUrl = buildCdnCgiUrl(strippedPath, finalWidth);
    return descriptor ? `${newUrl} ${descriptor}` : newUrl;
  }).join(", ");
}

// --- HTMLRewriter Handlers ---

/**
 * Handles <img> elements.
 * Docs: https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/
 *
 * Tracks image count to handle above-the-fold images differently:
 * - First 2 images (logo + first featured) are above the fold and should NOT be lazy loaded.
 *   Lazy loading above-fold images delays LCP. PageSpeed flags this explicitly.
 * - The second image (first content image, typically the LCP element) gets fetchpriority="high"
 *   to tell the browser to prioritize it. PageSpeed recommends this for LCP images.
 * - All subsequent images get loading="lazy".
 */
class ImageHandler {
  constructor() {
    this.imageCount = 0;
  }

  element(element) {
    this.imageCount++;

    // Rewrite src
    const src = element.getAttribute("src");
    const imagePath = extractImagePath(src);

    if (imagePath) {
      const { width, path: strippedPath } = stripGhostSize(imagePath);
      element.setAttribute("src", buildCdnCgiUrl(strippedPath, width));
    }

    // Rewrite srcset if present
    const srcset = element.getAttribute("srcset");
    if (srcset && srcset.includes("/content/images/")) {
      element.setAttribute("srcset", rewriteSrcset(srcset));
    }

    // Above-the-fold images: don't lazy load, prioritize LCP candidate
    if (this.imageCount <= ABOVE_FOLD_COUNT) {
      // Remove lazy loading if Ghost already set it — it hurts LCP
      if (element.getAttribute("loading") === "lazy") {
        element.removeAttribute("loading");
      }
      // Second image is typically the first post featured image (LCP element)
      if (this.imageCount === 2) {
        element.setAttribute("fetchpriority", "high");
      }
    } else {
      // Below-the-fold images: add lazy loading if not already set
      if (!element.getAttribute("loading")) {
        element.setAttribute("loading", "lazy");
      }
    }
  }
}

/**
 * Handles <source> elements inside <picture> tags.
 */
class SourceHandler {
  element(element) {
    const srcset = element.getAttribute("srcset");
    if (srcset && srcset.includes("/content/images/")) {
      element.setAttribute("srcset", rewriteSrcset(srcset));
    }
  }
}

// --- Main Worker ---

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Skip Ghost Admin — must never be modified
    if (url.pathname.startsWith("/ghost/")) {
      return fetch(request);
    }

    // Skip Cloudflare internal paths (includes /cdn-cgi/image/ requests)
    if (url.pathname.startsWith("/cdn-cgi/")) {
      return fetch(request);
    }

    // Skip non-GET requests (POST to API, member auth, etc.)
    if (request.method !== "GET") {
      return fetch(request);
    }

    // Skip media files (video/audio) — pass through without consuming response.
    // Worker processing breaks Safari's byte-range handling for progressive MP4.
    if (url.pathname.startsWith("/content/media/")) {
      return fetch(request);
    }

    // Fetch the response from origin
    const response = await fetch(request);

    // Only rewrite successful HTML responses
    if (!response.ok) {
      return response;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return response;
    }

    // Apply HTMLRewriter to rewrite image URLs in the HTML
    return new HTMLRewriter()
      .on("img", new ImageHandler())
      .on("source", new SourceHandler())
      .transform(response);
  }
};
