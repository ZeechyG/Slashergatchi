// Portfolio construction. Four independent optimisers run over the same
// shrunk covariance matrix and are blended, because every single optimiser has
// a known failure mode: mean-variance is hostage to return estimates, risk
// parity ignores expected return entirely, HRP ignores it too but survives
// unstable correlations, and min-variance piles into whatever is quietest.

import {
  mean, stdev, variance, covariance, correlation, zeros, matVec, dot, quadForm,
  projectToSimplexBox, clamp, sum, EPS,
} from './mathx.js';

/** Sample covariance matrix of a set of aligned return vectors. */
export function sampleCovariance(returnsBySymbol, symbols) {
  const n = symbols.length;
  const S = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const c = i === j
        ? variance(returnsBySymbol[symbols[i]])
        : covariance(returnsBySymbol[symbols[i]], returnsBySymbol[symbols[j]]);
      S[i][j] = c;
      S[j][i] = c;
    }
  }
  return S;
}

export function correlationMatrix(returnsBySymbol, symbols) {
  const n = symbols.length;
  const C = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const c = i === j ? 1 : correlation(returnsBySymbol[symbols[i]], returnsBySymbol[symbols[j]]);
      C[i][j] = Number.isFinite(c) ? c : 0;
      C[j][i] = C[i][j];
    }
  }
  return C;
}

/**
 * Ledoit-Wolf shrinkage toward the constant-correlation target. With a handful
 * of names and a few hundred observations the sample covariance is far too
 * noisy to optimise against directly; this is the standard fix.
 * Returns the shrunk matrix and the estimated intensity delta.
 */
export function shrinkCovariance(returnsBySymbol, symbols) {
  const n = symbols.length;
  const S = sampleCovariance(returnsBySymbol, symbols);
  if (n < 2) return { sigma: S, delta: 0, target: S };

  const T = Math.min(...symbols.map((s) => returnsBySymbol[s].length));
  const X = symbols.map((s) => {
    const r = returnsBySymbol[s].slice(-T);
    const m = mean(r);
    return r.map((v) => v - m);
  });

  // Constant-correlation target F.
  let rbarNum = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.sqrt(S[i][i] * S[j][j]);
      if (d > EPS) {
        rbarNum += S[i][j] / d;
        pairs++;
      }
    }
  }
  const rbar = pairs ? rbarNum / pairs : 0;
  const F = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      F[i][j] = i === j ? S[i][i] : rbar * Math.sqrt(S[i][i] * S[j][j]);
    }
  }

  // pi: sum of asymptotic variances of the sample covariance entries.
  let pi = 0;
  const piMat = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let t = 0; t < T; t++) acc += (X[i][t] * X[j][t] - S[i][j]) ** 2;
      piMat[i][j] = acc / T;
      pi += piMat[i][j];
    }
  }

  // rho: covariance between the sample entries and the target's estimation error.
  let rho = 0;
  for (let i = 0; i < n; i++) rho += piMat[i][i];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let tii = 0;
      let tjj = 0;
      for (let t = 0; t < T; t++) {
        tii += (X[i][t] ** 2 - S[i][i]) * (X[i][t] * X[j][t] - S[i][j]);
        tjj += (X[j][t] ** 2 - S[j][j]) * (X[i][t] * X[j][t] - S[i][j]);
      }
      tii /= T;
      tjj /= T;
      const si = Math.sqrt(S[i][i]);
      const sj = Math.sqrt(S[j][j]);
      if (si > EPS && sj > EPS) rho += (rbar / 2) * ((sj / si) * tii + (si / sj) * tjj);
    }
  }

  // gamma: squared distance between sample and target.
  let gamma = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) gamma += (F[i][j] - S[i][j]) ** 2;

  const delta = gamma > EPS ? clamp((pi - rho) / gamma / T, 0, 1) : 0;
  const sigma = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sigma[i][j] = delta * F[i][j] + (1 - delta) * S[i][j];
  }
  return { sigma, delta, target: F, sample: S };
}

export function portfolioVol(weights, sigma) {
  return Math.sqrt(Math.max(0, quadForm(sigma, weights)));
}

/** Marginal and total risk contribution of each holding. */
export function riskContributions(weights, sigma) {
  const vol = portfolioVol(weights, sigma);
  if (!(vol > EPS)) return weights.map(() => 0);
  const mrc = matVec(sigma, weights).map((v) => v / vol);
  const total = weights.map((w, i) => w * mrc[i]);
  const s = sum(total);
  return total.map((v) => (Math.abs(s) > EPS ? v / s : 0));
}

