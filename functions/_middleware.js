// Local-only override: when DISABLE_COMING_SOON is set (via .dev.vars, never
// deployed), serve the archived 3-page site instead of the coming-soon page.
// Production never has this var set, so this is a no-op in prod.

const ROUTES = {
  "/": "/archive/index.html",
  "/index.html": "/archive/index.html",
  "/how-it-works.html": "/archive/how-it-works.html",
  "/contact.html": "/archive/contact.html",
  "/support.js": "/archive/support.js",
};

export async function onRequest(context) {
  const { request, env, next } = context;

  if (env.DISABLE_COMING_SOON !== "true") {
    return next();
  }

  const url = new URL(request.url);
  let targetPath = ROUTES[url.pathname];
  if (!targetPath && url.pathname.startsWith("/uploads/")) {
    targetPath = "/archive" + url.pathname;
  }

  if (!targetPath) {
    return next();
  }

  let assetUrl = new URL(targetPath, url.origin);
  let response = await env.ASSETS.fetch(new Request(assetUrl, request));

  // Pages' clean-URL redirect can fire for .html paths (e.g. /archive/foo.html
  // -> /archive/foo). Follow it internally so the browser keeps showing the
  // original requested URL instead of exposing the /archive/ path.
  let redirects = 0;
  while (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.get("location") &&
    redirects < 3
  ) {
    assetUrl = new URL(response.headers.get("location"), url.origin);
    response = await env.ASSETS.fetch(new Request(assetUrl, request));
    redirects++;
  }

  return response;
}
