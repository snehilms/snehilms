"""
Stage worlds — pre-rendered backdrops for the socials stage.

One chamber for every social (stone floor in lit tiers, a stone podium with a
glowing rim, a curved frosted-glass wall, a halo light overhead, haze), and
through the glass a snowy mountain world whose foreground changes per social.
After the igloo.inc stage and hero: the room carries the polish, the frosted
glass turns each world into soft silhouettes.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P art/scripts/stage_world.py -- \
      --world github --scale 0.35 --samples 48            # preview
  ... --scale 1 --samples 256 --publish                    # final -> public/stage/

The camera reproduces StageCanvas exactly (three.js fov 35° vertical, position
(0, 1.2, 9) looking at (0, 0.05, 0); three's y-up maps to Blender's z-up as
(x, y, z) -> (x, -z, y)). The plate is 2.4:1 and shown on a plane locked to
the camera at the same vertical fov, so it registers with the live bead mark
at any aspect. The live mark floats over the podium: keep its column clear.

Sources (CC0, Poly Haven, in art/src/, not versioned): snow_field_2k.hdr,
grey_cartago_01_*, snow_field_aerial_*, mountainside/ (scanned slope).
"""

import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'art', 'src')

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default):
    if f'--{name}' in args:
        return type(default)(args[args.index(f'--{name}') + 1])
    return default


WORLD = arg('world', 'github')
SCALE = arg('scale', 1.0)
SAMPLES = arg('samples', 256)
OUT = arg('out', os.path.join(ROOT, 'art', 'out', f'{WORLD}.png'))

PEDESTAL_TOP = -1.155  # must match StageCanvas layout() at landscape sizes
FLOOR = -1.5
WALL_RADIUS = 10.5
GLOW = (0.86, 0.93, 1.0, 1)
DISTANCE_FOG = (0.62, 0.66, 0.73, 1)  # what far things fade to


# --------------------------------------------------------------------------
# Scene, camera, sky
# --------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = 'GPU'
    except Exception as e:  # CPU still renders, just slower
        print('GPU unavailable:', e)
    c = scene.cycles
    c.samples = SAMPLES
    c.use_denoising = True
    c.max_bounces = 12
    c.transmission_bounces = 12
    c.glossy_bounces = 6
    c.volume_bounces = 1
    c.caustics_reflective = False
    c.caustics_refractive = False
    # The valley mist varies with height, so it is ray-marched. It is smooth
    # and hundreds of units deep: coarse steps are invisible, and fine ones
    # made GPU passes long enough for macOS's watchdog to kill the render.
    c.volume_step_rate = 6.0
    c.volume_max_steps = 256
    c.use_auto_tile = True
    c.tile_size = 256
    scene.render.resolution_x = int(3840 * SCALE)
    scene.render.resolution_y = int(1600 * SCALE)
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    scene.view_settings.exposure = -0.15
    return scene


