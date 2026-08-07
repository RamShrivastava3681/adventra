import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

/**
 * Extract the S3 object key from a stored public URL, e.g.
 *   https://adventra.s3.ap-south-1.amazonaws.com/<key>  →  <key>
 * Returns null for anything that isn't an S3 URL (pasted external links,
 * data: URIs, …) so those pass through untouched.
 */
export function s3KeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/amazonaws\.com\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Ask the backend for a short-lived signed download URL for the object. The
// bucket is private, so the stored public URL 403s — this is the only way the
// browser can actually load the image.
async function fetchSignedUrl(key: string): Promise<string | null> {
  const token = localStorage.getItem("auth_token");
  try {
    const res = await fetch(`${API_URL}/upload/${encodeURIComponent(key)}/url`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url ?? data.signedUrl ?? null;
  } catch {
    return null;
  }
}

// The backend signs download URLs for only 60 seconds, but the same image
// appears across the catalogue, inventory and forecast pages — so cache them,
// but treat entries older than the signature lifetime as stale and re-sign
// rather than reusing an expired URL after a route change.
const SIGNED_URL_TTL_MS = 50_000;
const signedUrlCache = new Map<string, { url: string; at: number }>();

function cachedSignedUrl(key: string): string | undefined {
  const entry = signedUrlCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > SIGNED_URL_TTL_MS) {
    signedUrlCache.delete(key);
    return undefined;
  }
  return entry.url;
}

/**
 * Hook: given the stored image URL, return a URL that actually displays —
 * a freshly signed URL for S3 objects, or the original URL for anything else.
 * While a signed URL is being fetched (or if it can't be fetched) the value is
 * undefined so a broken image is never flashed on screen.
 */
export function useSignedImageUrl(raw: string | null | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => {
    if (!raw) return undefined;
    const key = s3KeyFromUrl(raw);
    if (!key) return raw;
    return cachedSignedUrl(key);
  });

  useEffect(() => {
    if (!raw) {
      setUrl(undefined);
      return;
    }
    const key = s3KeyFromUrl(raw);
    if (!key) {
      setUrl(raw);
      return;
    }
    const cached = cachedSignedUrl(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    let alive = true;
    setUrl(undefined);
    fetchSignedUrl(key).then((signed) => {
      if (!alive) return;
      if (signed) signedUrlCache.set(key, { url: signed, at: Date.now() });
      // On failure keep the placeholder (undefined) — falling back to the
      // stored public URL would just render a broken 403 image.
      setUrl(signed ?? undefined);
    });
    return () => {
      alive = false;
    };
  }, [raw]);

  return url;
}
