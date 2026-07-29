import assert from "node:assert/strict";

const close = (actual, expected, tolerance = 1e-11) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`
  );
};

function roots(t, beta) {
  const sum = 1 + beta - t;
  const discriminant = sum * sum - 4 * beta;
  if (discriminant >= 0) {
    const delta = Math.sqrt(discriminant);
    const values = [(sum + delta) / 2, (sum - delta) / 2];
    return { values, radius: Math.max(...values.map(Math.abs)) };
  }
  return { values: null, radius: Math.sqrt(beta) };
}

function simulateGd(kappa, alpha, initial, steps) {
  let point = [...initial];
  for (let step = 0; step < steps; step += 1) {
    point = [
      point[0] - alpha * point[0],
      point[1] - alpha * kappa * point[1]
    ];
  }
  return point;
}

for (const kappa of [1.1, 2, 10, 100, 1000]) {
  const gdAlpha = 2 / (1 + kappa);
  const gdRate = (kappa - 1) / (kappa + 1);
  close(Math.abs(1 - gdAlpha), gdRate);
  close(Math.abs(1 - gdAlpha * kappa), gdRate);

  const rootKappa = Math.sqrt(kappa);
  const hbAlpha = 4 / (1 + rootKappa) ** 2;
  const hbBeta = ((rootKappa - 1) / (rootKappa + 1)) ** 2;
  const hbRate = (rootKappa - 1) / (rootKappa + 1);
  for (let sample = 0; sample <= 200; sample += 1) {
    const lambda = 1 + (kappa - 1) * sample / 200;
    close(roots(hbAlpha * lambda, hbBeta).radius, hbRate, 2e-8);
  }

  const initial = [3, 1.35];
  const steps = 27;
  const direct = simulateGd(kappa, 1 / kappa, initial, steps);
  const closed = [
    initial[0] * (1 - 1 / kappa) ** steps,
    initial[1] * (1 - kappa / kappa) ** steps
  ];
  close(direct[0], closed[0], 1e-12);
  close(direct[1], closed[1], 1e-12);

  for (const beta of [0, .2, .67, .9, .99]) {
    const stableStep = 2 * (1 + beta) * .99;
    const unstableStep = 2 * (1 + beta) * 1.01;
    assert.ok(roots(stableStep, beta).radius < 1);
    assert.ok(roots(unstableStep, beta).radius > 1);
  }
}

console.log(JSON.stringify({
  ok: true,
  conditionNumbers: [1.1, 2, 10, 100, 1000],
  checks: [
    "gradient-descent optimal rate",
    "heavy-ball optimal roots across the full spectrum",
    "iterative update equals closed form",
    "stability boundary s = 2(1 + beta)"
  ]
}));