def camera(scene):
    data = bpy.data.cameras.new('Stage')
    data.sensor_fit = 'VERTICAL'
    data.angle_y = math.radians(35)
    data.clip_end = 600
    cam = bpy.data.objects.new('Stage', data)
    scene.collection.objects.link(cam)
    cam.location = (0, -9, 1.2)
    cam.rotation_euler = (Vector((0, 0, 0.05)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam


def see_through(nt, lp):
    """1 for rays the viewer actually sees: camera rays and rays that have
    passed through glass. Fog gated on this never dims the lighting."""
    m = nt.nodes.new('ShaderNodeMath')
    m.operation = 'MAXIMUM'
    nt.links.new(lp.outputs['Is Camera Ray'], m.inputs[0])
    nt.links.new(lp.outputs['Is Transmission Ray'], m.inputs[1])
    return m


def sky(scene):
    """Snow Field HDRI lights everything; the visible sky is a soft overcast."""
    w = bpy.data.worlds.new('Sky')
    scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value[2] = math.radians(150)
    nt.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(SRC, 'snow_field_2k.hdr'))
    nt.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
    light = nt.nodes.new('ShaderNodeBackground')
    light.inputs['Strength'].default_value = 1.1
    nt.links.new(env.outputs['Color'], light.inputs['Color'])

    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Generated'], sep.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    # At the horizon the sky is exactly the distance-fog colour, so far snow
    # and sky meet without a step (a darker sky read as a hard line through
    # the frosted glass); it only lightens higher up.
    ramp.color_ramp.elements[0].position = 0.5
    ramp.color_ramp.elements[0].color = DISTANCE_FOG
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (0.76, 0.79, 0.84, 1)
    seen = nt.nodes.new('ShaderNodeBackground')
    nt.links.new(ramp.outputs['Color'], seen.inputs['Color'])

    lp = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(see_through(nt, lp).outputs['Value'], mix.inputs['Fac'])
    nt.links.new(light.outputs['Background'], mix.inputs[1])
    nt.links.new(seen.outputs['Background'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------

def principled(name, **inputs):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    for k, v in inputs.items():
        bsdf.inputs[k].default_value = v
    return m, bsdf


def image(nt, file, mapping, non_color=True, box=False):
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(os.path.join(SRC, file), check_existing=True)
    if non_color:
        t.image.colorspace_settings.name = 'Non-Color'
    if box:  # tri-planar: no smearing down vertical faces
        t.projection = 'BOX'
        t.projection_blend = 0.25
    nt.links.new(mapping.outputs['Vector'], t.inputs['Vector'])
    return t


def mapped(nt, scale, source='Object'):
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(coord.outputs[source], mapping.inputs['Vector'])
    return mapping


def stone_material(name='Stone', scale=0.18, gloss=0.55):
    """Grey Cartago, honed: veined grey stone with a soft polish."""
    m, bsdf = principled(name)
    nt = m.node_tree
    mp = mapped(nt, scale)
    diff = image(nt, 'grey_cartago_01_diff_2k.jpg', mp, non_color=False, box=True)
    # Strip the scan's rust: keep the veining, lose the warmth.
    grey = nt.nodes.new('ShaderNodeHueSaturation')
    grey.inputs['Saturation'].default_value = 0.12
    grey.inputs['Value'].default_value = 1.25
    nt.links.new(diff.outputs['Color'], grey.inputs['Color'])
    cool = nt.nodes.new('ShaderNodeMixRGB')
    cool.blend_type = 'MULTIPLY'
    cool.inputs['Fac'].default_value = 0.4
    cool.inputs['Color2'].default_value = (0.78, 0.83, 0.92, 1)
    nt.links.new(grey.outputs['Color'], cool.inputs['Color1'])
    nt.links.new(cool.outputs['Color'], bsdf.inputs['Base Color'])
    rough = image(nt, 'grey_cartago_01_rough_2k.jpg', mp, box=True)
    polish = nt.nodes.new('ShaderNodeMath')
    polish.operation = 'MULTIPLY'
    polish.inputs[1].default_value = gloss
    nt.links.new(rough.outputs['Color'], polish.inputs[0])
    nt.links.new(polish.outputs['Value'], bsdf.inputs['Roughness'])
    nor = image(nt, 'grey_cartago_01_nor_gl_2k.jpg', mp, box=True)
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 0.5
    nt.links.new(nor.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Coat Weight'].default_value = 0.25
    bsdf.inputs['Coat Roughness'].default_value = 0.12
    return m


def snow_layer(nt, bsdf, mapping, base_color_socket=None, up_from=0.35, up_to=0.7):
    """Snow over whatever the material was: wherever the surface faces up
    (plus noise) it turns to aerial-scan snow with a little subsurface."""
    col = image(nt, 'snow_field_aerial_col_4k.jpg', mapping, non_color=False)
    bright = nt.nodes.new('ShaderNodeMixRGB')
    bright.inputs['Fac'].default_value = 0.55
    bright.inputs['Color2'].default_value = (0.88, 0.9, 0.95, 1)
    nt.links.new(col.outputs['Color'], bright.inputs['Color1'])

    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 3.0
    noise.inputs['Detail'].default_value = 6.0
    jitter = nt.nodes.new('ShaderNodeMath')
    jitter.operation = 'MULTIPLY_ADD'
    jitter.inputs[1].default_value = 0.35
    jitter.inputs[2].default_value = -0.17
    nt.links.new(noise.outputs['Fac'], jitter.inputs[0])
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(sep.outputs['Z'], add.inputs[0])
    nt.links.new(jitter.outputs['Value'], add.inputs[1])
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = up_from
    ramp.inputs['From Max'].default_value = up_to
    nt.links.new(add.outputs['Value'], ramp.inputs['Value'])

    mix = nt.nodes.new('ShaderNodeMixRGB')
    nt.links.new(ramp.outputs['Result'], mix.inputs['Fac'])
    if base_color_socket is not None:
        nt.links.new(base_color_socket, mix.inputs['Color1'])
    else:
        mix.inputs['Color1'].default_value = bsdf.inputs['Base Color'].default_value
    nt.links.new(bright.outputs['Color'], mix.inputs['Color2'])
    nt.links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])

    rough = nt.nodes.new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value = bsdf.inputs['Roughness'].default_value
    rough.inputs['To Max'].default_value = 0.85
    nt.links.new(ramp.outputs['Result'], rough.inputs['Value'])
    nt.links.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
    bsdf.inputs['Subsurface Weight'].default_value = 0.08
    bsdf.inputs['Subsurface Radius'].default_value = (0.5, 0.6, 0.8)
    return ramp


def snow_material(scale=0.05):
    m, bsdf = principled('Snow', **{'Roughness': 0.85})
    nt = m.node_tree
    mp = mapped(nt, scale)
    col = image(nt, 'snow_field_aerial_col_4k.jpg', mp, non_color=False)
    bright = nt.nodes.new('ShaderNodeMixRGB')
    bright.inputs['Fac'].default_value = 0.35
    bright.inputs['Color2'].default_value = (0.86, 0.89, 0.94, 1)
    nt.links.new(col.outputs['Color'], bright.inputs['Color1'])
    nt.links.new(bright.outputs['Color'], bsdf.inputs['Base Color'])
    nor = image(nt, 'snow_field_aerial_nor_gl_4k.jpg', mp)
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 0.9
    nt.links.new(nor.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Subsurface Weight'].default_value = 0.12
    bsdf.inputs['Subsurface Radius'].default_value = (0.5, 0.6, 0.8)
    return m


def emission(name, strength, color=GLOW):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = color
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def frosted_glass():
    m, bsdf = principled('Frost', **{
        'Base Color': (0.93, 0.96, 1.0, 1),
        'Roughness': 0.28,
        'IOR': 1.45,
        'Transmission Weight': 1.0,
    })
    # Uneven frost: a soft noise varies how blurred the glass is.
    nt = m.node_tree
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.6
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['To Min'].default_value = 0.08
    ramp.inputs['To Max'].default_value = 0.18
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Value'])
    nt.links.new(ramp.outputs['Result'], bsdf.inputs['Roughness'])
    return m


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def active():
    return bpy.context.active_object


def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def ring(name, r_outer, r_inner, z, mat, segments=192):
    """A flat annulus: an inlaid line on a horizontal face."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    outer, inner = [], []
    for k in range(segments):
        a = k / segments * math.tau
        outer.append(bm.verts.new((math.cos(a) * r_outer, math.sin(a) * r_outer, z)))
        inner.append(bm.verts.new((math.cos(a) * r_inner, math.sin(a) * r_inner, z)))
    for k in range(segments):
        n = (k + 1) % segments
        bm.faces.new((outer[k], outer[n], inner[n], inner[k]))
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def drum(name, radius, top, height, mat, segments=192, bevel=0.02):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=radius, depth=height, location=(0, 0, top - height / 2))
    obj = active()
    obj.name = name
    b = obj.modifiers.new('bevel', 'BEVEL')
    b.width = bevel
    b.segments = 3
    b.limit_method = 'ANGLE'
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def band(name, radius, z, height, mat, segments=192):
    """An open cylindrical band: a glowing riser or rim."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=radius, depth=height,
                                        end_fill_type='NOTHING', location=(0, 0, z))
    obj = active()
    obj.name = name
    obj.data.materials.append(mat)
    return obj


# --------------------------------------------------------------------------
# The chamber (shared by every world)
# --------------------------------------------------------------------------

def chamber():
    stone = stone_material()
    stone_dark = stone_material('StoneDark', scale=0.25, gloss=0.7)
    glow = emission('Glow', 6.0)
    glow_soft = emission('GlowSoft', 2.2)
    riser = emission('Riser', 9.0)

    # Stepped floor: tiers that descend outward, each riser lit.
    tiers = [(3.3, FLOOR), (5.4, FLOOR - 0.08), (8.0, FLOOR - 0.16), (WALL_RADIUS, FLOOR - 0.24)]
    for i, (r, top) in enumerate(tiers):
        drum(f'Tier{i}', r, top, 0.6, stone if i % 2 == 0 else stone_dark, bevel=0.012)
    for i, (r, top) in enumerate(tiers[:-1]):
        band(f'Riser{i}', r + 0.004, top - 0.04, 0.05, riser)

    # Podium: honed stone drum, a glowing band under its lip, inlaid rings.
    drum('Podium', 1.5, PEDESTAL_TOP, PEDESTAL_TOP - FLOOR + 0.02, stone, bevel=0.03)
    band('PodiumRim', 1.505, PEDESTAL_TOP - 0.06, 0.035, glow)
    ring('PodiumInlay', 1.06, 1.04, PEDESTAL_TOP + 0.001, glow_soft)
    ring('PodiumInlay2', 0.7, 0.69, PEDESTAL_TOP + 0.001, emission('Faint', 0.8))

    # Frosted glass wall all round, with slim mullions and a base curb.
    bpy.ops.mesh.primitive_cylinder_add(vertices=256, radius=WALL_RADIUS, depth=16, end_fill_type='NOTHING',
                                        location=(0, 0, FLOOR - 0.24 + 8))
    wall = active()
    wall.name = 'GlassWall'
    s = wall.modifiers.new('thick', 'SOLIDIFY')
    s.thickness = 0.06
    wall.data.materials.append(frosted_glass())
    frame, _ = principled('Frame', **{'Base Color': (0.32, 0.35, 0.4, 1), 'Roughness': 0.4, 'Metallic': 0.8})
    for k in range(24):
        a = k / 24 * math.tau
        bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * (WALL_RADIUS - 0.06),
                                                          math.sin(a) * (WALL_RADIUS - 0.06), FLOOR + 7))
        m = active()
        m.scale = (0.06, 0.06, 17)
        m.rotation_euler = (0, 0, a)
        m.data.materials.append(frame)
    drum('Curb', WALL_RADIUS + 0.05, FLOOR - 0.24 + 0.22, 0.3, stone_dark)

    # Halo: the light ring overhead, its far arc just inside the top of frame.
    bpy.ops.mesh.primitive_torus_add(major_radius=6.4, minor_radius=0.05, major_segments=256, minor_segments=12,
                                     location=(0, 2.5, 4.1))
    active().data.materials.append(emission('HaloLight', 14.0))

    # The containment cage: a triangulated cylinder round the mark (rows
    # offset by half a step, so every cell is a triangle), back half only:
    # the front half would rule lines across the live mark.
    import bmesh
    me = bpy.data.meshes.new('Cage')
    bm = bmesh.new()
    cols, rows, radius, height = 22, 7, 1.8, 3.4
    grid = []
    for r in range(rows + 1):
        z = PEDESTAL_TOP + 0.05 + height * r / rows
        shift = 0.5 * (r % 2)
        ring_v = []
        for k in range(cols):
            a = (k + shift) / cols * math.tau
            ring_v.append(bm.verts.new((math.cos(a) * radius, math.sin(a) * radius, z)))
        grid.append(ring_v)
    for r in range(rows):
        lo, hi = grid[r], grid[r + 1]
        for k in range(cols):
            n = (k + 1) % cols
            if r % 2 == 0:
                bm.faces.new((lo[k], lo[n], hi[k]))
                bm.faces.new((lo[n], hi[n], hi[k]))
            else:
                bm.faces.new((lo[k], hi[n], hi[k]))
                bm.faces.new((lo[k], lo[n], hi[n]))
    back = [f for f in bm.faces if f.calc_center_median().y < -0.25]
    bmesh.ops.delete(bm, geom=back, context='FACES')
    bm.to_mesh(me)
    bm.free()
    cage = bpy.data.objects.new('Cage', me)
    bpy.context.scene.collection.objects.link(cage)
    wire = cage.modifiers.new('wire', 'WIREFRAME')
    wire.thickness = 0.005
    cage.data.materials.append(emission('CageLight', 0.45))

    # Haze inside the room: real scatter, so the lit edges bloom into it.
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=WALL_RADIUS - 0.1, depth=9, location=(0, 0, FLOOR + 4.4))
    haze = active()
    haze.name = 'Haze'
    hm = bpy.data.materials.new('Haze')
    hm.use_nodes = True
    nt = hm.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (0.9, 0.93, 0.97, 1)
    vol.inputs['Density'].default_value = 0.018
    nt.links.new(vol.outputs['Volume'], out.inputs['Volume'])
    haze.data.materials.append(hm)
    haze.visible_shadow = False


