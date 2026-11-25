"""
One UV atlas + one normal map for a catalog model made of parts with separate UVs and normal maps
(InstaLOD exports: each fabric part has its own 0-1 UVs and normal map, CAD parts untextured).

  Blender -b --factory-startup --python scripts/blender/atlas.py -- <in.glb|in.blend> <out.blend> <out_dir> [size]

- objects with a NEGATIVE scale (mirrored parts) keep it: applying it in Blender bends their custom normals
  (InstaLOD), the app flips their triangles when it bakes the transform (loadModel.mergeParts);
- new UV layer for every mesh: textured parts keep their islands (same texel density, NO rotation, so the
  tangent-space normal map stays valid when its texels are copied); untextured parts (CAD metal, often
  collapsed UVs) are re-unwrapped (smart project); everything packed into 0-1;
- bakes (emission = straight texel copy) the normal maps into <out_dir>/<name>_Normal.png (flat normal on
  untextured parts) and an ID map <name>_ID.png (one color per original material, for Painter masks);
- saves <out.blend> with ONE material (<name>_Mat, the atlas normal) on every object, the atlas as the only
  UV layer, object names and transforms as imported.
"""
import bpy, sys, os, colorsys

args = sys.argv[sys.argv.index('--') + 1:]
src, out_blend, out_dir = args[:3]
out_dir = os.path.abspath(out_dir)  # a cwd-relative image path would not resolve once the .blend is opened
SIZE = int(args[3]) if len(args) > 3 else 4096
name = os.path.splitext(os.path.basename(out_blend))[0]

if src.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
objs = [o for o in scene.objects if o.type == 'MESH']
for o in objs:  # shared meshes would make the packing ambiguous: one mesh per object
    if o.data.users > 1: o.data = o.data.copy()

def normal_node(mat):
    if not mat or not mat.node_tree: return None
    return next((n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
textured = lambda o: any(normal_node(m) for m in o.data.materials)

# 1. atlas UV layer (a copy of the source one), source kept for sampling
for o in objs:
    me = o.data
    if not me.uv_layers: me.uv_layers.new(name='Source')
    me.uv_layers[0].name = 'Source'
    me.uv_layers.active = me.uv_layers['Source']
    atlas = me.uv_layers.new(name='Atlas')
    me.uv_layers.active = atlas

def edit(objects, fn):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    fn()
    bpy.ops.object.mode_set(mode='OBJECT')

plain = [o for o in objs if not textured(o)]
if plain:
    edit(plain, lambda: bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.0))
def pack():
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=False, margin=0.004)
edit(objs, pack)

# 2. bake: emission copies of the source texels into the atlas
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
def image(label, colorspace):
    img = bpy.data.images.new(f'{name}_{label}', SIZE, SIZE, alpha=False)
    img.colorspace_settings.name = colorspace
    img.generated_color = (0.5, 0.5, 1, 1) if label == 'Normal' else (0, 0, 0, 1)
    return img
normal_img, id_img = image('Normal', 'Non-Color'), image('ID', 'sRGB')
mats = sorted({m for o in objs for m in o.data.materials if m}, key=lambda m: m.name)
id_colors = {m.name: colorsys.hsv_to_rgb(i / len(mats), 0.85, 1.0) for i, m in enumerate(mats)}

def setup(mat, target, mode):
    nt = mat.node_tree; N = nt.nodes
    for n in [n for n in N if n.name.startswith('bake_')]: N.remove(n)
    out = next(n for n in N if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    em = N.new('ShaderNodeEmission'); em.name = 'bake_emission'
    src_tex = normal_node(mat)
    if mode == 'normal' and src_tex:
        uv = N.new('ShaderNodeUVMap'); uv.name = 'bake_uv'; uv.uv_map = 'Source'
        nt.links.new(uv.outputs['UV'], src_tex.inputs['Vector'])
        nt.links.new(src_tex.outputs['Color'], em.inputs['Color'])
    else:
        em.inputs['Color'].default_value = (0.5, 0.5, 1, 1) if mode == 'normal' else (*id_colors[mat.name], 1)
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    tgt = N.new('ShaderNodeTexImage'); tgt.name = 'bake_target'; tgt.image = target
    N.active = tgt

for mode, target in (('normal', normal_img), ('id', id_img)):
    for m in mats:
        if not m.use_nodes: m.use_nodes = True
        setup(m, target, mode)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='EMIT', margin=16, use_clear=True)
    target.filepath_raw = os.path.join(out_dir, f'{target.name}.png')
    target.file_format = 'PNG'
    target.save()
    print('BAKED', target.filepath_raw)

# 3. one material, the atlas as the only UV layer
final = bpy.data.materials.new(f'{name}_Mat'); final.use_nodes = True
nt = final.node_tree; bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = normal_img; tex.location = (-600, -300)
nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.location = (-300, -300)
nt.links.new(tex.outputs['Color'], nmap.inputs['Color'])
nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
normal_img.filepath = normal_img.filepath_raw
for o in objs:
    me = o.data
    me.uv_layers.remove(me.uv_layers['Source'])
    me.uv_layers['Atlas'].name = 'UVMap'
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True
    me.materials.clear(); me.materials.append(final)
id_img.filepath = id_img.filepath_raw
for img in list(bpy.data.images):
    if img not in (normal_img, id_img): bpy.data.images.remove(img)
bpy.ops.wm.save_as_mainfile(filepath=out_blend, relative_remap=True)
print('SAVED', out_blend, 'objects', len(objs), 'materials before', len(mats))
