# OVER THE HILL — terrain helpers shared by the world generators (desert.py; the valley's terrain.py has its own
# copies): gradient noise, fBm, ridged noise, smoothstep, box blur, grids, bilinear sampling, 2× upsampling, Catmull–Rom
# splines, polyline distance fields, path smoothing. numpy only.
import math
import numpy as np

def hash2(ix, iz, s):
    h = (ix * 374761393 + iz * 668265263 + (s * 144665 + 7)) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return h ^ (h >> 16)

def gnoise(x, z, s):
    """Gradient noise, ~[-1, 1]."""
    fx0 = np.floor(x); fz0 = np.floor(z)
    fx = x - fx0; fz = z - fz0
    ix = fx0.astype(np.int64); iz = fz0.astype(np.int64)
    def g(dx, dz):
        a = (hash2(ix + dx, iz + dz, s) & 1023) * (2 * np.pi / 1024)
        return np.cos(a) * (fx - dx) + np.sin(a) * (fz - dz)
    ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
    a = g(0, 0); b = g(1, 0); a += (b - a) * ux
    c = g(0, 1); d = g(1, 1); c += (d - c) * ux
    return (a + (c - a) * uz) * 1.4

_C, _S = math.cos(0.65), math.sin(0.65)
def fbm(x, z, s, octaves, gain=0.5, lac=2.03):
    tot = 0.0; amp = 1.0; norm = 0.0
    for o in range(octaves):
        tot = tot + amp * gnoise(x, z, s + o * 101)
        norm += amp
        x, z = (x * _C - z * _S) * lac, (x * _S + z * _C) * lac
        amp *= gain
    return tot / norm

def ridged(x, z, s, octaves, gain=0.5, lac=2.03):
    """Ridged multifractal, 0..1 (sharp crests, eroded-looking valleys between)."""
    tot = 0.0; amp = 0.5; w = 1.0; norm = 0.0
    for o in range(octaves):
        n = 1.0 - np.abs(gnoise(x, z, s + o * 131))
        n = n * n * w
        w = np.clip(n * 2.0, 0.0, 1.0)
        tot = tot + n * amp
        norm += amp
        x, z = (x * _C - z * _S) * lac, (x * _S + z * _C) * lac
        amp *= gain
    return tot / norm

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def blur(a, r):
    """Box blur, radius r cells, twice (≈ gaussian), edges clamped."""
    for _ in range(2):
        for ax in (0, 1):
            p = np.pad(a, [((r + 1, r) if k == ax else (0, 0)) for k in range(2)], mode='edge')
            c = np.cumsum(p, axis=ax)
            if ax == 0: a = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
            else: a = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
    return a

def grid(n, half):
    v = np.linspace(-half, half, n)
    return np.meshgrid(v, v)  # X[j, i] = x_i, Z[j, i] = z_j

def bilinear(H, half, x, z):
    n = H.shape[0]; step = 2 * half / (n - 1)
    fx = np.clip((x + half) / step, 0, n - 1.0001); fz = np.clip((z + half) / step, 0, n - 1.0001)
    i = fx.astype(np.int64); j = fz.astype(np.int64); tx = fx - i; tz = fz - j
    a = H[j, i] * (1 - tx) + H[j, i + 1] * tx
    b = H[j + 1, i] * (1 - tx) + H[j + 1, i + 1] * tx
    return a * (1 - tz) + b * tz

def up2(H):
    """2× upsample (n → 2n−1) with Catmull–Rom midpoints, separable."""
    def axis(a, ax):
        a = np.moveaxis(a, ax, 0)
        n = a.shape[0]
        out = np.empty((2 * n - 1,) + a.shape[1:], a.dtype)
        out[0::2] = a
        p = np.concatenate([a[:1], a, a[-1:]], 0)
        out[1::2] = (-p[0:n - 1] + 9 * p[1:n] + 9 * p[2:n + 1] - p[3:n + 2]) / 16
        return np.moveaxis(out, 0, ax)
    return axis(axis(H, 0), 1)

def spline(P, step=8.0):
    """Catmull–Rom through P, resampled every ~step m."""
    pts = []
    Q = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    for k in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[k - 1], Q[k], Q[k + 1], Q[k + 2]
        m = max(2, int(np.hypot(*(p2 - p1)) / step))
        for t in np.linspace(0, 1, m, endpoint=False):
            t2, t3 = t * t, t * t * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(P[-1])
    return np.array(pts)

def polyline_field(X, Z, L, reach):
    """Distance to the polyline L and the arc length of the nearest point, for the grid X, Z (windowed per segment)."""
    D = np.full(X.shape, 1e9); S = np.zeros(X.shape)
    acc = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(L, axis=0).T))])
    xs = X[0]; zs = Z[:, 0]
    for k in range(len(L) - 1):
        a, b = L[k], L[k + 1]
        i0, i1 = np.searchsorted(xs, min(a[0], b[0]) - reach), np.searchsorted(xs, max(a[0], b[0]) + reach)
        j0, j1 = np.searchsorted(zs, min(a[1], b[1]) - reach), np.searchsorted(zs, max(a[1], b[1]) + reach)
        if i1 <= i0 or j1 <= j0: continue
        x = X[j0:j1, i0:i1]; z = Z[j0:j1, i0:i1]
        ab = b - a; l2 = ab @ ab
        t = np.clip(((x - a[0]) * ab[0] + (z - a[1]) * ab[1]) / l2, 0, 1)
        d = np.hypot(x - a[0] - t * ab[0], z - a[1] - t * ab[1])
        dd = D[j0:j1, i0:i1]; m = d < dd
        dd[m] = d[m]
        S[j0:j1, i0:i1][m] = (acc[k] + t * np.sqrt(l2))[m]
    return D, S, acc[-1]

def chaikin(P, k=3):
    for _ in range(k):
        Q = [P[0]]
        for a, b in zip(P[:-1], P[1:]):
            Q.append(a * 0.75 + b * 0.25); Q.append(a * 0.25 + b * 0.75)
        Q.append(P[-1]); P = np.array(Q)
    return P

def rdp(P, eps):
    if len(P) < 3: return P
    a, b = P[0], P[-1]
    ab = b - a; L = np.hypot(*ab) or 1.0
    d = np.abs(np.cross(ab, P - a)) / L
    i = int(np.argmax(d))
    if d[i] <= eps: return np.array([a, b])
    return np.vstack([rdp(P[:i + 1], eps)[:-1], rdp(P[i:], eps)])

def smooth_path(P):
    """Grid path → its few key points (RDP, 10 m) → a Catmull-Rom curve through them → 2 Chaikin passes."""
    K = rdp(P, 10.0)
    if len(K) < 3: return chaikin(K, 2)
    return chaikin(spline(K, 6.0), 2)

def resample(P, step=4.0):
    d = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
    t = np.arange(0, d[-1], step)
    return np.stack([np.interp(t, d, P[:, 0]), np.interp(t, d, P[:, 1])], 1)
