// Numerical primitives: descriptive statistics, distributions, and the small
// amount of linear algebra the portfolio optimisers need. No dependencies.

export const EPS = 1e-12;

export function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

export function clean(xs) {
  return (xs || []).filter(isFiniteNum);
}

export function sum(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs) {
  return xs.length ? sum(xs) / xs.length : NaN;
}

export function median(xs) {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Sample variance (Bessel-corrected) unless population is requested.
export function variance(xs, population = false) {
  const n = xs.length;
  if (n < (population ? 1 : 2)) return NaN;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return acc / (population ? n : n - 1);
}

export function stdev(xs, population = false) {
  const v = variance(xs, population);
  return Number.isFinite(v) ? Math.sqrt(v) : NaN;
}

export function covariance(xs, ys, population = false) {
  const n = Math.min(xs.length, ys.length);
  if (n < (population ? 1 : 2)) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (xs[i] - mx) * (ys[i] - my);
  return acc / (population ? n : n - 1);
}

export function correlation(xs, ys) {
  const c = covariance(xs, ys);
  const d = stdev(xs) * stdev(ys);
  return d > EPS ? c / d : NaN;
}

// Fisher-Pearson standardised moment coefficient (sample skewness, "G1").
export function skewness(xs) {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = mean(xs);
  const s = stdev(xs);
  if (!(s > EPS)) return 0;
  let acc = 0;
  for (const x of xs) acc += ((x - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * acc;
}

// Sample excess kurtosis (G2). Normal distribution -> 0.
export function kurtosis(xs) {
  const n = xs.length;
  if (n < 4) return NaN;
  const m = mean(xs);
  const s = stdev(xs);
  if (!(s > EPS)) return 0;
  let acc = 0;
  for (const x of xs) acc += ((x - m) / s) ** 4;
  const g2 = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * acc;
  return g2 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}

export function quantile(xs, p) {
  const v = clean(xs).sort((a, b) => a - b);
  if (!v.length) return NaN;
  if (p <= 0) return v[0];
  if (p >= 1) return v[v.length - 1];
  const pos = (v.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? v[lo] : v[lo] + (pos - lo) * (v[hi] - v[lo]);
}

export function autocorrelation(xs, lag = 1) {
  if (xs.length <= lag + 1) return NaN;
  return correlation(xs.slice(0, xs.length - lag), xs.slice(lag));
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

// Abramowitz & Stegun 7.1.26 error function, ~1.5e-7 absolute accuracy.
export function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return sign * y;
}

export function normalCdf(x, mu = 0, sigma = 1) {
  if (!(sigma > 0)) return x >= mu ? 1 : 0;
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

// Acklam's inverse normal CDF, refined by one Halley step.
export function normalInv(p) {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const pLow = 0.02425;
  let q;
  let x;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

// Two-sided p-value for a Student-t statistic, via the regularised incomplete
// beta function (continued fraction, Lentz's method).
export function tPValue(t, df) {
  if (!Number.isFinite(t) || !(df > 0)) return NaN;
  const x = df / (df + t * t);
  return regularisedIncompleteBeta(x, df / 2, 0.5);
}

function logGamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

export function regularisedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lbeta) / a;
  // Lentz continued fraction.
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 250; i++) {
    const m = Math.floor(i / 2);
    let numerator;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -(((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1)));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-10) break;
  }
  const res = front * (f - 1);
  return x < (a + 1) / (a + b + 2) ? res : 1 - res;
}

// ---------------------------------------------------------------------------
// Linear algebra (small, dense, symmetric matrices)
// ---------------------------------------------------------------------------

export function zeros(n, m = n) {
  return Array.from({ length: n }, () => new Array(m).fill(0));
}

export function matVec(A, x) {
  const n = A.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const row = A[i];
    for (let j = 0; j < row.length; j++) acc += row[j] * x[j];
    out[i] = acc;
  }
  return out;
}

export function dot(a, b) {
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc += a[i] * b[i];
  return acc;
}

export function quadForm(A, x) {
  return dot(x, matVec(A, x));
}

// Solves A x = b for symmetric positive-definite A via Cholesky, falling back
// to progressively stronger ridge regularisation if the matrix is singular.
export function solveSPD(A, b) {
  const n = A.length;
  for (const ridge of [0, 1e-10, 1e-8, 1e-6, 1e-4, 1e-2]) {
    const L = cholesky(A, ridge);
    if (!L) continue;
    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let acc = b[i];
      for (let k = 0; k < i; k++) acc -= L[i][k] * y[k];
      y[i] = acc / L[i][i];
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let acc = y[i];
      for (let k = i + 1; k < n; k++) acc -= L[k][i] * x[k];
      x[i] = acc / L[i][i];
    }
    if (x.every(isFiniteNum)) return x;
  }
  return null;
}