# --------------------------------------------------------------------------
# Outside: snowfield, mountains, distance fog
# --------------------------------------------------------------------------

def outside():
    snow = snow_material()
    bpy.ops.mesh.primitive_plane_add(size=900, location=(0, 300, FLOOR - 0.3))
    g = active()
    g.name = 'Snowfield'
    sub = g.modifiers.new('sub', 'SUBSURF')
    sub.subdivision_type = 'SIMPLE'
    sub.levels = 8
    sub.render_levels = 8
    tex = bpy.data.textures.new('drifts', 'CLOUDS')
    tex.noise_scale = 9.0
    d = g.modifiers.new('drifts', 'DISPLACE')
    d.texture = tex
    d.strength = 1.6
    d.mid_level = 0.55
    d.texture_coords = 'GLOBAL'
    g.data.materials.append(snow)
    apply_all(g)
    # The drifts must not come up through the room's floor.
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(g.data)
    inside = [v for v in bm.verts if (v.co.x ** 2 + (v.co.y + 300) ** 2) < (WALL_RADIUS + 1.0) ** 2]
    bmesh.ops.delete(bm, geom=inside, context='VERTS')
    bm.to_mesh(g.data)
    bm.free()
    bpy.ops.object.shade_smooth()

    # Mountains: a ridged-multifractal range far out, under snow where the
    # slopes lie down and the scanned rock (Poly Haven Mountainside) where
    # they are too steep to hold it.
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 470, FLOOR - 4))
    rng = active()
    rng.name = 'Range'
    rng.scale = (1400, 260, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sub = rng.modifiers.new('sub', 'SUBSURF')
    sub.subdivision_type = 'SIMPLE'
    sub.levels = 9
    sub.render_levels = 9
    apply_all(rng)
    # Heights taper to nothing at the sheet's back and sides: a displaced
    # sheet's cut edge reads as one dead-straight horizon, even through frost.
    falloff = rng.vertex_groups.new(name='falloff')
    for v in rng.data.vertices:
        y = v.co.y + 130             # local: 0 at the front edge, 260 at the back
        x = abs(v.co.x)
        w = min(1.0, y / 40) * min(1.0, max(0.0, (260 - y) / 150)) * min(1.0, max(0.0, (700 - x) / 200))
        w = w * w * (3 - 2 * w)
        falloff.add([v.index], max(0.0, w), 'REPLACE')
    ridge = bpy.data.textures.new('ridges', 'MUSGRAVE')
    ridge.musgrave_type = 'RIDGED_MULTIFRACTAL'
    ridge.noise_scale = 140.0  # metres per ridge, roughly
    ridge.octaves = 7
    ridge.lacunarity = 2.1
    ridge.offset = 0.9
    ridge.gain = 1.4
    disp = rng.modifiers.new('ridges', 'DISPLACE')
    disp.texture = ridge
    disp.texture_coords = 'GLOBAL'
    disp.strength = 56
    disp.mid_level = 0.0
    disp.vertex_group = 'falloff'
    apply_all(rng)
    bpy.ops.object.shade_smooth()

    rock = bpy.data.materials.new('SnowRock')
    rock.use_nodes = True
    nt = rock.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.8
    rmp = mapped(nt, 0.012)
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(os.path.join(SRC, 'mountainside', 'textures', 'mountainside_diff_2k.jpg'))
    t.projection = 'BOX'
    t.projection_blend = 0.3
    nt.links.new(rmp.outputs['Vector'], t.inputs['Vector'])
    dark = nt.nodes.new('ShaderNodeHueSaturation')
    dark.inputs['Saturation'].default_value = 0.2
    dark.inputs['Value'].default_value = 0.7
    nt.links.new(t.outputs['Color'], dark.inputs['Color'])
    snow_layer(nt, bsdf, mapped(nt, 0.01), base_color_socket=dark.outputs['Color'], up_from=0.45, up_to=0.7)
    rng.data.materials.append(rock)

    # Distance: what the viewer sees (directly or through the glass) fades to
    # the overcast; light paths are untouched, so nothing goes dim.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 340, 80))
    box = active()
    box.name = 'Distance'
    box.scale = (900, 700, 200)
    fm = bpy.data.materials.new('Distance')
    fm.use_nodes = True
    nt = fm.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    lp = nt.nodes.new('ShaderNodeLightPath')
    # Valley mist: dense along the ground, thinning with height, so the long
    # straight line where the snowfield meets the mountains' feet is buried
    # and only the ridges rise out of it (as in the igloo.inc hero).
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    pos = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], pos.inputs['Vector'])
    lift = nt.nodes.new('ShaderNodeMath')
    lift.operation = 'MULTIPLY_ADD'
    lift.inputs[1].default_value = -1 / 14.0
    lift.inputs[2].default_value = (FLOOR + 1.0) / 14.0
    nt.links.new(pos.outputs['Z'], lift.inputs[0])
    low = nt.nodes.new('ShaderNodeMath')
    low.operation = 'EXPONENT'
    nt.links.new(lift.outputs['Value'], low.inputs[0])
    mist = nt.nodes.new('ShaderNodeMath')
    mist.operation = 'MULTIPLY_ADD'
    mist.inputs[1].default_value = 0.0065  # extra density at ground level
    mist.inputs[2].default_value = 0.0018  # thin haze everywhere
    nt.links.new(low.outputs['Value'], mist.inputs[0])
    clamp = nt.nodes.new('ShaderNodeMath')
    clamp.operation = 'MINIMUM'
    clamp.inputs[1].default_value = 0.03
    nt.links.new(mist.outputs['Value'], clamp.inputs[0])
    dens = nt.nodes.new('ShaderNodeMath')
    dens.operation = 'MULTIPLY'
    nt.links.new(see_through(nt, lp).outputs['Value'], dens.inputs[0])
    nt.links.new(clamp.outputs['Value'], dens.inputs[1])
    ab = nt.nodes.new('ShaderNodeVolumeAbsorption')
    ab.inputs['Color'].default_value = (0, 0, 0, 1)
    nt.links.new(dens.outputs['Value'], ab.inputs['Density'])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = DISTANCE_FOG
    nt.links.new(dens.outputs['Value'], em.inputs['Strength'])
    add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(ab.outputs['Volume'], add.inputs[0])
    nt.links.new(em.outputs['Emission'], add.inputs[1])
    nt.links.new(add.outputs['Shader'], out.inputs['Volume'])
    box.data.materials.append(fm)
    box.visible_shadow = False


