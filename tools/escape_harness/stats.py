import math


def beta_fraction(a, b, x):
    floor = lambda value: 1e-300 if abs(value) < 1e-300 else value
    c, d = 1.0, 1 / floor(1 - (a + b) * x / (a + 1))
    result = d
    for m in range(1, 301):
        for term in (m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m)),
                     -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))):
            d, c = 1 / floor(1 + term * d), floor(1 + term / c)
            delta = d * c
            result *= delta
        if abs(delta - 1) < 3e-16:
            return result
    raise ArithmeticError("incomplete beta did not converge")


def incomplete_beta(x, a, b):
    if x <= 0 or x >= 1:
        return float(x >= 1)
    scale = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
                     + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1) / (a + b + 2):
        return scale * beta_fraction(a, b, x) / a
    return 1 - scale * beta_fraction(b, a, 1 - x) / b


def beta_quantile(p, a, b):
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if incomplete_beta(mid, a, b) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def bounds(k, n, confidence=0.95):
    if (type(k) is not int or type(n) is not int or not 0 <= k <= n
            or type(confidence) not in (int, float) or not 0 < confidence < 1):
        raise ValueError("integer counts 0 <= k <= n and confidence in (0, 1) required")
    if n == 0:
        return dict(point=None, lower=None, upper=None, cp_lower=None, cp_upper=None)
    alpha = 1 - confidence
    return dict(point=k / n,
                lower=0 if k == 0 else beta_quantile(alpha, k, n - k + 1),
                upper=1 if k == n else beta_quantile(confidence, k + 1, n - k),
                cp_lower=0 if k == 0 else beta_quantile(alpha / 2, k, n - k + 1),
                cp_upper=1 if k == n else beta_quantile(1 - alpha / 2, k + 1, n - k))
