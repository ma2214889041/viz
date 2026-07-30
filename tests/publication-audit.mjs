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
  { slug: "braess", method: "可玩论证" },
  { slug: "optimization", method: "可探索论文" },
  { slug: "boltzmann", method: "反事实分屏" },
  { slug: "reaction-diffusion", method: "生成式场景" },
  { slug: "gw150914", method: "声音化" },
  { slug: "kakeya", method: "证明侦探片" }
];

const home = await readFile("index.html", "utf8");
assert.match(home, new RegExp(`共 ${works.length} 篇`), "首页文章计数与实际不符");

// 已删除的文章不应留下任何引用
for (const gone of ["consciousness", "language-game", "methods", "kakeya-boltzmann"]) {
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

console.log(JSON.stringify({ ok: true, works: works.length, report }));