# --------------------------------------------------------------------------
# Worlds outside the glass
# --------------------------------------------------------------------------

def container(location, rot, tint, cap=True):
    """A 20ft container, ribbed, with snow on its roof and in its ribs."""
    m, bsdf = principled(f'Box{len(bpy.data.materials)}', **{'Base Color': tint, 'Roughness': 0.6, 'Metallic': 0.55})
    nt = m.node_tree
    coord = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X'
    wave.inputs['Scale'].default_value = 7.0
    nt.links.new(coord.outputs['Object'], wave.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.6
    nt.links.new(wave.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    snow_layer(nt, bsdf, mapped(nt, 0.4), up_from=0.55, up_to=0.8)

    w, d, h = 6.1, 2.45, 2.6
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    c = active()
    c.scale = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)  # round in metres, not unit-cube space
    c.rotation_euler = (0, 0, math.radians(rot))
    c.modifiers.new('bevel', 'BEVEL').width = 0.04
    c.data.materials.append(m)

    if location[2] < FLOOR + 2.0:  # ground level: a drift against one side
        # A drift banked against one long side.
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=location)
        drift = active()
        drift.scale = (w * 0.6, 1.8, 0.45)
        off = Vector((0, -d * 0.55, 0))
        off.rotate(c.rotation_euler)
        drift.location = (location[0] + off.x, location[1] + off.y, location[2] - h / 2 - 0.12)
        drift.rotation_euler = c.rotation_euler
        drift.data.materials.append(bpy.data.materials['Snow'])
        bpy.ops.object.shade_smooth()

    if not cap:
        return c

    # Snow cap: a soft slab on the roof, slightly overhanging.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(location[0], location[1], location[2] + h / 2 + 0.12))
    cap = active()
    cap.scale = (w * 1.01, d * 1.04, 0.22)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cap.rotation_euler = (0, 0, math.radians(rot))
    bev = cap.modifiers.new('round', 'BEVEL')
    bev.width = 0.1
    bev.segments = 5
    cap.modifiers.new('dense', 'SUBSURF').subdivision_type = 'SIMPLE'
    cap.modifiers['dense'].levels = 3
    tex = bpy.data.textures.new('capn', 'CLOUDS')
    tex.noise_scale = 0.8
    dd = cap.modifiers.new('lumps', 'DISPLACE')
    dd.texture = tex
    dd.strength = 0.06
    cap.data.materials.append(bpy.data.materials['Snow'])
    bpy.ops.object.shade_smooth()

    return c


