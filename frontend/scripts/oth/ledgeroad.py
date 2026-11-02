# OVER THE HILL — a LEDGE ROAD up a face (the valley's Great Cliff — valley_cliff.py; the desert's escarpment —
# desert.py; the user, 2026-11-02: "do the cliff and path"). numpy only.
import math
import numpy as np
from terrainlib import fbm, smoothstep


class LedgeRoad:
    """Over the Hill's roads hang on their walls: NL legs, each a shelf cut into the face at a steady grade, there and
    back along u (leg 0 from its start O out to L, leg 1 back, …), stacked P apart up the face (v), joined by HAIRPINS
    on benches at alternate ends; a low BERM on each shelf's outer edge; between two legs a RISER (a few metres where a
    hairpin joins them, the climb of two legs at the other end) layered in strata; all the legs gently bowed together.
    Below leg 0 a shoulder down to the ground (`Nat`), above the top leg a WALL up to `top(x, z)`.
    Local frame: u along leg 0 from O, v toward the higher legs — eu, ev unit vectors in (x, z). The grade: `grade`, or
    what takes y0 up to y_top over the whole road."""

    def __init__(self, O, eu, ev, NL, L, y0, top, P=26.0, grade=None, y_top=None, SH=3.7, berm=(1.6, 0.7), wall=14.0,
                 drop=3.2, bow=(7.0, 5.0), seed=31):
        self.O, self.eu, self.ev = np.array(O, float), np.array(eu, float), np.array(ev, float)
        self.NL, self.L, self.P, self.R, self.SH = NL, float(L), float(P), P / 2, SH
        self.BW, self.BH = berm
        self.wall, self.drop, self.bow, self.seed, self.top_fn = wall, drop, bow, seed, top
        self.S0 = np.array([k * (self.L + math.pi * self.R) for k in range(NL)])   # the road's length at leg k's start
        self.y0 = y0
        self.grade = grade if grade is not None else (y_top - y0) / (self.S0[-1] + self.L)
        self.y_top = y0 + self.grade * (self.S0[-1] + self.L)
        self.VK = self.P * np.arange(NL)

    def local(self, X, Z):
        dx, dz = X - self.O[0], Z - self.O[1]
        return dx * self.eu[0] + dz * self.eu[1], dx * self.ev[0] + dz * self.ev[1]

    def world(self, u, v):
        return self.O[0] + u * self.eu[0] + v * self.ev[0], self.O[1] + u * self.eu[1] + v * self.ev[1]

    def bed(self, k, u):
        return self.y0 + self.grade * (self.S0[k] + (u if k % 2 == 0 else self.L - u))

    def wob(self, u):
        """The legs' bow (the same for all: they stay P apart) — 0 with no slope at both ends."""
        t = np.clip(u / self.L, 0, 1)
        a, b = self.bow
        return a * (1 - np.cos(2 * np.pi * t)) - b * np.sin(2 * np.pi * t) * np.sin(np.pi * t)

    @staticmethod
    def bump(t):
        return np.where((t > 0) & (t < 1), np.sin(np.pi * np.clip(t, 0, 1)), 0.0)

    def strata(self, h, lo, hi, X, Z):
        """Layer a face: benches every ~6 m (their heights wandering), only where it's tall."""
        st = 6.0 + 1.2 * fbm(X / 140, Z / 140, self.seed + 3, 2)
        ph = 2.0 * fbm(X / 210, Z / 210, self.seed + 4, 2)
        t = (h + ph) / st
        f = t - np.floor(t)
        q = (np.floor(t) + smoothstep(0.42, 1.0, f)) * st - ph
        k = smoothstep(10, 26, hi - lo) * 0.7
        return np.clip(h + (q - h) * k, lo, hi)

    @staticmethod
    def riser(t):
        """0 at the low shelf's inner edge (a gutter), 1 just before the high shelf's berm: steepest mid-way."""
        a = smoothstep(0.05, 1.0, t)
        return smoothstep(0.0, 1.0, a) * 0.85 + a * 0.15

    def stair(self, u, vs, Nat, X, Z):
        """The face at u (within 0 … L), vs (v less the bow): shelves, risers, berms; below leg 0 its shoulder down to
        Nat; above the top leg the wall up to top()."""
        B = [self.bed(k, u) for k in range(self.NL)]
        SH, P, BW, BH, VK = self.SH, self.P, self.BW, self.BH, self.VK
        H = np.array(Nat, copy=True)
        gw = P - 2 * SH
        dw = -SH - vs
        m = dw > 0
        H[m] = ((B[0] + BH * self.bump(dw / BW)) * (1 - smoothstep(BW, BW + 26, dw)) + Nat * smoothstep(BW, BW + 26, dw))[m]
        for k in range(self.NL):
            on = np.abs(vs - VK[k]) <= SH
            H[on] = B[k][on]
        for k in range(self.NL - 1):
            g = (vs > VK[k] + SH) & (vs < VK[k + 1] - SH)
            t = (vs - VK[k] - SH) / gw
            lo, hi = B[k], B[k + 1]
            h = lo + (hi - lo) * self.riser(t / (1 - (BW + 0.4) / gw))
            h = self.strata(h, lo, hi, X, Z) + BH * self.bump((VK[k + 1] - SH - vs) / BW)
            H[g] = h[g]
        e = vs > VK[-1] + SH
        t = (vs - VK[-1] - SH) / self.wall
        tp = self.top_fn(X, Z)
        h = B[-1] + (tp - B[-1]) * self.riser(np.clip(t, 0, 1))
        h = np.where(t >= 1, tp, self.strata(h, B[-1], tp, X, Z))
        H[e] = h[e]
        return H

    def hairpin(self, u, v, Hbase, k):
        """Hairpin k → k+1 (at u = L for even k, u = 0 for odd): its ring, the island inside, the berm round it — over
        Hbase (the face held at the legs' end: the bench it stands on)."""
        R, SH, BW, BH = self.R, self.SH, self.BW, self.BH
        cu, cv = (self.L if k % 2 == 0 else 0.0), self.VK[k] + R
        du, dv = u - cu, v - cv
        side = (du > 0) if k % 2 == 0 else (du < 0)
        r = np.hypot(du, dv)
        phi = np.arctan2(np.abs(du), -dv)                  # 0 at leg k's end, π at leg k+1's start
        y = self.bed(k, cu) + self.grade * R * phi
        H = np.array(Hbase, copy=True)
        ring = side & (r <= R + SH)
        H[ring] = y[ring]
        isl = side & (r < R - SH)
        H[isl] = (y + 0.35 * self.bump((R - SH - r) / (R - SH)))[isl]
        rim = side & (r > R + SH) & (r < R + SH + BW)
        H[rim] = (y + BH * self.bump((r - R - SH) / BW))[rim]
        return H

    def face(self, X, Z, Nat, beyond_hi=None):
        """The whole face over the window X, Z (world) on the ground Nat: the legs' band; past each end the bench the
        hairpins stand on, then falling to Nat (`drop` m per m) — or past the far end (u > L), if `beyond_hi(X, Z)` is
        given, blending into that over 50 → 100 m; the hairpins; nothing below leg 0's shoulder."""
        u, v = self.local(X, Z)
        L, R, SH, BW = self.L, self.R, self.SH, self.BW
        uc = np.clip(u, 0, L)
        vs = v - self.wob(uc)
        H = self.stair(uc, vs, Nat, X, Z)
        out = R + SH + BW + 1
        H = np.where(u < 0, np.maximum(Nat, H - self.drop * np.maximum(-u - out, 0)), H)
        if beyond_hi is None:
            H = np.where(u > L, np.maximum(Nat, H - self.drop * np.maximum(u - L - out, 0)), H)
        else:
            nb = smoothstep(L + 50, L + 100, u)
            H = np.where(u > L, H * (1 - nb) + beyond_hi(X, Z) * nb, H)
        H = Nat + (H - Nat) * smoothstep(-SH - 32, -SH - 26, v)
        for k in range(self.NL - 1): H = self.hairpin(u, v, H, k)
        return H

    def points(self, step=2.0):
        """The road's centre line from leg 0's start to the top leg's end (x, z every ~step m)."""
        parts = []
        for k in range(self.NL):
            us = np.arange(0, self.L + 0.01, step)
            if k % 2: us = us[::-1]
            parts.append(np.stack([us, self.VK[k] + self.wob(us)], 1))
            if k < self.NL - 1:
                n = max(4, int(math.pi * self.R / step))
                ph = np.linspace(0, np.pi, n + 1)[1:-1]
                cu, s = (self.L, 1) if k % 2 == 0 else (0.0, -1)
                parts.append(np.stack([cu + s * self.R * np.sin(ph), self.VK[k] + self.R - self.R * np.cos(ph)], 1))
        uv = np.vstack(parts)
        x, z = self.world(uv[:, 0], uv[:, 1])
        return np.stack([x, z], 1)

    def top_end(self):
        """The top leg's end: (x, z), its bed height, and the way it's heading (a unit vector in x, z)."""
        even = (self.NL - 1) % 2 == 0
        x, z = self.world(self.L if even else 0.0, self.VK[-1])
        d = self.eu if even else -self.eu
        return (float(x), float(z)), self.y_top, d
