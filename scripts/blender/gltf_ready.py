"""
Makes a textured catalog model ready for the glTF export, in place (Blender keeps the previous file as .blend1):

  Blender -b --factory-startup <file.blend> --python scripts/blender/gltf_ready.py -- [move_name=x,y,z ...]

- `slide` custom properties found on the MESH data are moved to the OBJECT (the exporter writes object
  properties as node extras, where the app reads them); move_name=x,y,z overrides a part's slide;
- ORM / roughness-metallic images set to Non-Color;
- a Mix node multiplying AO into the base color is removed (base color texture straight to the BSDF);
- the R channel of the ORM goes to the "glTF Material Output" group, input Occlusion (glTF occlusion map).
"""
import bpy, sys

overrides = {}
for arg in sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []:
    name, values = arg.split('=')
    overrides[name] = [float(v) for v in values.split(',')]

for o in bpy.data.objects:
    if o.type != 'MESH' or not o.users_collection: continue
    if 'slide' in o.data and 'slide' not in o:
        o['slide'] = list(o.data['slide']); del o.data['slide']
    if o.name in overrides: o['slide'] = overrides[o.name]
    if 'slide' in o: print('SLIDE', o.name, [round(v, 3) for v in o['slide']])

group = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
if not any(i.name == 'Occlusion' for i in group.interface.items_tree):
    group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')

for mat in bpy.data.materials:
    if not mat.users or not mat.node_tree: continue
    nt = mat.node_tree; N = nt.nodes
    bsdf = next((n for n in N if n.type == 'BSDF_PRINCIPLED'), None)
    sep = next((n for n in N if n.type == 'SEPARATE_COLOR' and n.inputs['Color'].is_linked), None)
    if bsdf is None or sep is None: continue
    orm = sep.inputs['Color'].links[0].from_node
    if orm.type == 'TEX_IMAGE' and orm.image: orm.image.colorspace_settings.name = 'Non-Color'
    for mix in [n for n in N if n.type == 'MIX' and n.outputs['Result'].is_linked and any(l.to_node == bsdf for l in n.outputs['Result'].links)]:
        base = next((l.from_node for i in mix.inputs if i.is_linked for l in i.links if l.from_node.type == 'TEX_IMAGE'), None)
        N.remove(mix)
        if base: nt.links.new(base.outputs['Color'], bsdf.inputs['Base Color'])
    gnode = next((n for n in N if n.type == 'GROUP' and n.node_tree == group), None)
    if gnode is None:
        gnode = N.new('ShaderNodeGroup'); gnode.node_tree = group; gnode.label = 'glTF Material Output'
        gnode.location = (sep.location.x + 250, sep.location.y - 250)
    nt.links.new(sep.outputs['Red'], gnode.inputs['Occlusion'])
    print('MATERIAL', mat.name, 'ORM', orm.image.name if orm.type == 'TEX_IMAGE' else None, 'occlusion linked')
bpy.ops.wm.save_mainfile()
print('SAVED', bpy.data.filepath)
