# THE G500's DASHBOARD SCREEN, straightened (2026-11-05, the user: "the look from inside the cars must be real — now
# it's tilted towards one side"). The model's cabin has the W463A's widescreen (the instrument + the centre display: one
# black panel, ~0.62 × 0.27 m, from the driver's binnacle to the middle) yawed 19° and rolled 9°: from the driver's
# seat it slants across the windscreen. Here it's turned flat across the car — about its own centre, in the GLB's
# own vertex buffer — and its height brought down to the real screen's (no export round trip: the extras, names and the rest of the file stay byte for byte).
#
#   python3 scripts/oth/g500_dash.py [src/assets/models/vehicles/mercedes_g500_4x4.lod0.glb]   (once: the file is marked)
import json, struct, sys
import numpy as np

path = sys.argv[1] if len(sys.argv) > 1 else 'src/assets/models/vehicles/mercedes_g500_4x4.lod0.glb'
data = bytearray(open(path, 'rb').read())
jlen = struct.unpack('<I', data[12:16])[0]
j = json.loads(data[20:20 + jlen])
bin0 = 20 + jlen + 8
mesh = next(m for m in j['meshes'] if m['name'] == 'cab_mercedes')
acc = j['accessors'][mesh['primitives'][0]['attributes']['POSITION']]
bv = j['bufferViews'][acc['bufferView']]
off = bin0 + bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
stride = bv.get('byteStride', 12)
n = acc['count']
P = np.array([struct.unpack_from('<3f', data, off + i * stride) for i in range(n)])
# (the whole car's length along z, every mesh's accessor bounds)
zs = [j['accessors'][pr['attributes']['POSITION']] for m in j['meshes'] for pr in m['primitives']]
LENGTH = max(a['max'][2] for a in zs) - min(a['min'][2] for a in zs)
# the panel and what's on it: the cabin's vertices in its box (glTF space, in metres — the model is in hundredths: the
# game scales the car to its 4.6 m length) — above the column's parts (y < 1.555)
M = P * (4.6 / LENGTH)
sel = (M[:, 0] > -0.21) & (M[:, 0] < 0.5) & (M[:, 1] > 1.555) & (M[:, 1] < 1.87) & (M[:, 2] > 0.34) & (M[:, 2] < 0.74)
if j['asset'].get('extras', {}).get('dash_straightened'):
    print('already straightened'); sys.exit(0)
Q = P[sel]
c = Q.mean(0)
# (its axis from the panel alone — the small parts on its face, x 0 … 0.07 m, left out of the fit; they turn with it)
F = Q[np.abs(M[sel][:, 0] - 0.03) > 0.06]
fc = F.mean(0)
w, V = np.linalg.eigh(((F - fc).T @ (F - fc)) / len(F))
a = V[:, 2] * np.sign(V[0, 2])                               # its long axis, pointing +x
ang = np.degrees(np.arccos(min(1, abs(a[0]))))
print(f'{sel.sum()} vertices; the long axis {np.round(a, 3)} — {ang:.1f}° off across')
if ang < 0.5:
    print('already straight'); sys.exit(0)
# the turn taking the long axis onto +x (the shortest)
t = np.array([1.0, 0, 0]); k = np.cross(a, t); s = np.linalg.norm(k); cth = a @ t
K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
R = np.eye(3) + K + K @ K * ((1 - cth) / (s * s))
P[sel] = (Q - c) @ R.T + c
# …and brought down to the real one's height (~0.16 m, from 0.27: it rose to just under the driver's eye and hid a
# third of the windscreen) — squeezed toward its bottom edge
yb = P[sel][:, 1].min()
P[sel, 1] = yb + (P[sel, 1] - yb) * 0.6
for i in np.nonzero(sel)[0]:
    struct.pack_into('<3f', data, off + i * stride, *P[i])
acc['min'] = P.min(0).tolist(); acc['max'] = P.max(0).tolist()
j['asset'].setdefault('extras', {})['dash_straightened'] = True
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
if len(js) != jlen:
    # (the JSON's length changed: the chunk rewritten, the binary chunk after it)
    data = data[:12] + struct.pack('<I', len(js)) + b'JSON' + js + data[20 + jlen:]
    struct.pack_into('<I', data, 8, len(data))
else:
    data[20:20 + jlen] = js
open(path, 'wb').write(bytes(data))
print('written', path)