export function cholesky(A, ridge = 0) {
  const n = A.length;
  const L = zeros(n);
  const scale = ridge ? ridge * (trace(A) / n || 1) : 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let acc = A[i][j] + (i === j ? scale : 0);
      for (let k = 0; k < j; k++) acc -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(acc > 0)) return null;
        L[i][j] = Math.sqrt(acc);
      } else {
        L[i][j] = acc / L[j][j];
      }
    }
  }
  return L;
}

export function trace(A) {
  let acc = 0;
  for (let i = 0; i < A.length; i++) acc += A[i][i];
  return acc;
}

// Ordinary least squares with an intercept: y = b0 + X b, solved through the
// normal equations (design matrices here are tiny, so this is plenty stable).
export function olsWithIntercept(X, y) {
  const n = y.length;
  const k = X[0]?.length ?? 0;
  if (n <= k + 1) return null;
  const design = X.map((row) => [1, ...row]);
  const p = k + 1;
  const XtX = zeros(p);
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += design[i][a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += design[i][a] * design[i][b];
    }
  }
  const beta = solveSPD(XtX, Xty);
  if (!beta) return null;
  const fitted = design.map((row) => dot(row, beta));
  const resid = y.map((v, i) => v - fitted[i]);
  const ssRes = sum(resid.map((r) => r * r));
  const my = mean(y);
  const ssTot = sum(y.map((v) => (v - my) ** 2));
  const df = n - p;
  const sigma2 = ssRes / df;
  const XtXinv = invertSPD(XtX);
  const se = XtXinv ? beta.map((_, i) => Math.sqrt(Math.max(0, sigma2 * XtXinv[i][i]))) : beta.map(() => NaN);
  return {
    beta,
    se,
    tStats: beta.map((b, i) => (se[i] > EPS ? b / se[i] : NaN)),
    residuals: resid,
    r2: ssTot > EPS ? 1 - ssRes / ssTot : NaN,
    adjR2: ssTot > EPS ? 1 - (ssRes / df) / (ssTot / (n - 1)) : NaN,
    residualStdev: Math.sqrt(sigma2),
    n,
    df,
  };
}

export function invertSPD(A) {
  const n = A.length;
  const out = zeros(n);
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    const col = solveSPD(A, e);
    if (!col) return null;
    for (let i = 0; i < n; i++) out[i][j] = col[i];
  }
  return out;
}

// Projects v onto {w : sum(w) = 1, lo <= w_i <= hi} by bisecting the shift
// parameter of the clipped water-filling solution.
export function projectToSimplexBox(v, lo = 0, hi = 1) {
  const n = v.length;
  if (!n) return [];
  if (lo * n > 1 + 1e-9 || hi * n < 1 - 1e-9) {
    // Constraints cannot be satisfied; fall back to the feasible equal split.
    return new Array(n).fill(1 / n);
  }
  const f = (lam) => sum(v.map((x) => clamp(x - lam, lo, hi))) - 1;
  let loLam = Math.min(...v) - hi - 1;
  let hiLam = Math.max(...v) - lo + 1;
  for (let i = 0; i < 200; i++) {
    const mid = (loLam + hiLam) / 2;
    if (f(mid) > 0) loLam = mid;
    else hiLam = mid;
  }
  const lam = (loLam + hiLam) / 2;
  const w = v.map((x) => clamp(x - lam, lo, hi));
  const s = sum(w);
  return s > EPS ? w.map((x) => x / s) : new Array(n).fill(1 / n);
}
