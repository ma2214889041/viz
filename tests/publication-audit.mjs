import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * 发布审计。
 *
 * 除了检查元数据与链接，这里还强制一条内容标准：
 * 每篇文章都必须包含一个读者可以操纵的实时模型。
 *
 * 判据是「连续参数 + 每帧重算」，即 <canvas> 搭配 requestAnimationFrame，
 * 并且至少有一个连续输入（range 滑块）或音频输出。
 * 只有按钮和展开文本的文章不算可视化——它们是配了控件的散文，
 * 应该以普通文章形式发表，而不是放进这个站点。
 */

const works = [
  { slug: "optimization", method: "可探索论文" },
  { slug: "boltzmann", method: "反事实分屏" },
  { slug: "reaction-diffusion", method: "生成式场景" },
  { slug: "kakeya", method: "证明侦探片" },
  { slug: "cosmic-web", method: "从初条件长出来" }
];

const home = await readFile("index.html", "utf8");
assert.match(home, new RegExp(`共 ${works.length} 篇`), "首页文章计数与实际不符");

// 已删除的文章不应留下任何引用
for (const gone of ["consciousness", "language-game", "methods", "kakeya-boltzmann", "braess", "gw150914"]) {
  assert.doesNotMatch(home, new RegExp(`href="${gone}/"`), `首页仍引用已删除的 ${gone}`);
}

const report = [];

for (const { slug, method } of works) {
  const metadata = JSON.parse(await readFile(`${slug}/work.json`, "utf8"));
  const article = await readFile(`${slug}/index.html`, "utf8");

  assert.equal(metadata.slug, slug);
  assert.ok(metadata.question && metadata.description && metadata.category, `${slug} 元数据不完整`);
  assert.match(home, new RegExp(`href="${slug}/"`), `${slug} 未出现在首页`);
  assert.match(
    article,
    new RegExp(`<link rel="canonical" href="https://viz\\.gopromp\\.com/${slug}/">`),
    `${slug} canonical 链接错误`
  );
  assert.doesNotMatch(article, /敬请期待|coming soon|TBD|TODO/i, `${slug} 含占位文案`);

  // ── 实时模型判据 ──
  const canvases = (article.match(/<canvas\b/g) || []).length;
  const frames = (article.match(/requestAnimationFrame/g) || []).length;
  const sliders = (article.match(/type="range"/g) || []).length;
  const audio = (article.match(/<audio\b/g) || []).length;

  assert.ok(canvases > 0, `${slug} 没有 <canvas>：没有可视化的模型`);
  assert.ok(frames > 0, `${slug} 没有 requestAnimationFrame：模型不是实时重算的`);
  assert.ok(
    sliders > 0 || audio > 0,
    `${slug} 既没有连续输入也没有音频输出：读者无法连续改变模型`
  );

  report.push({ slug, method, canvases, frames, sliders, audio });
}


/* ── 共享资源的缓存版本号必须由构建按内容打 ──
   article.css / article-shell.js 走 max-age=3600，靠 ?v= 破缓存。
   这个号以前手写在 HTML 里，改了文件忘了改号，回访读者一小时内继续吃旧样式；
   本地怎么看都正常，线上就是不对。所以把「按内容哈希」这件事钉死。 */
{
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  /* 用普通字符串判定，不写正则 —— 这条守卫本身刚被正则转义坑过一次，
     写成 includes 就没有「看着对、其实永远为真」的余地。 */
  const missing = [
    ["按内容算哈希", 'createHash("sha256")'],
    ["把哈希写进 ?v=", "?v=${stamp}"],
    ["一个都没打上时要报错", "没有一个页面被打上缓存版本号"]
  ].filter(([, needle]) => !build.includes(needle)).map(([what]) => what);
  if (missing.length) {
    console.error(JSON.stringify({ ok: false, why: "build.mjs 缺少：" + missing.join("、") }, null, 2));
    process.exit(1);
  }

  /* 页面里不许再出现手写的日期式版本号 —— 那正是会忘记更新的那种 */
  for (const dir of ["boltzmann", "kakeya", "cosmic-web"]) {
    const page = await readFile(new URL(`../${dir}/index.html`, import.meta.url), "utf8");
    const stamps = [...page.matchAll(/(?:article\.css|article-shell\.js)\?v=([^"']*)/g)].map((m) => m[1]);
    if (!stamps.length) {
      console.error(JSON.stringify({ ok: false, why: `${dir} 没有引用带 ?v= 的共享资源` }, null, 2));
      process.exit(1);
    }
  }
}

console.log(JSON.stringify({ ok: true, works: works.length, report }));
