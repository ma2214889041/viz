/**
 * VIZ 站点 Worker。
 *
 * 站点是纯静态的：所有交互都在读者的浏览器里运行，没有服务端状态。
 * 这里唯一的职责是让 HTML 导航请求不被缓存，
 * 否则发布新版本后读者可能仍然拿到旧页面（而子资源已经更新）。
 */

interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const isHtmlNavigation =
      request.method === "GET" &&
      (
        url.pathname === "/" ||
        url.pathname.endsWith("/") ||
        request.headers.get("Accept")?.includes("text/html")
      );
    if (!isHtmlNavigation) return env.ASSETS.fetch(request);

    const assetHeaders = new Headers(request.headers);
    assetHeaders.set("Cache-Control", "no-cache");
    const response = await env.ASSETS.fetch(new Request(request, { headers: assetHeaders }));
    if (!response.headers.get("Content-Type")?.includes("text/html")) return response;

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  }
} satisfies ExportedHandler<Env>;
