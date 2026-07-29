import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const works = [
  { slug: "braess", method: "Nicky Case 式可玩论证" },
  { slug: "optimization", method: "Distill 式可探索论文" },
  { slug: "consciousness", method: "证据法庭" },
  { slug: "boltzmann", method: "反事实分屏" },
  { slug: "language-game", method: "多人社会实验" },
  { slug: "reaction-diffusion", method: "生成式场景" },
  { slug: "gw150914", method: "声音化" },
  { slug: "kakeya", method: "证明侦探片" }
];

const home = await readFile("index.html", "utf8");
const methods = await readFile("methods/index.html", "utf8");
assert.match(home, /共 8 篇/);
assert.equal((methods.match(/<article class="method">/g) || []).length, 8);
assert.equal((methods.match(/class="application-row"/g) || []).length, 8);
assert.doesNotMatch(methods, /未来的|敬请期待|coming soon|TBD|TODO/i);

for (const { slug, method } of works) {
  const metadata = JSON.parse(await readFile(`${slug}/work.json`, "utf8"));
  const article = await readFile(`${slug}/index.html`, "utf8");
  assert.equal(metadata.slug, slug);
  assert.ok(metadata.question && metadata.description && metadata.category);
  assert.match(home, new RegExp(`href="${slug}/"`));
  assert.match(methods, new RegExp(`href="../${slug}/"`));
  assert.match(methods, new RegExp(method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(article, new RegExp(`<link rel="canonical" href="https://viz\\.gopromp\\.com/${slug}/">`));
  assert.match(article, /<(?:canvas|button|input|audio)\b/);
  assert.doesNotMatch(article, /敬请期待|coming soon|TBD|TODO/i);
}

console.log(JSON.stringify({
  ok: true,
  completedWorks: works.length,
  mapping: Object.fromEntries(works.map(({ method, slug }) => [method, `/${slug}/`]))
}));
