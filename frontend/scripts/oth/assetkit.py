# OVERHILL — THE MODELLED ASSETS' KIT (2026-11-09): what every Blender script of the game's modelled things shares —
# scanned materials (ambientCG, CC0), primitive builders with UVs (boxes, tubes, rings), and THE BAKE: every part's
# materials baked into ONE atlas (colour + tangent normals, 1–2 K) on a packed second UV map, exported as Draco GLB
# (one node per part, at its own origin) + <name>.webp + <name>_n.webp. The game draws such a set with one material
# (the character's: the map, its normal map, the world's light — Gather.ts, Trailer.ts, the building kit).
#
#   import sys, os; sys.path.insert(0, os.path.dirname(__file__)); from assetkit import *
import os, math
import numpy as np
import bpy, bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..'))
ACG = os.path.join(HERE, '.cache', 'ambientcg')


def reset():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    for m in list(bpy.data.materials): bpy.data.materials.remove(m)


def pbr(name, asset, scale=1.0, tint=(1, 1, 1), rough=0.8, metal=0.0):
    """A material from an ambientCG set (its colour × tint, its GL normal map), sampled on the 'UVMap' layer × scale."""
    m = bpy.data.materials.new(name); m.use_nodes = True; t = m.node_tree
    b = t.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    uv = t.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'
    mp = t.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale); t.links.new(uv.outputs['UV'], mp.inputs['Vector'])
    c = t.nodes.new('ShaderNodeTexImage'); c.image = bpy.data.images.load(os.path.join(ACG, asset, f'{asset}_1K-JPG_Color.jpg')); t.links.new(mp.outputs['Vector'], c.inputs['Vector'])
    mx = t.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
    t.links.new(c.outputs['Color'], mx.inputs['A']); mx.inputs['B'].default_value = (*tint, 1); t.links.new(mx.outputs['Result'], b.inputs['Base Color'])
    n = t.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(os.path.join(ACG, asset, f'{asset}_1K-JPG_NormalGL.jpg')); n.image.colorspace_settings.name = 'Non-Color'
    t.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    nm = t.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'; t.links.new(n.outputs['Color'], nm.inputs['Color']); t.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m


def flat(name, rgb, rough=0.6, metal=0.0):
    """A plain material (a lens, a reflector, glass): its colour only."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m


def ensure_tex(asset):
    """The set downloaded (1K-JPG) if it isn't here yet."""
    d = os.path.join(ACG, asset)
    if os.path.isdir(d): return
    import urllib.request, zipfile, io, ssl
    ctx = ssl._create_unverified_context()
    data = urllib.request.urlopen(f'https://ambientcg.com/get?file={asset}_1K-JPG.zip', context=ctx).read()
    os.makedirs(d, exist_ok=True); zipfile.ZipFile(io.BytesIO(data)).extractall(d)


def obj(name, bm, mats, smooth=True):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    for p in me.polygons: p.use_smooth = smooth
    return o


def new_bm():
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap'); return bm, uvl


def box(bm, uvl, c, half, mat=0, k=1.0, u=Vector((1, 0, 0)), v=Vector((0, 1, 0)), w=Vector((0, 0, 1))):
    """A box at c, half extents `half` along the axes u, v, w; box-mapped UVs (k: texture repeats a metre)."""
    hx, hy, hz = half
    P = lambda sx, sy, sz: c + u * (sx * hx) + v * (sy * hy) + w * (sz * hz)
    vs = {(sx, sy, sz): bm.verts.new(P(sx, sy, sz)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)}
    faces = [((-1, -1, -1), (-1, 1, -1), (-1, 1, 1), (-1, -1, 1), 'yz', -1), ((1, -1, -1), (1, -1, 1), (1, 1, 1), (1, 1, -1), 'yz', 1),
             ((-1, -1, -1), (-1, -1, 1), (1, -1, 1), (1, -1, -1), 'xz', -1), ((-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1), 'xz', 1),
             ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), 'xy', -1), ((-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1), 'xy', 1)]
    for a, b, cc, d, pl, _ in faces:
        f = bm.faces.new((vs[a], vs[b], vs[cc], vs[d])); f.material_index = mat
        for lp, key in zip(f.loops, (a, b, cc, d)):
            x, y, z = key[0] * hx, key[1] * hy, key[2] * hz
            uu, vv = {'yz': (y, z), 'xz': (x, z), 'xy': (x, y)}[pl]
            lp[uvl].uv = (uu * k + c.x * 0.37, vv * k + c.z * 0.29)
    return vs