/**
 * Long-only maximum-Sharpe portfolio by projected gradient ascent.
 * Constrained to [minWeight, maxWeight] and fully invested.
 */
export function maxSharpeWeights(mu, sigma, { minWeight = 0, maxWeight = 1, rf = 0, steps = 4000 } = {}) {
  const n = mu.length;
  if (!n) return [];
  if (n === 1) return [1];
  let w = projectToSimplexBox(new Array(n).fill(1 / n), minWeight, maxWeight);
  const excess = mu.map((m) => m - rf);
  let best = w;
  let bestScore = -Infinity;
  let lr = 0.05;

  for (let it = 0; it < steps; it++) {
    const vol = portfolioVol(w, sigma);
    if (!(vol > EPS)) break;
    const ret = dot(w, excess);
    const score = ret / vol;
    if (score > bestScore) {
      bestScore = score;
      best = [...w];
    }
    // d/dw (w'mu / sqrt(w'Sw)) = mu/vol - (w'mu) * Sw / vol^3
    const Sw = matVec(sigma, w);
    const grad = excess.map((m, i) => m / vol - (ret * Sw[i]) / vol ** 3);
    const gnorm = Math.sqrt(sum(grad.map((g) => g * g))) || 1;
    w = projectToSimplexBox(w.map((v, i) => v + (lr * grad[i]) / gnorm), minWeight, maxWeight);
    lr *= 0.999;
  }
  return best;
}

/** Long-only global minimum-variance portfolio, same constraint set. */
export function minVarianceWeights(sigma, { minWeight = 0, maxWeight = 1, steps = 3000 } = {}) {
  const n = sigma.length;
  if (n === 1) return [1];
  let w = projectToSimplexBox(new Array(n).fill(1 / n), minWeight, maxWeight);
  let lr = 0.05;
  for (let it = 0; it < steps; it++) {
    const grad = matVec(sigma, w).map((v) => -2 * v);
    const gnorm = Math.sqrt(sum(grad.map((g) => g * g))) || 1;
    w = projectToSimplexBox(w.map((v, i) => v + (lr * grad[i]) / gnorm), minWeight, maxWeight);
    lr *= 0.999;
  }
  return w;
}

/**
 * Equal risk contribution (risk parity) via the standard fixed-point iteration
 * w_i <- b_i / (Sigma w)_i, renormalised each pass.
 */
export function riskParityWeights(sigma, { budgets = null, minWeight = 0, maxWeight = 1, iterations = 800 } = {}) {
  const n = sigma.length;
  if (n === 1) return [1];
  const b = budgets ?? new Array(n).fill(1 / n);
  let w = new Array(n).fill(1 / n);
  for (let it = 0; it < iterations; it++) {
    const Sw = matVec(sigma, w);
    const next = w.map((wi, i) => (Sw[i] > EPS ? b[i] / Sw[i] : wi));
    const s = sum(next);
    if (!(s > EPS)) break;
    const norm = next.map((v) => v / s);
    const delta = sum(norm.map((v, i) => Math.abs(v - w[i])));
    w = norm;
    if (delta < 1e-10) break;
  }
  return projectToSimplexBox(w, minWeight, maxWeight);
}

/**
 * Hierarchical Risk Parity (Lopez de Prado). Clusters correlated names, then
 * splits capital down the tree by inverse variance. Needs no matrix inversion,
 * which is exactly why it holds up when the correlation matrix is unstable.
 */
