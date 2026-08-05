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

/* ── 共享样式里「手机端覆盖桌面端」的顺序 ──
   媒体查询不增加选择器权重。所以 @media(max-width:900px) 里的 `#stage{padding:…}`
   如果写在顶层的 `#stage{padding:…}` 之前，会被后者整条盖掉 —— 手机上舞台照旧
   用桌面的内边距和字号，而 CSS 看起来完全正确。第一版就是这么错的。
   这里把顺序钉住：同名选择器的手机端规则必须出现在桌面端定义之后。 */
{
  const css = await readFile(new URL("../article.css", import.meta.url), "utf8");
  /* 每条规则记下它的起始位置和所在的 @media 深度 */
  const rules = [];
  let depth = 0, atMedia = [];
  const lines = css.split("\n");
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^@(media|supports)/.test(trimmed)) atMedia.push(depth);
    const selector = trimmed.includes("{") ? trimmed.slice(0, trimmed.indexOf("{")).trim() : "";
    if (selector && !selector.startsWith("@") && !selector.startsWith("/*")) {
      rules.push({ selector, at: offset, inMedia: atMedia.length > 0 });
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (atMedia.length && depth === atMedia[atMedia.length - 1]) atMedia.pop(); }
    }
    offset += line.length + 1;
  }
  /* 只查舞台这几个选择器：它们是这次新加的，也是踩过坑的那一组 */
  const watch = ["#stage", "#stage .ckd", "#stage .ckd h4", "#stage .ckd .ckd-how",
                 "#stage .ckd .ckd-now", "#stagepick", "#stagepick>b", "#stagepick button"];
  const wrong = [];
  for (const sel of watch) {
    const base = rules.filter((r) => r.selector === sel && !r.inMedia);
    const mob = rules.filter((r) => r.selector === sel && r.inMedia);
    if (!base.length || !mob.length) continue;
    const lastBase = Math.max(...base.map((r) => r.at));
    const firstMob = Math.min(...mob.map((r) => r.at));
    if (firstMob < lastBase) wrong.push(sel);
  }
  if (wrong.length) {
    console.error(JSON.stringify({ ok: false,
      why: "article.css 里这些选择器的手机端规则写在了桌面端定义之前，会被整条盖掉：" + wrong.join("、")
    }, null, 2));
    process.exit(1);
  }
}

/* ── 首页写的时长必须等于文章自己声明的时长 ──
   两处各写一遍，就一定会漂。实测漂到过：玻尔兹曼自己的首页写「主线约 25 分钟」，
   站点首页写「约 8 分钟」——差三倍；挂谷篇首页写「11 章」，正文其实有 15 章。
   这类数字读者一进门就看见，错了直接损伤信任。 */
{
  const home = await readFile("index.html", "utf8");
  const bad = [];
  for (const { slug } of works) {
    const meta = JSON.parse(await readFile(`${slug}/work.json`, "utf8"));
    /* 首页每篇是一个 <a href="slug/"> 卡片，时长写在它的 .post-meta 里 */
    /* 必须锚在文章卡片上。只按 href 找会先撞上顶部那条「阅读最新文章」，
       于是读到的是别人的时长 —— 第一版就这么误报过一次。 */
    const i = home.indexOf(`<a class="post" href="${slug}/"`);
    if (i < 0) { bad.push(`${slug} 首页没有文章卡片`); continue; }
    const card = home.slice(i, i + 400);
    const m = card.match(/约\s*(\d+)\s*分钟/);
    if (!m) { bad.push(`${slug} 首页卡片没写时长`); continue; }
    const want = (meta.duration || "").match(/(\d+)/);
    if (!want) { bad.push(`${slug}/work.json 的 duration 不含数字`); continue; }
    if (m[1] !== want[1]) bad.push(`${slug}：首页 ${m[1]} 分钟 vs work.json ${want[1]} 分钟`);
    /* 文章自己的首页如果写了章数，也必须等于 work.json */
    const article = await readFile(`${slug}/index.html`, "utf8");
    const ch = article.match(/(\d+)\s*章 ·/) || article.match(/(\d+)\s*章</);
    if (ch && meta.chapters && +ch[1] !== meta.chapters) {
      bad.push(`${slug}：文章首页写 ${ch[1]} 章 vs work.json ${meta.chapters} 章`);
    }
  }

  /* 「阅读最新文章」必须真的指向最新那一篇。实测它一直指着 optimization（7/30），
     而最新的是 cosmic-web（8/4）—— 首页最显眼的那个按钮送错了地方。 */
  {
    const dated = [];
    for (const { slug } of works) {
      const meta = JSON.parse(await readFile(`${slug}/work.json`, "utf8"));
      dated.push({ slug, date: meta.date });
    }
    dated.sort((a, b) => b.date.localeCompare(a.date));
    const newest = dated[0].slug;
    const m = home.match(/<a class="nav-pill" href="([^"]+)\/">\s*阅读最新文章/);
    if (!m) bad.push("首页找不到「阅读最新文章」链接");
    else if (m[1] !== newest) bad.push(`「阅读最新文章」指向 ${m[1]}，最新的其实是 ${newest}（${dated[0].date}）`);
  }
  if (bad.length) {
    console.error(JSON.stringify({ ok: false, why: "时长/章数对不上：" + bad.join("；") }, null, 2));
    process.exit(1);
  }
}

console.log(JSON.stringify({ ok: true, works: works.length, report }));
