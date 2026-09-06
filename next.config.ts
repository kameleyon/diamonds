import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * The Content-Security-Policy is set per-request in `middleware.ts` because it
 * carries a nonce, which must be unique per response. Everything here is
 * static and safe to send on every route.
 */
const securityHeaders = [
  // Never let a browser guess a content type; MIME sniffing turns an uploaded
  // text file into executable script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking. `frame-ancestors` in the CSP is the modern control and is
  // set in middleware; this covers browsers that only honour the old header.
  { key: "X-Frame-Options", value: "DENY" },
  // Do not leak the full URL (which can carry query parameters) to other sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This app needs none of these; denying them shrinks the attack surface if
  // any third-party script ever runs.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Force HTTPS for two years once seen over TLS. Harmless on localhost, which
  // browsers exempt.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Do not advertise the framework and version to anyone fingerprinting.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
