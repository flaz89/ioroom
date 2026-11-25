"""
Joins a model into ONE body mesh (+ its move_ parts) and exports a GLB for the catalog optimizer:

  Blender -b --factory-startup --python scripts/blender/join_export.py -- <in.glb|gltf|fbx|obj|blend> <out.glb> [scale]

- imports the file (a .blend is opened as is), optional uniform scale (e.g. 0.001 for a CAD in mm);
- parents cleared keeping world transforms, empties/cameras/lights deleted;
- every mesh NOT named move_... is joined into one object named after <out.glb>; move_ parts stay
  separate with their `slide` custom property (exported as node extras, read by loadModel.mergeParts);
- rotation and scale of the body applied, unless a joined object had a NEGATIVE scale: then it is left as
  is and NEGATIVE_SCALE is printed (applying it bends InstaLOD custom normals; ask before going on);
- prints MATERIAL names (variant keys) and the body SIZE in meters (x width, z height, y depth in Blender).
"""
import bpy, sys, os

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], os.path.abspath(args[1])
scale = float(args[2]) if len(args) > 2 else 1.0
name = os.path.splitext(os.path.basename(out))[0]

ext = os.path.splitext(src)[1].lower()
if ext == '.blend':
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=src)
    elif ext == '.fbx': bpy.ops.import_scene.fbx(filepath=src)
    elif ext == '.obj': bpy.ops.wm.obj_import(filepath=src)
    else: raise SystemExit(f'Unsupported input {ext}')

scene = bpy.context.scene
for o in scene.objects:
    if o.parent:
        m = o.matrix_world.copy(); o.parent = None; o.matrix_world = m
for o in [o for o in scene.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o)
if scale != 1.0:
    for o in scene.objects:
        o.location *= scale; o.scale *= scale

meshes = [o for o in scene.objects if o.type == 'MESH']
body = [o for o in meshes if not o.name.startswith('move_')]
if not body: raise SystemExit('No body mesh found')
negative = [o.name for o in body if o.matrix_world.determinant() < 0]
for n in negative: print('NEGATIVE_SCALE', n)

bpy.ops.object.select_all(action='DESELECT')
for o in body: o.select_set(True)
bpy.context.view_layer.objects.active = body[0]
if len(body) > 1: bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = obj.data.name = name
if not negative: bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

for o in meshes:
    if o.name.startswith('move_'):
        print('PART', o.name, 'slide', list(o['slide']) if 'slide' in o else 'MISSING')
for m in obj.data.materials: print('MATERIAL', m.name if m else '(empty slot)')
print('SIZE', [round(v, 3) for v in obj.dimensions])

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_extras=True, use_selection=False)
print('EXPORTED', out)