def tube(bm, uvl, path, radii, mat=0, sides=10, caps=True, k=1.0):
    """A tube along `path` (points), its cross-section an ellipse (radii[i] = (a, b)), UVs along it (the grain along)."""
    rings = []
    for i, p in enumerate(path):
        d = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        side = d.cross(ref).normalized(); up = side.cross(d).normalized()
        a, b = radii[i]
        rings.append([bm.verts.new(p + side * math.cos(s / sides * 2 * math.pi) * a + up * math.sin(s / sides * 2 * math.pi) * b) for s in range(sides)])
    acc = [0.0]
    for i in range(len(path) - 1): acc.append(acc[-1] + (path[i + 1] - path[i]).length)
    circ = 2 * math.pi * max(radii[0])
    for i in range(len(path) - 1):
        for s in range(sides):
            f = bm.faces.new((rings[i][s], rings[i][(s + 1) % sides], rings[i + 1][(s + 1) % sides], rings[i + 1][s])); f.material_index = mat
            for lp, (uu, vv) in zip(f.loops, ((s, acc[i]), (s + 1, acc[i]), (s + 1, acc[i + 1]), (s, acc[i + 1]))):
                lp[uvl].uv = (vv * k, uu / sides * circ * k)
    if caps:
        f = bm.faces.new(list(reversed(rings[0]))); f.material_index = mat
        f = bm.faces.new(rings[-1]); f.material_index = mat
    return rings


def bevel(o, width=0.004, segments=2, angle=40):
    m = o.modifiers.new('bev', 'BEVEL'); m.width = width; m.segments = segments; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle)
    apply_mods(o)


def apply_mods(o):
    bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = o; o.select_set(True)
    for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    o.select_set(False)


def unwrap_own(o, angle=66):
    """Its own 'UVMap' by smart projection (a part made without UVs)."""
    if 'UVMap' not in o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
    bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT'); o.select_set(False)


def bake(parts, out_glb, tex=1024, weight=None, log=print, quality=(90, 92)):
    """THE BAKE: an 'atlas' UV map packed over every part (texel density × weight[name]), each material baked into it —
    colour, then tangent normals — saved as WebP beside the GLB; the GLB exported with the atlas as its only UV map."""
    sc = bpy.context.scene
    weight = weight or {}
    for o in parts:
        o.data.uv_layers.new(name='atlas'); o.data.uv_layers['atlas'].active = True
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True); s = weight.get(o.name, 1.0); o.scale = (s, s, s)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01, scale_to_bounds=False, correct_aspect=True)
    bpy.ops.uv.pack_islands(margin=0.005)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in parts: o.scale = (1, 1, 1)
    img_c = bpy.data.images.new(os.path.basename(out_glb)[:-4] + '_c', tex, tex, alpha=False)
    img_n = bpy.data.images.new(os.path.basename(out_glb)[:-4] + '_n', tex, tex, alpha=False); img_n.colorspace_settings.name = 'Non-Color'
    def target(img):
        for m in bpy.data.materials:
            if not m.use_nodes: continue
            t = m.node_tree
            n = t.nodes.get('BAKE') or t.nodes.new('ShaderNodeTexImage'); n.name = 'BAKE'; n.image = img
            t.nodes.active = n
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 4
    sc.render.bake.margin = 6; sc.render.bake.use_clear = True
    target(img_c); bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=6)
    target(img_n); bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=6)
    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    sc.view_settings.view_transform = 'Standard'
    def save(img, path, q):
        sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.quality = q
        img.save_render(path, scene=sc)
    out_c, out_n = out_glb[:-4] + '.webp', out_glb[:-4] + '_n.webp'
    save(img_c, out_c, quality[0]); save(img_n, out_n, quality[1])
    log(f'baked {tex}²: {out_c} ({os.path.getsize(out_c) / 1e3:.0f} kB), {out_n} ({os.path.getsize(out_n) / 1e3:.0f} kB)')
    for o in parts:
        me = o.data
        if 'UVMap' in me.uv_layers: me.uv_layers.remove(me.uv_layers['UVMap'])
        me.uv_layers['atlas'].name = 'UVMap'
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_texcoords=True,
                              export_materials='NONE', export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
    n_tris = 0
    for o in parts: o.data.calc_loop_triangles(); n_tris += len(o.data.loop_triangles)
    log(f'wrote {out_glb}: {os.path.getsize(out_glb) / 1e3:.1f} kB, {len(parts)} parts, {n_tris} triangles')
    return img_c, img_n


