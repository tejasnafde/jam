// Edge proxy: jam.tn07.dev -> the jam Cloud Run service.
//
// Cloud Run routes by Host header and 404s on a request that claims to be
// jam.tn07.dev. Cloudflare's free plan cannot override the origin Host, so
// this Worker rewrites the URL (and with it the Host) before forwarding.
// Same pattern as interview-taker/edge.
//
// X-Jam-Edge proves to the server that a request came through this Worker, so
// the server can trust CF-Connecting-IP for its rate limits. Without the
// header (a direct *.run.app request) it keys on the socket address instead.
// The value is the Worker secret JAM_EDGE_SECRET (`npx wrangler secret put
// JAM_EDGE_SECRET`), the same value as Secret Manager JAM_EDGE_SECRET.

const ORIGIN = "jam-974343814740.asia-south1.run.app";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientHost = url.host;
    url.protocol = "https:";
    url.host = ORIGIN;
    url.port = "";

    // Building a Request from the rewritten URL is what sets the outbound Host.
    const proxied = new Request(url, request);
    proxied.headers.set("X-Forwarded-Host", clientHost);
    proxied.headers.set("X-Forwarded-Proto", "https");
    // Never forward a client's own X-Jam-Edge.
    proxied.headers.delete("X-Jam-Edge");
    if (env.JAM_EDGE_SECRET) proxied.headers.set("X-Jam-Edge", env.JAM_EDGE_SECRET);

    const response = await fetch(proxied);

    // Keep redirects on the custom domain.
    const location = response.headers.get("Location");
    if (location) {
      try {
        const target = new URL(location, url);
        if (target.host === ORIGIN) {
          target.host = clientHost;
          const rewritten = new Response(response.body, response);
          rewritten.headers.set("Location", target.toString());
          return rewritten;
        }
      } catch {
        // Not a URL: pass it through.
      }
    }
    return response;
  },
};
