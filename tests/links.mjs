/* 外链体检。两篇菲尔兹文章的「资料」页是可信度的落脚点——
   朋友就是照着链接去核对「1/5」那个数的，链挂了整段就白写了。

   注意：不少学术站点（AMS、NYU、知乎、Cloudflare 后面的站）会挡掉裸 curl，
   所以带浏览器 UA 重试一次，只有两次都失败才算真的坏。
   跑法：npm run test:links（默认不进 npm test，避免离线时误报）。 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["boltzmann", "kakeya", "optimization", "reaction-diffusion"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/* 这些站点用 JS/Cookie 挡机器人，人工用真实浏览器确认过可访问 */
const KNOWN_BOT_WALLED = ["zhuanlan.zhihu.com"];

const urls = new Map();
for (const page of pages) {
  const html = await readFile(join(root, page, "index.html"), "utf8");
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    if (!urls.has(m[1])) urls.set(m[1], []);
    urls.get(m[1]).push(page);
  }
}

const probe = async (url, useUA) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, {
      redirect: "follow", signal: ctl.signal,
      headers: useUA ? { "User-Agent": UA, "Accept": "*/*" } : {}
    });
    return r.status;
  } catch (e) {
    return e.name === "AbortError" ? "timeout" : "error";
  } finally { clearTimeout(timer); }
};

const bad = [], walled = [];
const results = [];
for (const [url, where] of urls) {
  let st = await probe(url, false);
  if (st !== 200) st = await probe(url, true);
  const host = new URL(url).host;
  const ok = st === 200;
  const known = KNOWN_BOT_WALLED.some(h => host.endsWith(h));
  results.push({ url, status: st, pages: [...new Set(where)].join(",") });
  if (!ok) (known ? walled : bad).push(`${st}  ${url}  [${[...new Set(where)].join(",")}]`);
}

if (walled.length) console.log("已知反爬（真实浏览器可访问）:\n  " + walled.join("\n  "));
if (bad.length) {
  console.error(JSON.stringify({ ok: false, broken: bad }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checked: results.length, botWalled: walled.length }));