def preview(parts, img_c, img_n, path, shots, ground=(0.16, 0.2, 0.1), res=(1400, 800)):
    """The look: the parts with the baked atlas (Eevee), from each shot (name, camera location, target)."""
    sc = bpy.context.scene
    mat = bpy.data.materials.new('atlas_preview'); mat.use_nodes = True; t = mat.node_tree; b = t.nodes['Principled BSDF']
    ti = t.nodes.new('ShaderNodeTexImage'); ti.image = img_c; t.links.new(ti.outputs['Color'], b.inputs['Base Color'])
    tn = t.nodes.new('ShaderNodeTexImage'); tn.image = img_n
    nm = t.nodes.new('ShaderNodeNormalMap'); t.links.new(tn.outputs['Color'], nm.inputs['Color']); t.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.7
    for o in parts: o.data.materials.clear(); o.data.materials.append(mat)
    bpy.ops.mesh.primitive_plane_add(size=30); pl = bpy.context.object
    pm = bpy.data.materials.new('ground'); pm.use_nodes = True; pm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*ground, 1); pl.data.materials.append(pm)
    sc.render.engine = next((e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE') if e in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]))
    vts = [v.identifier for v in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items]
    sc.view_settings.view_transform = 'AgX' if 'AgX' in vts else 'Filmic'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), 0, math.radians(35)); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 40
    sc.render.resolution_x, sc.render.resolution_y = res
    os.makedirs(path, exist_ok=True)
    for name, loc, tgt in shots:
        cam.location = loc; cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(path, f'{name}.png'); bpy.ops.render.render(write_still=True)


def far_lod(o, target, min_size=0.3, suffix='__far'):
    """A FAR copy of object o (its AO / paint in the vertices kept): the small loose parts dropped (each connected
    piece whose box is under min_size m across — nails, trim, a hinge: nothing at 70 m), then decimated (collapse) to
    about `target` triangles. Named o.name + suffix; returns it."""
    me = o.data.copy(); lo = o.copy(); lo.data = me; lo.name = o.name + suffix
    bpy.context.scene.collection.objects.link(lo)
    bm = bmesh.new(); bm.from_mesh(me)
    seen = set(); drop = []
    for v in bm.verts:
        if v.index in seen: continue
        stack = [v]; isl = []
        seen.add(v.index)
        while stack:
            a = stack.pop(); isl.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen: seen.add(b.index); stack.append(b)
        xs = [p.co.x for p in isl]; ys = [p.co.y for p in isl]; zs = [p.co.z for p in isl]
        if max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)) < min_size: drop.extend(isl)
    if drop: bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bm.to_mesh(me); bm.free()
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    if n > target:
        m = lo.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = max(0.02, target / n); m.use_collapse_triangulate = True
        bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
        bpy.ops.object.modifier_apply(modifier='dec')
    lo.data.calc_loop_triangles()
    return lo