def world_github():
    """A container yard drifted over with snow, seen through the frost."""
    slate = (0.12, 0.18, 0.26, 1)
    rust = (0.22, 0.17, 0.15, 1)
    steel = (0.2, 0.23, 0.27, 1)
    teal = (0.1, 0.2, 0.22, 1)
    h = 2.6
    base = FLOOR - 0.3 + h / 2 - 0.2
    yard = [
        ((-14, 30, base), 8, slate), ((-13.5, 30.4, base + h), 12, steel),
        ((-22, 38, base), -14, rust), ((-5, 42, base), 4, teal),
        ((13, 29, base), -10, steel), ((13.5, 28.8, base + h), -6, slate),
        ((22, 37, base), 18, teal), ((6, 48, base), -24, rust),
        ((-30, 52, base), 30, steel), ((30, 54, base), -20, slate),
        ((-2, 58, base), 12, steel), ((-1.6, 58.3, base + h), 8, rust),
    ]
    stacked = {(round(l[0]), round(l[1])) for l, _, _ in yard if l[2] > base + 1}
    for loc, rot, tint in yard:
        under = loc[2] < base + 1 and any(abs(loc[0] - x) < 1.5 and abs(loc[1] - y) < 1.5 for x, y in stacked)
        container(loc, rot, tint, cap=not under)


WORLDS = {'github': world_github}


def main():
    scene = reset()
    camera(scene)
    sky(scene)
    if '--no-chamber' not in args:  # debug: look at the world without the room
        chamber()
    outside()
    WORLDS[WORLD]()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    scene.render.filepath = OUT
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    if '--publish' in args:
        web = os.path.join(ROOT, 'public', 'stage', f'{WORLD}.webp')
        os.makedirs(os.path.dirname(web), exist_ok=True)
        scene.render.image_settings.file_format = 'WEBP'
        scene.render.image_settings.quality = 82
        bpy.data.images['Render Result'].save_render(filepath=web)
        print('PUBLISHED', web)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'art', 'out', f'{WORLD}.blend'))
    print('WROTE', OUT)


main()