export function hrpWeights(sigma, { minWeight = 0, maxWeight = 1 } = {}) {
  const n = sigma.length;
  if (n === 1) return [1];
  if (n === 2) {
    const inv = [1 / sigma[0][0], 1 / sigma[1][1]];
    const s = inv[0] + inv[1];
    return projectToSimplexBox([inv[0] / s, inv[1] / s], minWeight, maxWeight);
  }

  // Correlation-distance matrix, then the Euclidean distance between columns.
  const corr = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = Math.sqrt(sigma[i][i] * sigma[j][j]);
      corr[i][j] = d > EPS ? clamp(sigma[i][j] / d, -1, 1) : (i === j ? 1 : 0);
    }
  }
  const dist = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) dist[i][j] = Math.sqrt(Math.max(0, 0.5 * (1 - corr[i][j])));
  }
  const dist2 = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let k = 0; k < n; k++) acc += (dist[i][k] - dist[j][k]) ** 2;
      dist2[i][j] = Math.sqrt(acc);
    }
  }

  const order = quasiDiagonalOrder(dist2, n);

  // Recursive bisection.
  const clusterVar = (idx) => {
    const inv = idx.map((i) => (sigma[i][i] > EPS ? 1 / sigma[i][i] : 0));
    const s = sum(inv);
    const w = s > EPS ? inv.map((v) => v / s) : idx.map(() => 1 / idx.length);
    let acc = 0;
    for (let a = 0; a < idx.length; a++) {
      for (let b = 0; b < idx.length; b++) acc += w[a] * w[b] * sigma[idx[a]][idx[b]];
    }
    return acc;
  };

  const weights = new Array(n).fill(1);
  const stack = [order];
  while (stack.length) {
    const group = stack.pop();
    if (group.length <= 1) continue;
    const half = Math.floor(group.length / 2);
    const left = group.slice(0, half);
    const right = group.slice(half);
    const vl = clusterVar(left);
    const vr = clusterVar(right);
    const total = vl + vr;
    const alpha = total > EPS ? 1 - vl / total : 0.5;
    for (const i of left) weights[i] *= alpha;
    for (const i of right) weights[i] *= 1 - alpha;
    stack.push(left, right);
  }
  const s = sum(weights);
  return projectToSimplexBox(weights.map((w) => (s > EPS ? w / s : 1 / n)), minWeight, maxWeight);
}

/** Single-linkage agglomerative clustering, flattened to a leaf ordering. */
function quasiDiagonalOrder(dist, n) {
  let clusters = Array.from({ length: n }, (_, i) => ({ members: [i] }));
  const linkage = (a, b) => {
    let best = Infinity;
    for (const i of a.members) for (const j of b.members) best = Math.min(best, dist[i][j]);
    return best;
  };
  while (clusters.length > 1) {
    let bi = 0;
    let bj = 1;
    let bd = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = linkage(clusters[i], clusters[j]);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    const merged = { members: [...clusters[bi].members, ...clusters[bj].members] };
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(merged);
  }
  return clusters[0].members;
}

/**
 * Fractional Kelly sizing for the aggregate risky position. Full Kelly is
 * famously unusable in practice (it assumes the return distribution is known);
 * a quarter to a half is the standard professional compromise.
 */
export function kellyFraction(expectedExcessReturn, vol, { fraction = 0.35, cap = 1 } = {}) {
  if (!(vol > EPS)) return 0;
  const full = expectedExcessReturn / (vol * vol);
  return clamp(full * fraction, 0, cap);
}

/**
 * Diversification ratio: weighted average volatility over portfolio volatility.
 * 1.0 means the blend bought no diversification at all.
 */
export function diversificationRatio(weights, sigma) {
  const wAvgVol = sum(weights.map((w, i) => w * Math.sqrt(Math.max(0, sigma[i][i]))));
  const pv = portfolioVol(weights, sigma);
  return pv > EPS ? wAvgVol / pv : NaN;
}

/**
 * Effective number of bets from the concentration of weights (inverse
 * Herfindahl). Flags a "portfolio" that is really one position.
 */
export function effectiveBets(weights) {
  const h = sum(weights.map((w) => w * w));
  return h > EPS ? 1 / h : 0;
}

/**
 * Blends the individual optimiser solutions. The blend weights shift with the
 * investor's risk tolerance: conservative mandates lean on risk parity and
 * minimum variance, aggressive ones on max-Sharpe.
 */
export function blendAllocations(solutions, blendWeights, { minWeight = 0, maxWeight = 1 } = {}) {
  const names = Object.keys(solutions).filter((k) => solutions[k]?.length);
  if (!names.length) return [];
  const n = solutions[names[0]].length;
  const acc = new Array(n).fill(0);
  let totalW = 0;
  for (const k of names) {
    const bw = blendWeights[k] ?? 0;
    if (bw <= 0) continue;
    totalW += bw;
    for (let i = 0; i < n; i++) acc[i] += bw * solutions[k][i];
  }
  if (!(totalW > EPS)) return projectToSimplexBox(new Array(n).fill(1 / n), minWeight, maxWeight);
  return projectToSimplexBox(acc.map((v) => v / totalW), minWeight, maxWeight);
}
