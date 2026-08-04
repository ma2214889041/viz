import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
const baseUrl = "https://viz.gopromp.com";
const workDirs = ["optimization", "reaction-diffusion", "kakeya", "boltzmann", "cosmic-web"];
const fixedFiles = [
  "index.html",
  "404.html",
  "_headers",
  "robots.txt",
  "site.webmanifest",
  "article.css",
  "article-shell.js",
  "favicon.png"
];
const extraDirs = [];

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

async function loadWork(dir) {
  const metaPath = join(root, dir, "work.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  const required = ["slug", "title", "description", "date", "category"];
  for (const key of required) {
    if (!meta[key] || (Array.isArray(meta[key]) && meta[key].length === 0)) {
      throw new Error(`${dir}/work.json 缺少 ${key}`);
    }
  }
  if (meta.slug !== dir) throw new Error(`${dir}/work.json 的 slug 必须等于目录名`);
  const html = await readFile(join(root, dir, "index.html"), "utf8");
  if (!html.includes("<title>") || !html.includes('name="description"')) {
    throw new Error(`${dir}/index.html 缺少标题或描述`);
  }
  return { ...meta, url: `${baseUrl}/${dir}/` };
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of fixedFiles) {
  await cp(join(root, file), join(out, file));
}

const works = [];
for (const dir of workDirs) {
  works.push(await loadWork(dir));
  await cp(join(root, dir), join(out, dir), { recursive: true });
}
for (const dir of extraDirs) {
  await cp(join(root, dir), join(out, dir), { recursive: true });
}

/* ── 共享资源的缓存版本号 ──────────────────────────────────
   article.css / article-shell.js 由 _headers 设成 max-age=3600，
   靠 ?v= 破缓存。这个号以前是手写在 HTML 里的，改了文件却忘了改号，
   回访的读者就会在一小时内继续吃旧的 CSS 和 JS —— 这已经坑过一次，
   而且很难发现：本地一切正常，线上样式却是旧的。
   现在按文件内容算哈希，改了必然变，忘不掉。 */
const assetHash = async (...files) => {
  const h = createHash("sha256");
  for (const f of files) h.update(await readFile(join(root, f)));
  return h.digest("hex").slice(0, 12);
};
const stamp = await assetHash("article.css", "article-shell.js");
let stamped = 0;
for (const dir of [...workDirs, ...extraDirs]) {
  const file = join(out, dir, "index.html");
  let html;
  try { html = await readFile(file, "utf8"); } catch { continue; }
  const next = html.replace(/(article\.css|article-shell\.js)\?v=[^"']*/g, `$1?v=${stamp}`);
  if (next !== html) { await writeFile(file, next); stamped++; }
}
if (!stamped) throw new Error("没有一个页面被打上缓存版本号 —— ?v= 的写法可能变了");

works.sort((a, b) => b.date.localeCompare(a.date));
await writeFile(join(out, "works.json"), `${JSON.stringify(works, null, 2)}\n`);

const sitemapUrls = [
  { loc: `${baseUrl}/`, lastmod: works[0]?.date },
  ...works.map(({ url, date }) => ({ loc: url, lastmod: date }))
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map(({ loc, lastmod }) => `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`)
  .join("\n")}
</urlset>
`;
await writeFile(join(out, "sitemap.xml"), sitemap);

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>VIZ 最新文章</title>
    <link>${baseUrl}/</link>
    <description>用交互式文章解释数学、科学与思想中的复杂问题。</description>
    <language>zh-CN</language>
${works
  .map(
    (work) => `    <item>
      <title>${escapeXml(work.question || work.title)}</title>
      <link>${escapeXml(work.url)}</link>
      <guid isPermaLink="true">${escapeXml(work.url)}</guid>
      <pubDate>${new Date(`${work.date}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeXml(work.description)}</description>
    </item>`
  )
  .join("\n")}
  </channel>
</rss>
`;
await writeFile(join(out, "feed.xml"), rss);

const built = await readdir(out);
console.log(`VIZ build complete [assets v=${stamp}, ${stamped} pages]: ${works.length} works, ${built.length} top-level entries`);
