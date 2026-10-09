"""
Ice crystals — pre-rendered project artefacts for the Projects chapter.

Each project is an object frozen in a block of clear ice, path traced in
Cycles: real refraction, frost scattering, trapped air, cracks, a hammered
melt-water surface. Real-time glass cannot do any of that convincingly, so
the crystal is rendered offline as a short sway loop and played on the page
as video. The interaction stays live: the core's triangulated envelope is
exported with the exact camera and per-frame rotation, so the hover mesh the
page draws registers with the rendered core frame for frame.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P art/scripts/crystal_core.py -- \
      --core v8 --still --scale 0.5 --samples 64          # look-dev frame
  ... --core v8 --frames 96 --samples 160                  # sequence -> art/out/crystal/v8/
  ... --core v8 --pack                                     # -> public/crystals/v8.mp4 + .webp + .json

Outputs (public/crystals/):
  <core>.mp4   H.264, colour on top, alpha below (browsers can't decode alpha
               H.264, so it travels as a second picture)
  <core>.webp  first frame with alpha: reduced motion and the poster
  <core>.json  camera, rotation per frame, envelope mesh for the hover wire

Sources (art/src/, not versioned): snow_field_2k.hdr (Poly Haven, CC0);
v8: "Blown 454 cid V8" by Jorma Rysky, CC BY 4.0 (Sketchfab), as
art/src/v8/scene.gltf.
"""

import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'art', 'src')

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default):
    if f'--{name}' in args:
        return type(default)(args[args.index(f'--{name}') + 1])
    return default


CORE = arg('core', 'v8')
SCALE = arg('scale', 1.0)
SAMPLES = arg('samples', 64)
FRAMES = arg('frames', 96)  # rendered frames; the loop plays them there and back
FROM = arg('from', 0)
OUT_DIR = arg('outdir', os.path.join(ROOT, 'art', 'out', 'crystal', CORE))
PUBLIC = os.path.join(ROOT, 'public', 'crystals')

WIDTH, HEIGHT = 1024, 1280
FPS = 20  # 96 frames there and back: a 9.5 s sway
SWAY = math.radians(14)  # half-amplitude of the yaw sway: slow and subtle
TILT = math.radians(1.5)  # a slow nod on x, a quarter period out of phase
CAM_DIST = 7.1
CAM_FOV = math.radians(24)  # vertical
LIGHT_GAIN = arg('gain', 1.0)
COOL = (0.86, 0.93, 1.0)  # the reference's light is glacial, never neutral
ICE_HALF = (0.78, 0.64, 1.08)  # half extents of the block, x y z
CORE_BOX = (1.32, 1.05, 1.8)
CORE_FIT = {'pencil': 0.8, 'orrery': 0.72}  # a long diagonal core reaches the faces before the box does
CRACKS = 0  # crack sheets read as paper at this size; kept for larger cores  # the core is fitted inside this, after its yaw


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        # GPU only. With the CPU enabled too, Cycles splits every frame into
        # horizontal slices between the devices, and the slices come out a
        # shade apart: hard level lines across the ice.
        for d in prefs.devices:
            d.use = d.type == 'METAL'
        scene.cycles.device = 'GPU'
    except Exception as e:
        print('GPU unavailable:', e)
    c = scene.cycles
    c.samples = SAMPLES
    c.adaptive_threshold = 0.015
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    c.max_bounces = 32
    c.transmission_bounces = 24  # ice, bubbles and cracks stack up fast
    c.glossy_bounces = 8
    c.diffuse_bounces = 3
    c.volume_bounces = 2
    c.transparent_max_bounces = 16
    c.caustics_reflective = True
    c.caustics_refractive = True
    c.blur_glossy = 0.6
    c.sample_clamp_indirect = 6.0
    c.volume_step_rate = 2.0
    # One tile for the whole frame: per-tile denoising left a hard tonal step
    # at every 512 px seam (the "horizontal bands" that looked like the
    # environment). The frame fits in GPU memory whole.
    c.use_auto_tile = False
    scene.render.film_transparent = True
    scene.render.resolution_x = int(WIDTH * SCALE)
    scene.render.resolution_y = int(HEIGHT * SCALE)
    scene.render.fps = FPS
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - High Contrast'
    except TypeError:
        pass
    scene.view_settings.exposure = -0.8
    return scene


def camera(scene):
    data = bpy.data.cameras.new('Crystal')
    data.sensor_fit = 'VERTICAL'
    data.angle_y = CAM_FOV
    data.clip_start = 0.1
    data.clip_end = 100
    cam = bpy.data.objects.new('Crystal', data)
    scene.collection.objects.link(cam)
    cam.location = (0, -CAM_DIST, 0.35)
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    return cam


def world(scene):
    """The fog chamber the page lives in, as light: a pale overcast vault, a
    bright horizon band, a slate floor. The floor is what the lower facets
    pick up, and dark facets are what make clear ice read as solid on a pale
    page. The snowfield HDRI is mixed in desaturated for natural variation."""
    w = bpy.data.worlds.new('Chamber')
    scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 1.0

    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    # A world's Generated coordinate is the view direction, -1..1: remap so
    # the ramp's 0.5 is the horizon.
    remap = nt.nodes.new('ShaderNodeMapRange')
    remap.inputs['From Min'].default_value = -1.0
    remap.inputs['From Max'].default_value = 1.0
    nt.links.new(sep.outputs['Z'], remap.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(remap.outputs['Result'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    # Generated z: 0.5 is the horizon, 0.25 is 30 degrees down. Straight
    # through the ice the camera sees the pale fog it will sit in on the
    # page; only steeply refracted rays find the dark floor.
    # One broad gradient, no stripes: a narrow horizon strip refracts into
    # hard horizontal bands across the block.
    els[0].position, els[0].color = 0.0, (0.02, 0.024, 0.032, 1)
    els[1].position, els[1].color = 1.0, (0.78, 0.82, 0.88, 1)
    # Darker than the page on purpose: in the reference the ice sits a
    # shade below the fog around it, and the highlights do the lifting.
    for pos, col in [(0.22, (0.025, 0.03, 0.04, 1)),
                     (0.44, (0.2, 0.22, 0.26, 1)),
                     (0.56, (0.56, 0.6, 0.66, 1)),
                     (0.75, (0.7, 0.74, 0.8, 1))]:
        e = els.new(pos)
        e.color = col

    # The snowfield HDRI's dark mountain line sits on the horizon and refracts
    # into hard bands across the block; it stays out unless asked for.
    hdr_path = os.path.join(SRC, 'snow_field_2k.hdr')
    if '--hdri' in args and os.path.exists(hdr_path):
        env = nt.nodes.new('ShaderNodeTexEnvironment')
        env.image = bpy.data.images.load(hdr_path)
        hsv = nt.nodes.new('ShaderNodeHueSaturation')
        hsv.inputs['Saturation'].default_value = 0.1
        nt.links.new(env.outputs['Color'], hsv.inputs['Color'])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 0.55
        nt.links.new(ramp.outputs['Color'], mix.inputs[6])
        nt.links.new(hsv.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], bg.inputs['Color'])
    else:
        nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs[0])


def area(name, location, target, size, energy, color=(1, 1, 1), shape='RECTANGLE', size_y=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.color = color
    data.shape = shape
    data.size = size
    if size_y is not None:
        data.size_y = size_y
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    # Lights shape the ice; they must not appear as hard cards in reflections
    # bigger than the reference's soft windows.
    return obj


def lights():
    # Key: a big soft window high, front-right.
    area('Key', (4.2, -4.0, 5.2), (0, 0, 0.2), 2.2, 1900, (1.0, 0.99, 0.97))
    # Two tall strips behind left and right: the bright edge lines on ice.
    area('RimL', (-3.8, 2.6, 0.8), (0, 0, 0.2), 0.35, 520, (0.92, 0.96, 1.0), size_y=5)
    area('RimR', (3.6, 3.0, 1.6), (0, 0, 0.2), 0.35, 380, (0.95, 0.97, 1.0), size_y=5)
    # Black flags either side, as a product photographer would set them for
    # glass: refracted and reflected, they give the faces their dark tones.
    # Invisible to the camera, so the film stays transparent around the ice.
    for name, loc, rot in (('FlagL', (-1.7, 2.2, 0.0), (math.radians(90), 0, math.radians(-25))),
                           ('FlagR', (1.8, 2.4, 0.0), (math.radians(90), 0, math.radians(30)))):
        bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
        f = bpy.context.active_object
        f.name = name
        f.scale = (1.6, 4.0, 1)
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (0.012, 0.014, 0.018, 1)
        b.inputs['Roughness'].default_value = 0.9
        f.data.materials.append(m)
        f.visible_camera = False
    # Small hard sources: crisp glints on the ripples, the sparkle ice has
    # and glass does not.
    area('GlintA', (-2.6, -5.0, 3.6), (0, 0, 0.3), 0.35, 700, (1.0, 1.0, 1.0))
    area('GlintB', (2.2, -3.2, -1.4), (0, 0, 0.0), 0.25, 260, (0.95, 0.97, 1.0))
    # Cool fill from below-left keeps the dark facets from going dead.
    area('Fill', (-4.5, -3.5, -2.5), (0, 0, 0), 3.0, 140, (0.85, 0.9, 1.0))


def card(name, size, location, target, strength, color=(1, 1, 1)):
    """An emissive softbox: seen in reflections and through the ice, never by
    the camera, and it casts no shadow on the lights behind it."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=location)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0], size[1], 1)
    o.rotation_euler = (Vector(target) - Vector(location)).to_track_quat('Z', 'Y').to_euler()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = node(nt, 'ShaderNodeEmission', Strength=strength)
    # Real softboxes fall off toward their edges; a flat card reflects as a
    # flat grey slab on every big facet.
    tc = nt.nodes.new('ShaderNodeTexCoord')
    centre = nt.nodes.new('ShaderNodeVectorMath')
    centre.operation = 'SUBTRACT'
    centre.inputs[1].default_value = (0.5, 0.5, 0.5)
    nt.links.new(tc.outputs['Generated'], centre.inputs[0])
    length = nt.nodes.new('ShaderNodeVectorMath')
    length.operation = 'LENGTH'
    nt.links.new(centre.outputs[0], length.inputs[0])
    fall = nt.nodes.new('ShaderNodeMapRange')
    fall.interpolation_type = 'SMOOTHERSTEP'
    fall.inputs['From Min'].default_value = 0.08
    fall.inputs['From Max'].default_value = 0.72
    fall.inputs['To Min'].default_value = 1.0
    fall.inputs['To Max'].default_value = 0.06
    nt.links.new(length.outputs['Value'], fall.inputs['Value'])
    tint = nt.nodes.new('ShaderNodeMix')
    tint.data_type = 'RGBA'
    tint.blend_type = 'MULTIPLY'
    tint.inputs['Factor'].default_value = 1.0
    tint.inputs[6].default_value = (*color, 1)
    nt.links.new(fall.outputs['Result'], tint.inputs[7])
    nt.links.new(tint.outputs[2], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    o.data.materials.append(m)
    o.visible_camera = False
    o.visible_shadow = False
    return o


def studio(scene):
    """The igloo look is a product shot: a dark room with bright softboxes, so
    every face of the ice either throws a sharp white reflection or drops to
    deep slate. A smooth grey world gave grey mush. Straight through the
    middle the ice sees a pale backdrop, the fog it sits in on the page."""
    w = bpy.data.worlds.new('Studio')
    scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    remap = nt.nodes.new('ShaderNodeMapRange')  # Generated is -1..1 in a world
    remap.inputs['From Min'].default_value = -1.0
    nt.links.new(sep.outputs['Z'], remap.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(remap.outputs['Result'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.007, 0.01, 0.017, 1)
    els[1].position, els[1].color = 1.0, (0.085, 0.11, 0.15, 1)
    e = els.new(0.5)
    e.color = (0.038, 0.05, 0.07, 1)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs[0])

    scale = LIGHT_GAIN
    # Backdrop: pale, behind; what the eye sees straight through the block.
    card('Backdrop', (1.3, 2.6), (0.15, 3.6, 0.3), (0, 0, 0.3), 1.1 * scale, (0.72, 0.81, 0.93))
    # Overhead softbox: the bright top faces and the long reflections.
    card('Top', (3.2, 2.0), (0.3, -0.4, 4.6), (0, 0, 0), 5.0 * scale, COOL)
    # Key card front-left: big white sheets across the camera-facing faces.
    card('Key', (1.6, 2.2), (-3.0, -3.0, 1.9), (0, 0, 0.2), 4.2 * scale, COOL)
    # Strips behind both sides: the hard white edge lines.
    card('StripL', (0.35, 4.2), (-2.4, 1.6, 0.4), (0, 0, 0.2), 9.0 * scale, COOL)
    card('StripR', (0.35, 4.2), (2.6, 1.3, 0.2), (0, 0, 0.2), 7.0 * scale, COOL)
    # A low fill card right, so the lower facets keep a little shape.
    card('Fill', (1.2, 0.8), (2.8, -2.4, -1.4), (0, 0, -0.2), 1.6 * scale)
    # Small hard sources for crisp glints on ripples and on the engine's metal.
    area('GlintA', (-2.6, -5.0, 3.6), (0, 0, 0.3), 0.3, 1600 * scale, COOL)
    area('GlintB', (2.2, -3.2, -1.4), (0, 0, 0.0), 0.25, 450 * scale, COOL)
    area('GlintC', (3.4, -4.2, 3.0), (0, 0, 0.6), 0.25, 1100 * scale, COOL)  # upper-right sparkle
    area('KeyLight', (3.6, -3.8, 4.6), (0, 0, 0.2), 1.6, 1600 * scale, COOL)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def mesh_object(name, bm, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me), parent)


def apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def hull(points):
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts, edges=bm.edges)
    return bm


# --------------------------------------------------------------------------
# Ice
# --------------------------------------------------------------------------

def shadow_pass(nt, surface):
    """Shadow rays go straight through: lights reach the core inside the ice
    directly instead of only by caustic paths, so the metal in there gets
    clean highlights rather than noise. Camera and bounce rays still see glass."""
    lp = nt.nodes.new('ShaderNodeLightPath')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Shadow Ray'], mix.inputs[0])
    nt.links.new(surface, mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    return mix.outputs[0]


def ice_material():
    """Clear ice that has been handled: a few faces polished glassy, most of
    them hammered by melt-water into shallow ripples, frosted in patches.
    Thin film gives the faint oil-on-water sheen real ice shows at grazing
    angles; the volume gives the milky depth that softens the core."""
    m = bpy.data.materials.new('Ice')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = node(nt, 'ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.9, 0.95, 1.0, 1)  # glacial: a cool cast, as in the reference
    bsdf.inputs['Transmission Weight'].default_value = 1.0
    bsdf.inputs['IOR'].default_value = 1.31
    try:
        bsdf.inputs['Dispersion'].default_value = 0.22
        bsdf.inputs['Thin Film Thickness'].default_value = 0.0
        bsdf.inputs['Thin Film IOR'].default_value = 1.33
    except KeyError:
        pass

    tc = nt.nodes.new('ShaderNodeTexCoord')

    # Ripples: noise warped by a second noise, squashed along z so the dents
    # read as melt runs rather than hammer blows.
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1.0, 1.0, 0.55)
    nt.links.new(tc.outputs['Object'], mapping.inputs['Vector'])
    ripple = node(nt, 'ShaderNodeTexNoise', Scale=17.0, Detail=6.0, Roughness=0.55, Distortion=1.0)
    nt.links.new(mapping.outputs['Vector'], ripple.inputs['Vector'])
    dents = nt.nodes.new('ShaderNodeTexVoronoi')
    dents.feature = 'SMOOTH_F1'
    dents.inputs['Scale'].default_value = 50.0
    dents.inputs['Smoothness'].default_value = 0.6
    nt.links.new(mapping.outputs['Vector'], dents.inputs['Vector'])
    mix_h = nt.nodes.new('ShaderNodeMix')
    mix_h.data_type = 'FLOAT'
    mix_h.inputs['Factor'].default_value = 0.35
    nt.links.new(ripple.outputs['Fac'], mix_h.inputs[2])
    nt.links.new(dents.outputs['Distance'], mix_h.inputs[3])

    # Where the surface is hammered and where it was left polished: big,
    # soft patches, so some faces stay clear windows into the core.
    patch = node(nt, 'ShaderNodeTexNoise', Scale=1.6, Detail=2.0)
    nt.links.new(tc.outputs['Object'], patch.inputs['Vector'])
    patch_ramp = nt.nodes.new('ShaderNodeMapRange')
    patch_ramp.inputs['From Min'].default_value = 0.42
    patch_ramp.inputs['From Max'].default_value = 0.6
    patch_ramp.inputs['To Min'].default_value = 0.55
    patch_ramp.inputs['To Max'].default_value = 1.0
    nt.links.new(patch.outputs['Fac'], patch_ramp.inputs['Value'])

    # Faces looking at the camera stay mostly polished: a clear window onto
    # the core, as in the reference. Normal is object space, so the window
    # sways with the block.
    nsep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Normal'], nsep.inputs[0])
    front = nt.nodes.new('ShaderNodeMapRange')
    front.inputs['From Min'].default_value = -0.45
    front.inputs['From Max'].default_value = -0.8
    front.inputs['To Min'].default_value = 1.0
    front.inputs['To Max'].default_value = 0.5
    nt.links.new(nsep.outputs['Y'], front.inputs['Value'])
    hammered = nt.nodes.new('ShaderNodeMath')
    hammered.operation = 'MULTIPLY'
    nt.links.new(patch_ramp.outputs['Result'], hammered.inputs[0])
    nt.links.new(front.outputs['Result'], hammered.inputs[1])
    strength = nt.nodes.new('ShaderNodeMath')
    strength.operation = 'MULTIPLY'
    strength.inputs[1].default_value = 0.8
    nt.links.new(hammered.outputs[0], strength.inputs[0])
    bump = node(nt, 'ShaderNodeBump', Distance=0.02)
    nt.links.new(strength.outputs[0], bump.inputs['Strength'])
    nt.links.new(mix_h.outputs[0], bump.inputs['Height'])

    # Chips (material slot 1 via the cutters) get a coarse conchoidal relief.
    chip = node(nt, 'ShaderNodeTexNoise', Scale=34.0, Detail=8.0, Roughness=0.7)
    nt.links.new(tc.outputs['Object'], chip.inputs['Vector'])
    chip_bump = node(nt, 'ShaderNodeBump', Strength=1.0, Distance=0.035)
    nt.links.new(chip.outputs['Fac'], chip_bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], chip_bump.inputs['Normal'])
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'chip'
    nmix = nt.nodes.new('ShaderNodeMix')
    nmix.data_type = 'VECTOR'
    nt.links.new(attr.outputs['Fac'], nmix.inputs['Factor'])
    nt.links.new(bump.outputs['Normal'], nmix.inputs[4])
    nt.links.new(chip_bump.outputs['Normal'], nmix.inputs[5])
    nt.links.new(nmix.outputs[1], bsdf.inputs['Normal'])

    # Frost: rough where hammered or chipped, near-polished elsewhere.
    rough = nt.nodes.new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value = 0.02
    rough.inputs['To Max'].default_value = 0.12
    nt.links.new(hammered.outputs[0], rough.inputs['Value'])
    rmax = nt.nodes.new('ShaderNodeMath')
    rmax.operation = 'MAXIMUM'
    nt.links.new(rough.outputs['Result'], rmax.inputs[0])
    chip_r = nt.nodes.new('ShaderNodeMath')
    chip_r.operation = 'MULTIPLY'
    chip_r.inputs[1].default_value = 0.32
    nt.links.new(attr.outputs['Fac'], chip_r.inputs[0])
    nt.links.new(chip_r.outputs[0], rmax.inputs[1])
    nt.links.new(rmax.outputs[0], bsdf.inputs['Roughness'])

    # Sheen in a few places only.
    film = nt.nodes.new('ShaderNodeMapRange')
    film.inputs['From Min'].default_value = 0.48
    film.inputs['From Max'].default_value = 0.7
    film.inputs['To Min'].default_value = 0.0
    film.inputs['To Max'].default_value = 560.0
    nt.links.new(ripple.outputs['Fac'], film.inputs['Value'])
    try:
        nt.links.new(film.outputs['Result'], bsdf.inputs['Thin Film Thickness'])
    except KeyError:
        pass

    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (0.8, 0.88, 0.98, 1)
    vol.inputs['Density'].default_value = 0.15
    vol.inputs['Anisotropy'].default_value = 0.35
    vol.inputs['Absorption Color'].default_value = (0.7, 0.81, 0.95, 1)

    nt.links.new(shadow_pass(nt, bsdf.outputs[0]), out.inputs['Surface'])
    nt.links.new(vol.outputs[0], out.inputs['Volume'])
    m.cycles.volume_interpolation = 'LINEAR'
    try:
        m.cycles.homogeneous_volume = True
    except AttributeError:  # Blender 5 detects homogeneous volumes itself
        pass
    return m


def air_material():
    """Trapped air and crack faces: an ice→air boundary, so reflective at
    grazing angles and otherwise clear."""
    m = bpy.data.materials.new('Air')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    glass = node(nt, 'ShaderNodeBsdfGlass', IOR=1 / 1.31, Roughness=0.04)
    glass.inputs['Color'].default_value = (1, 1, 1, 1)
    nt.links.new(shadow_pass(nt, glass.outputs[0]), out.inputs['Surface'])
    return m


def crack_material():
    m = bpy.data.materials.new('Crack')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    lw = node(nt, 'ShaderNodeLayerWeight', Blend=0.35)
    gloss = node(nt, 'ShaderNodeBsdfGlossy')
    gloss.inputs['Roughness'].default_value = 0.22
    gloss.inputs['Color'].default_value = (1, 1, 1, 1)
    trans = node(nt, 'ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    # Fresnel weight, scaled down: a crack is a sheet you notice, not a mirror.
    scale = nt.nodes.new('ShaderNodeMath')
    scale.operation = 'MULTIPLY'
    scale.inputs[1].default_value = 0.3
    nt.links.new(lw.outputs['Fresnel'], scale.inputs[0])
    nt.links.new(scale.outputs[0], mix.inputs[0])
    nt.links.new(trans.outputs[0], mix.inputs[1])
    nt.links.new(gloss.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def ice_block(rng, pivot):
    """A block of lake ice: broad sawn faces, then chipped at the corners.

    Hull of points on a squashed ellipsoid → a few big facets, like the
    reference's. Cutters (small random hulls) are subtracted around the edges
    for conchoidal chips; their faces carry a `chip` attribute so the
    shader can give them a coarser surface."""
    # Fixed proportions, the reference's tall slab (w:h about 0.6); the core
    # is fitted inside it, never the other way round.
    rx, ry, rz = ICE_HALF
    pts = []
    for i in range(13):
        u = rng.uniform(-0.92, 0.92)
        a = rng.uniform(0, math.tau)
        r = (1 - u * u) ** 0.35  # fuller than an ellipsoid: a block, not an egg
        jitter = rng.uniform(0.88, 1.06)
        pts.append(Vector((r * math.cos(a) * rx * jitter, r * math.sin(a) * ry * jitter, u * rz)))
    # Top and bottom caps, steeply tilted and uneven: a level ring of cap
    # points makes a level crease that reads as a ruled line across the block.
    for z, tilt in ((rz, 0.34), (-rz, -0.28)):
        for k in range(5):
            a = k / 5 * math.tau + rng.uniform(-0.3, 0.3)
            pts.append(Vector((math.cos(a) * rx * 0.62, math.sin(a) * ry * 0.62,
                               z * 0.94 + math.cos(a) * tilt + rng.uniform(-0.09, 0.09))))
    bm = hull(pts)
    ice = mesh_object('Ice', bm, pivot)
    ice.data.materials.append(ice_material())

    # Chips. A few big conchoidal breaks at the corners, then many small
    # bites along the edges: the crushed, granular rim real ice has where it
    # was knocked about, and the strongest cue that this is ice, not glass.
    cutters = []
    me = ice.data
    verts = [v.co.copy() for v in me.vertices]
    sharp = [e for e in me.edges
             if (me.vertices[e.vertices[0]].co - me.vertices[e.vertices[1]].co).length > 0.12]

    def cutter(base, s, flat, n=12):
        cp = []
        for _ in range(n):
            d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
            cp.append(Vector((d.x * s, d.y * s, d.z * s * flat)))
        c = mesh_object(f'Cutter{len(cutters)}', hull(cp))
        c.location = base
        c.rotation_euler = (rng.uniform(0, math.tau), rng.uniform(0, math.tau), rng.uniform(0, math.tau))
        c.hide_render = True
        cutters.append(c)

    for i in range(7):
        cutter(verts[rng.randrange(len(verts))], rng.uniform(0.2, 0.38), rng.uniform(0.35, 0.6))
    for i in range(46):
        e = sharp[rng.randrange(len(sharp))]
        a, b = me.vertices[e.vertices[0]].co, me.vertices[e.vertices[1]].co
        t = rng.uniform(0.1, 0.9)
        cutter(a.lerp(b, t), rng.uniform(0.03, 0.11), rng.uniform(0.3, 0.7), n=9)

    # Mark the original faces 0; cutter faces inherit 1 through the boolean.
    for obj, value in [(ice, 0.0)] + [(c, 1.0) for c in cutters]:
        a = obj.data.attributes.new('chip', 'FLOAT', 'FACE')
        a.data.foreach_set('value', [value] * len(obj.data.polygons))

    for c in cutters:
        mod = ice.modifiers.new(c.name, 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = c
    apply_modifiers(ice)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)

    # A hair of bevel so every edge catches a highlight line.
    bev = ice.modifiers.new('Bevel', 'BEVEL')
    bev.width = 0.008
    bev.segments = 2
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(25)
    bev.harden_normals = False
    apply_modifiers(ice)
    for p in ice.data.polygons:
        p.use_smooth = False
    return ice


def report_outside(ice, core_objects):
    """How much of the core pokes out of the ice: anything above zero shows
    as metal breaking the surface. Sampled, by ray parity."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = ice.evaluated_get(deps)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(ice.matrix_world)
    ev.to_mesh_clear()
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    d = Vector((0.0123, 0.0217, 1.0)).normalized()
    out = total = 0
    where = {}
    for o in core_objects:
        mw = o.matrix_world
        for v in list(o.data.vertices)[::7]:
            p = mw @ v.co
            hits, origin = 0, p.copy()
            for _ in range(64):
                loc, _n, _i, _d = tree.ray_cast(origin, d)
                if loc is None:
                    break
                hits += 1
                origin = loc + d * 1e-4
            total += 1
            if hits % 2 == 0:
                out += 1
                where.setdefault(o.name, []).append(tuple(round(c, 2) for c in p))
    print(f'CORE OUTSIDE ICE: {out}/{total}')
    for name, pts in where.items():
        print('  OUTSIDE', name, len(pts), pts[:2])
    return out


def inclusions(rng, ice, pivot, core_objects):
    """Trapped air: a column of fine bubbles that froze rising, some loose
    ones, and three crack sheets. Placed only inside the ice and outside the
    core, using ray parity against both."""
    deps = bpy.context.evaluated_depsgraph_get()

    def world_bvh(o):
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.transform(o.matrix_world)
        ev.to_mesh_clear()
        tree = BVHTree.FromBMesh(bm)
        bm.free()
        return tree

    ice_bvh = world_bvh(ice)
    core_bvhs = [world_bvh(o) for o in core_objects]

    def inside(bvh, p):
        hits = 0
        origin = p.copy()
        d = Vector((0.0123, 0.0217, 1.0)).normalized()
        for _ in range(64):
            loc, _n, _i, _d = bvh.ray_cast(origin, d)
            if loc is None:
                break
            hits += 1
            origin = loc + d * 1e-4
        return hits % 2 == 1

    def clear_of_core(p, margin=0.05):
        for b in core_bvhs:
            loc, _n, _i, dist = b.find_nearest(p)
            if loc is not None and dist < margin:
                return False
        return True

    bm = bmesh.new()
    placed = 0
    # Rising streams: bubbles get smaller and denser toward the top of each.
    for stream in range(4):
        x0, y0 = rng.uniform(-0.45, 0.45), rng.uniform(-0.35, 0.35)
        z = rng.uniform(-1.0, -0.4)
        for k in range(rng.randint(30, 60)):
            z += rng.uniform(0.015, 0.05)
            p = Vector((x0 + rng.gauss(0, 0.012) + z * 0.04, y0 + rng.gauss(0, 0.012), z))
            if not inside(ice_bvh, p) or not clear_of_core(p):
                continue
            r = rng.uniform(0.003, 0.012) * (1.1 - (z + 1.2) * 0.25)
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=max(r, 0.002),
                                       matrix=Matrix.Translation(p))
            placed += 1
    for _ in range(320):
        p = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1.2, 1.2)))
        if not inside(ice_bvh, p) or not clear_of_core(p):
            continue
        r = rng.uniform(0.002, 0.009) if rng.random() > 0.06 else rng.uniform(0.015, 0.03)
        bmesh.ops.create_icosphere(bm, subdivisions=2 if r > 0.012 else 1, radius=r,
                                   matrix=Matrix.Translation(p))
        placed += 1
    bubbles = mesh_object('Bubbles', bm, pivot)
    bubbles.data.materials.append(air_material())
    print('bubbles', placed)

    # Cracks: jagged discs, each slightly curved, set at random angles.
    crack_mat = crack_material()
    for i in range(CRACKS):
        cbm = bmesh.new()
        centre = Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.3, 0.3), rng.uniform(-0.9, 0.9)))
        radius = rng.uniform(0.22, 0.42)
        ring = []
        n = 22
        for k in range(n):
            a = k / n * math.tau
            rr = radius * rng.uniform(0.55, 1.0)
            ring.append(cbm.verts.new((math.cos(a) * rr, math.sin(a) * rr, rng.uniform(-0.015, 0.015))))
        mid = cbm.verts.new((0, 0, 0))
        for k in range(n):
            cbm.faces.new((mid, ring[k], ring[(k + 1) % n]))
        bmesh.ops.subdivide_edges(cbm, edges=cbm.edges, cuts=2, use_grid_fill=True)
        for v in cbm.verts:
            v.co.z += 0.06 * (v.co.x ** 2 + v.co.y ** 2) / max(radius, 1e-3) + rng.uniform(-0.004, 0.004)
        crack = mesh_object(f'Crack{i}', cbm, pivot)
        crack.location = centre
        crack.rotation_euler = (rng.uniform(0.3, 1.3), rng.uniform(-1, 1), rng.uniform(0, math.tau))
        crack.data.materials.append(crack_mat)
        # Shrink until the whole sheet is inside the ice: a crack that pokes
        # out of a face reads as a sticker.
        bpy.context.view_layer.update()
        for _ in range(12):
            mw = crack.matrix_world
            if all(inside(ice_bvh, mw @ v.co) for v in list(crack.data.vertices)[::3]):
                break
            crack.scale *= 0.85
            bpy.context.view_layer.update()


# --------------------------------------------------------------------------
# Cores
# --------------------------------------------------------------------------

def desaturate_materials(objects, saturation=0.12, value=0.95):
    """The world is monochrome slate and fog. Imported cores keep their
    textures and roughness, but their colour is pulled almost to grey."""
    seen = set()
    for o in objects:
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.name in seen or not m.use_nodes:
                continue
            seen.add(m.name)
            nt = m.node_tree
            for n in list(nt.nodes):
                if n.type != 'BSDF_PRINCIPLED':
                    continue
                sock = n.inputs['Base Color']
                hsv = nt.nodes.new('ShaderNodeHueSaturation')
                hsv.inputs['Saturation'].default_value = saturation
                hsv.inputs['Value'].default_value = value
                if sock.is_linked:
                    src = sock.links[0].from_socket
                    nt.links.new(src, hsv.inputs['Color'])
                else:
                    hsv.inputs['Color'].default_value = sock.default_value
                nt.links.new(hsv.outputs['Color'], sock)


def fit(objects, pivot, rotation=(0, 0, 0)):
    """Centre the core on the pivot and scale it to fill CORE_BOX."""
    root = bpy.data.objects.new('CoreRoot', None)
    link(root, pivot)
    for o in objects:
        if o.parent is None or o.parent not in objects:
            o.parent = root
    # Yaw first, then tip toward the camera about the world x axis.
    root.rotation_mode = 'ZYX'
    root.rotation_euler = rotation
    bpy.context.view_layer.update()
    # Measure real vertices: boxes around rotated parts overstate a tilted
    # ring by up to 40% and shrink the core for nothing.
    import numpy as np
    deps = bpy.context.evaluated_depsgraph_get()
    lo = np.full(3, 1e9)
    hi = np.full(3, -1e9)
    for o in objects:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        n = len(me.vertices)
        if n:
            co = np.empty(n * 3, dtype=np.float64)
            me.vertices.foreach_get('co', co)
            co = co.reshape(n, 3)
            mw = np.array(o.matrix_world)
            w = co @ mw[:3, :3].T + mw[:3, 3]
            lo = np.minimum(lo, w.min(0))
            hi = np.maximum(hi, w.max(0))
        ev.to_mesh_clear()
    lo, hi = Vector(lo.tolist()), Vector(hi.tolist())
    size = hi - lo
    if '--debug-fit' in args:
        for o in objects:
            if o.type == 'MESH':
                ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
                print('FIT', o.name, [round(max(getattr(w, k) for w in ws), 2) for k in 'xyz'],
                      [round(min(getattr(w, k) for w in ws), 2) for k in 'xyz'])
        print('FITSIZE', size)
    s = min(CORE_BOX[0] / max(size.x, 1e-6), CORE_BOX[1] / max(size.y, 1e-6),
            CORE_BOX[2] / max(size.z, 1e-6))
    s *= CORE_FIT.get(CORE, 1.0)
    root.scale = (s, s, s)
    centre = (lo + hi) * 0.5
    root.location = -centre * s
    bpy.context.view_layer.update()
    return root, (lo - centre) * s, (hi - centre) * s


def core_placeholder(pivot):
    """Look-dev stand-in with a V8's mass: block, two banks, blower, pulleys."""
    objs = []
    mat = bpy.data.materials.new('Cast')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.32, 0.33, 0.35, 1)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.38

    def box(loc, dims, rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
        o = bpy.context.active_object
        o.scale = (dims[0] / 2, dims[1] / 2, dims[2] / 2)
        o.data.materials.append(mat)
        m = o.modifiers.new('B', 'BEVEL')
        m.width, m.segments = 0.02, 3
        objs.append(o)

    def cyl(loc, r, depth, rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=48)
        o = bpy.context.active_object
        o.data.materials.append(mat)
        objs.append(o)

    box((0, 0, 0), (0.7, 0.5, 0.5))
    box((-0.28, 0, 0.35), (0.62, 0.22, 0.42), (0, math.radians(40), 0))
    box((0.28, 0, 0.35), (0.62, 0.22, 0.42), (0, math.radians(-40), 0))
    box((0, 0, 0.62), (0.3, 0.55, 0.3))
    cyl((0, -0.32, -0.05), 0.16, 0.06, (math.radians(90), 0, 0))
    cyl((0.18, -0.32, 0.18), 0.09, 0.06, (math.radians(90), 0, 0))
    for side in (-1, 1):
        for k in range(4):
            cyl((side * 0.55, -0.18 + k * 0.12, 0.2), 0.03, 0.5, (0, math.radians(90 + side * 30), 0))
    for o in objs:
        o.parent = pivot
    return objs


def core_v8(pivot):
    path = os.path.join(SRC, 'v8', 'scene.gltf')
    if not os.path.exists(path):
        alt = os.path.join(SRC, 'v8', 'scene.glb')
        path = alt if os.path.exists(alt) else None
    if path is None:
        print('No Sketchfab V8 in art/src/v8: building the modelled one')
        return core_v8_built(pivot)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    # Strip what is not the engine (radiator, tank, loose lines): whatever
    # sits outside the dominant cluster gets named and dropped in DROP.
    drop = [s.lower() for s in arg('drop', '').split(',') if s]
    for o in list(objs):
        if any(d in o.name.lower() for d in drop):
            objs.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in objs if o.type == 'MESH']
    desaturate_materials(meshes)
    return objs


def pbr(name, color, metallic=0.0, roughness=0.5, coat=0.0, grain=None):
    """A plain principled material; `grain` adds a stretched noise to the
    roughness (brushed metal, wood) along the object's z."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Coat Weight'].default_value = coat
    if grain:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = grain
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        nz = node(nt, 'ShaderNodeTexNoise', Scale=60.0, Detail=8.0)
        nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
        rr = nt.nodes.new('ShaderNodeMapRange')
        rr.inputs['To Min'].default_value = roughness * 0.6
        rr.inputs['To Max'].default_value = roughness * 1.5
        nt.links.new(nz.outputs['Fac'], rr.inputs['Value'])
        nt.links.new(rr.outputs['Result'], b.inputs['Roughness'])
        cr = nt.nodes.new('ShaderNodeMapRange')
        cr.inputs['To Min'].default_value = 0.88
        cr.inputs['To Max'].default_value = 1.08
        nt.links.new(nz.outputs['Fac'], cr.inputs['Value'])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        mul.inputs[6].default_value = (*color, 1)
        nt.links.new(cr.outputs['Result'], mul.inputs[7])
        nt.links.new(mul.outputs[2], b.inputs['Base Color'])
    return m


def primitive(kind, mat, parent, **kw):
    getattr(bpy.ops.mesh, f'primitive_{kind}_add')(**kw)
    o = bpy.context.active_object
    o.data.materials.append(mat)
    o.parent = parent
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def bevel(o, width, segments=3):
    m = o.modifiers.new('Bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    o.modifiers.new('WN', 'WEIGHTED_NORMAL').keep_sharp = True
    return o


def core_pencil(pivot):
    """Realtime Scribl: a pencil frozen mid-stroke, the stroke it was
    drawing hanging in the ice behind its tip like a held breath."""
    group = bpy.data.objects.new('Pencil', None)
    link(group, pivot)
    lacquer = pbr('Lacquer', (0.07, 0.074, 0.08), roughness=0.3, coat=0.8)
    wood = pbr('Wood', (0.46, 0.43, 0.4), roughness=0.62, grain=(1.0, 1.0, 0.06))
    graphite = pbr('Graphite', (0.05, 0.052, 0.056), metallic=0.55, roughness=0.36)
    ferrule = pbr('Ferrule', (0.72, 0.73, 0.75), metallic=1.0, roughness=0.22, grain=(1.0, 1.0, 0.02))
    rubber = pbr('Rubber', (0.24, 0.24, 0.25), roughness=0.82)

    L, R = 1.6, 0.075  # body length and hex radius; the tip points down -z
    body = primitive('cylinder', lacquer, group, vertices=6, radius=R, depth=L, location=(0, 0, 0.0))
    # The sharpened end: intersect the hex with a cone, which leaves the
    # scalloped lacquer edge every real pencil has.
    cone = primitive('cone', wood, None, vertices=96, radius1=0.0, radius2=R * 1.25, depth=0.34,
                     location=(0, 0, -L / 2 + 0.17 - 0.001))
    ext = primitive('cylinder', wood, None, vertices=96, radius=R * 1.3, depth=L, location=(0, 0, 0.17))
    for p in cone.data.polygons:
        p.use_smooth = True
    union = cone.modifiers.new('U', 'BOOLEAN')
    union.operation = 'UNION'
    union.object = ext
    apply_modifiers(cone)
    bpy.data.objects.remove(ext, do_unlink=True)
    cut = body.modifiers.new('Sharpen', 'BOOLEAN')
    cut.operation = 'INTERSECT'
    cut.solver = 'EXACT'
    cut.object = cone
    apply_modifiers(body)
    bpy.data.objects.remove(cone, do_unlink=True)
    bevel(body, 0.004, 2)
    # Graphite: the last few millimetres.
    tip_len = 0.07
    tip = primitive('cone', graphite, group, vertices=48, radius1=0.0, radius2=R * 1.25 * tip_len / 0.34,
                    depth=tip_len, location=(0, 0, -L / 2 + tip_len / 2 - 0.0005))
    # Ferrule with crimp rings, then the eraser.
    top = L / 2
    fer = primitive('cylinder', ferrule, group, vertices=64, radius=R * 1.06, depth=0.13, location=(0, 0, top + 0.06))
    for k in range(4):
        primitive('torus', ferrule, group, major_radius=R * 1.065, minor_radius=0.004,
                  major_segments=64, minor_segments=8, location=(0, 0, top + 0.015 + k * 0.018))
    era = primitive('cylinder', rubber, group, vertices=64, radius=R * 0.98, depth=0.12, location=(0, 0, top + 0.18))
    bevel(era, 0.03, 4)

    # The stroke: a looping cursive scribble leaving the tip, in graphite.
    curve = bpy.data.curves.new('Stroke', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.012
    curve.bevel_resolution = 3
    spl = curve.splines.new('NURBS')
    pts = []
    n = 90
    for i in range(n):
        t = i / (n - 1)
        a = t * math.tau * 4.2
        x = -0.06 - t * 0.95 + 0.14 * math.sin(a)
        y = 0.07 * math.sin(a * 0.5) * (1 - t * 0.5)
        z = -L / 2 - 0.02 + 0.17 * (1 - math.cos(a)) * (0.6 + 0.4 * t) + t * 0.25
        pts.append((x, y, z))
    spl.points.add(len(pts) - 1)
    for p, c in zip(spl.points, pts):
        p.co = (*c, 1)
    spl.use_endpoint_u = True
    spl.order_u = 4
    stroke = bpy.data.objects.new('Stroke', curve)
    link(stroke, group)
    curve.materials.append(graphite)
    # Taper the stroke's tail so it fades like a lifted pencil.
    taper = bpy.data.curves.new('Taper', 'CURVE')
    ts = taper.splines.new('POLY')
    ts.points.add(2)
    for p, c in zip(ts.points, [(0, 1.0, 0, 1), (0.7, 0.9, 0, 1), (1, 0.25, 0, 1)]):
        p.co = c
    tobj = bpy.data.objects.new('TaperCurve', taper)
    link(tobj)
    tobj.hide_render = True
    curve.taper_object = tobj

    # Lay the pencil on a diagonal, tip low left, as if drawing.
    group.rotation_euler = (math.radians(8), math.radians(-38), 0)
    bpy.context.view_layer.update()
    # Curves count as meshes for fitting and the envelope: convert.
    bpy.context.view_layer.objects.active = stroke
    for o in bpy.context.selected_objects:
        o.select_set(False)
    stroke.select_set(True)
    bpy.ops.object.convert(target='MESH')
    stroke = bpy.context.active_object
    return [o for o in group.children_recursive] + [group]


def core_orrery(pivot):
    """AI Portfolio Manager: an armillary sphere. Allocations held in orbit
    around a centre; the outermost ring is the frontier."""
    group = bpy.data.objects.new('Orrery', None)
    link(group, pivot)
    silver = pbr('Silver', (0.7, 0.71, 0.73), metallic=1.0, roughness=0.18)
    brushed = pbr('Brushed', (0.36, 0.37, 0.39), metallic=1.0, roughness=0.32, grain=(1.0, 1.0, 0.03))
    gun = pbr('Gunmetal', (0.1, 0.105, 0.115), metallic=1.0, roughness=0.36)
    pearl = pbr('Pearl', (0.5, 0.51, 0.53), roughness=0.3, coat=0.8)

    def band(radius, width, thick, mat, rot, ticks=0):
        """A flat ring with a rectangular section, like a real armillary."""
        bm = bmesh.new()
        seg = 160
        rows = []
        for (r, z) in ((radius, -width / 2), (radius, width / 2), (radius - thick, width / 2), (radius - thick, -width / 2)):
            rows.append([bm.verts.new((math.cos(k / seg * math.tau) * r, math.sin(k / seg * math.tau) * r, z))
                         for k in range(seg)])
        for a in range(4):
            r0, r1 = rows[a], rows[(a + 1) % 4]
            for k in range(seg):
                bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
        o = mesh_object('Band', bm, group)
        o.data.materials.append(mat)
        o.rotation_euler = rot
        bevel(o, thick * 0.18, 2)
        if ticks:
            for k in range(ticks):
                a = k / ticks * math.tau
                long = k % 5 == 0
                t = primitive('cube', gun, o, size=1,
                              location=(math.cos(a) * (radius + 0.004), math.sin(a) * (radius + 0.004), 0),
                              rotation=(0, 0, a))
                t.scale = (0.012 if long else 0.007, 0.0035, width * (0.9 if long else 0.55))
        return o

    band(0.74, 0.1, 0.028, brushed, (math.radians(90), 0, 0), ticks=72)  # meridian
    band(0.74, 0.09, 0.028, brushed, (0, 0, 0), ticks=72)  # equator
    band(0.62, 0.055, 0.02, gun, (math.radians(23.4), 0, math.radians(12)))  # ecliptic
    band(0.5, 0.05, 0.018, silver, (math.radians(62), math.radians(18), 0))
    band(0.4, 0.045, 0.016, gun, (math.radians(-40), math.radians(-30), 0))
    # Axis through the poles, tilted, with finials.
    axis = primitive('cylinder', gun, group, vertices=32, radius=0.018, depth=1.6)
    for z in (0.8, -0.8):
        primitive('uv_sphere', silver, axis, radius=0.03, segments=32, ring_count=16, location=(0, 0, z))
    axis.rotation_euler = (math.radians(23.4), 0, 0)
    # Centre: a pearl sphere in a gunmetal collar.
    primitive('uv_sphere', pearl, group, radius=0.17, segments=96, ring_count=48)
    primitive('torus', gun, group, major_radius=0.172, minor_radius=0.01, major_segments=96, minor_segments=12)
    # Bodies on arms: the allocations.
    rng = random.Random(11)
    for k, (r, size, inc) in enumerate(((0.4, 0.04, -40), (0.5, 0.05, 62), (0.62, 0.035, 23.4), (0.62, 0.028, 23.4))):
        a = rng.uniform(0, math.tau) + k
        arm = bpy.data.objects.new(f'Arm{k}', None)
        link(arm, group)
        arm.rotation_euler = (math.radians(inc), 0, a)
        primitive('cylinder', gun, arm, vertices=16, radius=0.005, depth=r - 0.17,
                  location=((r + 0.17) / 2, 0, 0), rotation=(0, math.radians(90), 0))
        primitive('uv_sphere', silver if k % 2 else pearl, arm, radius=size, segments=48, ring_count=24,
                  location=(r, 0, 0))
    group.rotation_euler = (math.radians(6), 0, 0)
    bpy.context.view_layer.update()
    return [o for o in group.children_recursive] + [group]


def core_v8_built(pivot):
    """A blown big-block V8, modelled here so it needs no licence: block and
    pan, two banks at 90 degrees with heads and finned valve covers, a
    supercharger with ribbed case and injector scoop, belt drive, pulleys,
    alternator, chrome headers into collectors, plug wires to a distributor,
    and a flywheel with its ring gear. Engine axes: x along the crank (front
    is -x), y across, z up. Units are arbitrary; fit() scales it."""
    g = bpy.data.objects.new('V8', None)
    link(g, pivot)
    M = {
        'cast': pbr('CastAlu', (0.4, 0.41, 0.43), metallic=1.0, roughness=0.46, grain=(1.0, 1.0, 1.0)),
        'polish': pbr('Polished', (0.92, 0.93, 0.94), metallic=1.0, roughness=0.09, grain=(1.0, 1.0, 0.03)),
        'chrome': pbr('Chrome', (0.96, 0.96, 0.97), metallic=1.0, roughness=0.04),
        'black': pbr('Rubber', (0.022, 0.023, 0.025), roughness=0.6),
        'satin': pbr('Satin', (0.07, 0.075, 0.08), metallic=0.7, roughness=0.3),
        'steel': pbr('Steel', (0.62, 0.63, 0.65), metallic=1.0, roughness=0.22),
    }
    curves = []

    def place(o, loc, rot, mat, parent, bev, seg):
        o.location = loc
        o.rotation_euler = rot
        o.data.materials.append(M[mat])
        o.parent = parent
        for p in o.data.polygons:
            p.use_smooth = True
        if bev:
            bevel(o, bev, seg)
        return o

    def box(size, loc, mat, parent=g, rot=(0, 0, 0), bev=0.006, seg=3):
        bpy.ops.mesh.primitive_cube_add(size=1)
        o = bpy.context.active_object
        o.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        return place(o, loc, rot, mat, parent, bev, seg)

    def cyl(r, depth, loc, mat, parent=g, axis='x', verts=64, bev=0.003):
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts)
        o = bpy.context.active_object
        rot = {'x': (0, math.radians(90), 0), 'y': (math.radians(90), 0, 0), 'z': (0, 0, 0)}[axis]
        return place(o, loc, rot, mat, parent, bev, 2)

    def ring(R, r, loc, mat, parent=g, axis='x'):
        bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=72, minor_segments=10)
        o = bpy.context.active_object
        rot = {'x': (0, math.radians(90), 0), 'y': (math.radians(90), 0, 0), 'z': (0, 0, 0)}[axis]
        return place(o, loc, rot, mat, parent, 0, 0)

    def tube(pts, r, mat, parent=g):
        cu = bpy.data.curves.new('Tube', 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = r
        cu.bevel_resolution = 4
        cu.resolution_u = 14
        cu.use_fill_caps = True
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
        o = bpy.data.objects.new('Tube', cu)
        link(o, parent)
        cu.materials.append(M[mat])
        curves.append(o)
        return o

    # --- Bottom end ----------------------------------------------------
    box((0.62, 0.34, 0.22), (0, 0, 0.1), 'cast', bev=0.012)
    for x in (-0.2, 0.0, 0.2):  # freeze plugs and side ribs
        for sgn in (-1, 1):
            cyl(0.022, 0.012, (x, sgn * 0.172, 0.08), 'steel', axis='y')
            box((0.012, 0.012, 0.18), (x + 0.1, sgn * 0.171, 0.1), 'cast', bev=0.003)
    box((0.54, 0.3, 0.014), (0.02, 0, -0.012), 'cast', bev=0.004)  # pan flange
    box((0.5, 0.26, 0.13), (0.02, 0, -0.085), 'cast', bev=0.03, seg=5)  # oil pan
    for k in range(9):
        for sgn in (-1, 1):
            cyl(0.008, 0.012, (-0.22 + k * 0.055, sgn * 0.143, -0.002), 'steel', axis='z', verts=6)

    # --- Banks ---------------------------------------------------------
    plugs = []
    for side in (1, -1):
        theta = -side * math.radians(45)
        bank = bpy.data.objects.new(f'Bank{side}', None)
        link(bank, g)
        bank.location = (0, side * 0.075, 0.2)
        bank.rotation_euler = (theta, 0, 0)
        box((0.56, 0.2, 0.24), (0, 0, 0.12), 'cast', parent=bank, bev=0.01)
        box((0.58, 0.24, 0.08), (0, 0, 0.28), 'cast', parent=bank, bev=0.008)
        box((0.56, 0.2, 0.07), (0, 0, 0.352), 'polish', parent=bank, bev=0.028, seg=6)
        for k in range(5):  # cover fins
            box((0.48, 0.008, 0.018), (0, -0.064 + k * 0.032, 0.392), 'polish', parent=bank, bev=0.003)
        for k in range(6):  # cover bolts
            for sgn in (-1, 1):
                cyl(0.009, 0.014, (-0.25 + k * 0.1, sgn * 0.108, 0.322), 'steel', parent=bank, axis='z', verts=6)
        cyl(0.022, 0.05, (0.2, 0, 0.405), 'polish', parent=bank, axis='z')  # breather
        cap = ring(0.022, 0.007, (0.2, 0, 0.43), 'polish', parent=bank, axis='z')
        bpy.context.view_layer.update()
        mw = Matrix.Translation(bank.location) @ Matrix.Rotation(theta, 4, 'X')
        for i, x in enumerate((-0.21, -0.07, 0.07, 0.21)):
            # Exhaust primaries: out of the head, down the side, back into a
            # collector. Chrome, so they carry the brightest reflections.
            port = mw @ Vector((x, side * 0.12, 0.27))
            pts = [port,
                   port + Vector((0, side * 0.06, -0.015)),
                   Vector((x * 0.9 + 0.02, side * 0.33, port.z - 0.16)),
                   Vector((0.08 + x * 0.45, side * 0.335, -0.07 + i * 0.012)),
                   Vector((0.34, side * 0.3, -0.1))]
            tube(pts, 0.017, 'chrome')
            plug = mw @ Vector((x + 0.03, side * 0.122, 0.33))
            cyl(0.008, 0.04, plug, 'black', axis='z', verts=12)
            plugs.append((plug, side))
        cyl(0.042, 0.16, (0.44, side * 0.3, -0.1), 'chrome', axis='x')  # collector
        cyl(0.03, 0.06, (0.54, side * 0.3, -0.1), 'chrome', axis='x')

    # --- Top: intake, blower, scoop ---------------------------------------
    box((0.5, 0.2, 0.08), (0, 0, 0.4), 'cast', bev=0.012)
    blower = box((0.42, 0.24, 0.16), (-0.02, 0, 0.52), 'polish', bev=0.045, seg=6)
    for k in range(7):  # case ribs
        z = 0.455 + k * 0.022
        for sgn in (-1, 1):
            box((0.4, 0.012, 0.009), (-0.02, sgn * 0.123, z), 'polish', bev=0.003)
    box((0.03, 0.2, 0.14), (-0.245, 0, 0.52), 'cast', bev=0.01)  # front plate
    cyl(0.034, 0.07, (-0.29, 0, 0.53), 'steel')  # snout
    blower_pulley = cyl(0.066, 0.045, (-0.34, 0, 0.53), 'satin')
    for k in range(3):
        ring(0.066, 0.004, (-0.326 + k * 0.014, 0, 0.53), 'steel')
    box((0.24, 0.19, 0.11), (0.0, 0, 0.66), 'polish', bev=0.035, seg=6)  # scoop
    box((0.012, 0.15, 0.07), (-0.121, 0, 0.67), 'black', bev=0.004)  # its mouth
    for k in range(3):
        box((0.006, 0.006, 0.07), (-0.126, -0.05 + k * 0.05, 0.67), 'chrome', bev=0)
    for sgn in (-1, 1):  # fuel lines down the blower
        tube([Vector((0.05, sgn * 0.09, 0.62)), Vector((0.12, sgn * 0.16, 0.58)),
              Vector((0.17, sgn * 0.17, 0.46)), Vector((0.2, sgn * 0.13, 0.41))], 0.006, 'chrome')

    # --- Front: pulleys, belts, accessories ---------------------------------
    box((0.024, 0.26, 0.3), (-0.318, 0, 0.16), 'cast', bev=0.008)  # timing cover
    crank = (-0.36, 0.0, 0.05)
    cyl(0.092, 0.05, crank, 'satin')
    for k in range(3):
        ring(0.092, 0.004, (crank[0] + 0.012 * (k - 1), 0, crank[2]), 'steel')
    cyl(0.03, 0.02, (crank[0] - 0.03, 0, crank[2]), 'steel', verts=6)
    cyl(0.05, 0.06, (-0.34, 0, 0.27), 'cast')  # water pump
    cyl(0.06, 0.03, (-0.38, 0, 0.27), 'satin')
    alt = cyl(0.064, 0.12, (-0.28, 0.21, 0.36), 'cast')  # alternator
    for k in range(6):
        ring(0.064, 0.005, (-0.33 + k * 0.02, 0.21, 0.36), 'steel')
    cyl(0.03, 0.03, (-0.36, 0.21, 0.36), 'satin')

    def belt(points, x, width=0.03):
        cu = bpy.data.curves.new('Belt', 'CURVE')
        cu.dimensions = '2D'
        cu.fill_mode = 'NONE'
        cu.extrude = width / 2
        cu.bevel_depth = 0.004
        sp = cu.splines.new('POLY')
        sp.points.add(len(points) - 1)
        for p, (y, z) in zip(sp.points, points):
            p.co = (y, z, 0, 1)
        sp.use_cyclic_u = True
        o = bpy.data.objects.new('Belt', cu)
        link(o, g)
        o.location = (x, 0, 0)
        o.rotation_euler = (math.radians(90), 0, math.radians(90))  # local xy -> engine yz
        cu.materials.append(M['black'])
        curves.append(o)

    def wrap(circles):
        """Points around the convex wrap of pulleys (y, z, r), counter-clockwise."""
        pts = []
        n = len(circles)
        for i in range(n):
            (y0, z0, r0), (y1, z1, r1) = circles[i], circles[(i + 1) % n]
            a = math.atan2(z1 - z0, y1 - y0) - math.pi / 2
            pts.append((y0 + math.cos(a) * r0, z0 + math.sin(a) * r0))
            pts.append((y1 + math.cos(a) * r1, z1 + math.sin(a) * r1))
            # Arc around the next pulley to the next tangent.
            (y2, z2, r2) = circles[(i + 2) % n]
            a2 = math.atan2(z2 - z1, y2 - y1) - math.pi / 2
            while a2 < a:
                a2 += math.tau
            steps = max(int((a2 - a) / 0.12), 1)
            for k in range(1, steps):
                t = a + (a2 - a) * k / steps
                pts.append((y1 + math.cos(t) * r1, z1 + math.sin(t) * r1))
        return pts

    # The blower belt, crank to blower: the signature of a blown motor.
    belt(wrap([(0.0, 0.53, 0.07), (0.0, 0.05, 0.096)]), -0.34, 0.04)
    belt(wrap([(0.0, 0.27, 0.063), (0.21, 0.36, 0.034), (0.0, 0.05, 0.095)]), -0.383, 0.022)

    # --- Rear: distributor, plug wires, flywheel -----------------------------
    dist = (0.33, 0.0, 0.44)
    cyl(0.032, 0.1, (dist[0], 0, dist[2] - 0.03), 'satin', axis='z')
    cyl(0.05, 0.035, dist, 'black', axis='z')
    for k, (plug, side) in enumerate(plugs):
        a = k / len(plugs) * math.tau
        term = Vector((dist[0] + math.cos(a) * 0.036, math.sin(a) * 0.036, dist[2] + 0.02))
        cyl(0.006, 0.02, term, 'black', axis='z', verts=10)
        tube([plug + Vector((0, 0, 0.02)), plug + Vector((0, side * 0.03, 0.08)),
              Vector(((plug.x + term.x) / 2, side * 0.2, 0.52)), term + Vector((0, 0, 0.02))], 0.0055, 'black')
    cyl(0.2, 0.026, (0.36, 0, 0.08), 'satin', verts=128)  # flywheel
    cyl(0.07, 0.03, (0.375, 0, 0.08), 'steel')
    for k in range(96):  # ring gear
        a = k / 96 * math.tau
        box((0.024, 0.01, 0.012), (0.36, math.cos(a) * 0.205, 0.08 + math.sin(a) * 0.205), 'steel',
            rot=(a, 0, 0), bev=0)
    for k in range(6):
        a = k / 6 * math.tau
        cyl(0.01, 0.034, (0.375, math.cos(a) * 0.05, 0.08 + math.sin(a) * 0.05), 'steel', verts=6)

    # Hoses and the dipstick.
    # Upper hose: short, ending in a stub at the thermostat housing. Run out
    # to a radiator it reached the front face of the ice.
    tube([Vector((-0.34, 0, 0.31)), Vector((-0.33, 0.0, 0.4)), Vector((-0.38, 0.03, 0.44))], 0.016, 'black')
    cyl(0.02, 0.03, (-0.395, 0.035, 0.44), 'steel')
    tube([Vector((-0.1, -0.17, 0.05)), Vector((-0.12, -0.24, 0.3)), Vector((-0.14, -0.25, 0.46))], 0.005, 'steel')
    ring(0.016, 0.004, (-0.14, -0.25, 0.48), 'steel', axis='y')

    # Curves count as meshes from here on: fitting, ray tests, the envelope.
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in curves:
        o.select_set(True)
    bpy.context.view_layer.objects.active = curves[0]
    bpy.ops.object.convert(target='MESH')
    return [o for o in g.children_recursive] + [g]


CORES = {'v8': core_v8, 'placeholder': core_placeholder, 'pencil': core_pencil, 'orrery': core_orrery}
CORE_ROT = {'v8': (math.radians(26), 0, math.radians(58)),  # front three-quarter, tipped to show the blower
             'placeholder': (0, 0, math.radians(-35)),
            'pencil': (0, 0, 0), 'orrery': (0, 0, math.radians(15))}


# --------------------------------------------------------------------------
# Envelope: the mesh the page draws on hover
# --------------------------------------------------------------------------

def envelope(core_meshes, pivot, target_faces=800, voxel=0.06):
    """An evenly triangulated skin over the given meshes: voxel remesh closes
    gaps and drops detail, Quadriflow lays an even grid over it, and
    triangulating gives the mesh its diagonals. The page draws it on hover."""
    deps = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    inv = pivot.matrix_world.inverted()
    for o in core_meshes:
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        me.transform(inv @ o.matrix_world)
        bm.from_mesh(me)
        ev.to_mesh_clear()
    env = mesh_object('Envelope', bm)
    bpy.context.view_layer.objects.active = env
    env.select_set(True)
    dims = env.dimensions
    # Coarse voxels and a strong smooth: a loose shrink-wrap, not a cast of
    # every pipe. A tight skin over a busy engine folds into a scribble;
    # the reference's mesh is an even skin.
    source = env.data.copy()
    # Quadriflow refuses a non-manifold voxel skin and only warns, leaving
    # the dense voxel mesh in place. Retry coarser, then decimate.
    done = False
    for k, v in enumerate((voxel, voxel * 1.5, voxel * 2.2)):
        if k:
            env.data = source.copy()
        env.data.remesh_voxel_size = max(dims) * v
        bpy.ops.object.voxel_remesh()
        # Shape-preserving smooth: a plain Laplacian smooth shrank the skin
        # inside the engine, where the pointer never finds it.
        sm = env.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH')
        sm.iterations = 10
        apply_modifiers(env)
        before = len(env.data.polygons)
        try:
            bpy.ops.object.quadriflow_remesh(target_faces=target_faces, use_mesh_symmetry=False,
                                             use_preserve_sharp=False, use_preserve_boundary=False)
        except Exception as e:
            print('quadriflow raised:', e)
        after = len(env.data.polygons)
        if after != before and after < target_faces * 2:
            done = True
            break
        print(f'quadriflow did not run at voxel {v:.3f} ({before} -> {after} faces)')
    if not done:
        dec = env.modifiers.new('Dec', 'DECIMATE')
        dec.ratio = target_faces * 2 / max(len(env.data.polygons), 1)
        apply_modifiers(env)
        print('envelope decimated instead of remeshed')
    tri = env.modifiers.new('Tri', 'TRIANGULATE')
    tri.quad_method = 'FIXED_ALTERNATE'
    apply_modifiers(env)
    env.hide_render = True
    print('envelope tris', len(env.data.polygons))
    return env


# --------------------------------------------------------------------------
# Motion
# --------------------------------------------------------------------------

def pose(i):
    """Frame i of FRAMES covers one sweep, -SWAY → +SWAY, eased at the ends
    like a pendulum. The page plays the sweep forward then back, which is
    the same motion as a full sine period with half the renders."""
    t = i / max(FRAMES - 1, 1)
    yaw = -SWAY * math.cos(math.pi * t)
    tilt = TILT * math.sin(math.pi * t)
    return yaw, tilt


def apply_pose(pivot, i):
    yaw, tilt = pose(i)
    pivot.rotation_euler = (tilt, 0, yaw)
    bpy.context.view_layer.update()


# --------------------------------------------------------------------------
# Build, render, pack
# --------------------------------------------------------------------------

def build():
    scene = reset()
    cam = camera(scene)
    studio(scene)
    rng = random.Random(arg('seed', {'v8': 454, 'pencil': 3, 'orrery': 27}.get(CORE, 7)))
    pivot = bpy.data.objects.new('Pivot', None)
    link(pivot)
    objs = CORES[CORE](pivot)
    root, lo, hi = fit(objs, pivot, CORE_ROT[CORE])
    meshes = [o for o in objs if o.type == 'MESH']
    ice = ice_block(rng, pivot)
    # Chips make the hull lopsided: centre the block itself on the camera,
    # carrying the core with it, so the crystal sits in the middle of its slot.
    vs = [v.co for v in ice.data.vertices]
    centre = Vector(((max(v.x for v in vs) + min(v.x for v in vs)) / 2,
                     (max(v.y for v in vs) + min(v.y for v in vs)) / 2,
                     (max(v.z for v in vs) + min(v.z for v in vs)) / 2))
    ice.location -= centre
    root.location -= centre
    bpy.context.view_layer.update()
    # Nothing may break the surface: shrink the core about its own centre
    # until every sampled point is inside the ice. Before the bubbles, so
    # they are placed around the final core.
    centre_w = -centre
    for _ in range(12):
        if report_outside(ice, meshes) == 0:
            break
        root.scale *= 0.96
        root.location = centre_w + (root.location - centre_w) * 0.96
        bpy.context.view_layer.update()
    inclusions(rng, ice, pivot, meshes)
    # The hover mesh covers the whole crystal (owner's call): the ice block's
    # own surface, evenly re-triangulated, about 1/50 of its height per edge
    # (owner asked for more divisions than the reference's ~1/40).
    env = envelope([ice], pivot, target_faces=7000, voxel=0.01)
    return scene, cam, pivot, ice, env


def export_meta(scene, cam, pivot, env):
    """Everything the page needs to draw the hover wire in register:
    the camera (Blender world, z-up), each frame's pivot rotation, and the
    envelope in pivot space."""
    bpy.context.view_layer.update()
    view = cam.matrix_world.inverted()
    rx, ry = scene.render.resolution_x, scene.render.resolution_y
    proj = cam.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(), x=rx, y=ry)
    poses = []
    for i in range(FRAMES):
        apply_pose(pivot, i)
        poses.append([round(c, 6) for row in pivot.matrix_world for c in row])
    me = env.data
    verts = [round(c, 5) for v in me.vertices for c in v.co]
    tris = [i for p in me.polygons for i in p.vertices]
    meta = {
        'core': CORE,
        'fps': FPS,
        'frames': FRAMES,
        'loop': 'pingpong',
        'aspect': WIDTH / HEIGHT,
        'view': [c for row in view for c in row],  # row-major, Blender z-up
        'proj': [c for row in proj for c in row],  # row-major, OpenGL clip
        'camera': list(cam.location),
        'poses': poses,  # pivot matrix per rendered frame, row-major
        'envelope': {'positions': verts, 'indices': tris},
    }
    os.makedirs(PUBLIC, exist_ok=True)
    with open(os.path.join(PUBLIC, f'{CORE}.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print('META', len(me.vertices), 'verts', len(tris) // 3, 'tris')


def render():
    scene, cam, pivot, ice, env = build()
    os.makedirs(OUT_DIR, exist_ok=True)
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    if '--still' in args:
        apply_pose(pivot, int(FRAMES * 0.35))
        scene.render.filepath = os.path.join(OUT_DIR, 'still.png')
        bpy.ops.render.render(write_still=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, f'{CORE}.blend'))
        print('WROTE still')
        return
    export_meta(scene, cam, pivot, env)
    if '--meta-only' in args:  # the scene is seeded: same envelope, same poses
        print('META ONLY')
        return
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, f'{CORE}.blend'))
    for i in range(FROM, FRAMES):
        path = os.path.join(OUT_DIR, f'f{i:03d}.png')
        if os.path.exists(path) and '--force' not in args:
            continue
        apply_pose(pivot, i)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print('FRAME', i, flush=True)


def pack():
    """PNG frames → stacked colour/alpha frames → H.264, plus the poster.

    Colour is premultiplied by alpha (over black) so the edge pixels the
    encoder blurs into the transparent area stay dark rather than haloing;
    the page composites with premultiplied blending. The sweep is played
    there and back inside the file, so the video loops on its own."""
    import numpy as np

    stack_dir = os.path.join(OUT_DIR, 'stack')
    os.makedirs(stack_dir, exist_ok=True)
    for f in os.listdir(stack_dir):  # a shorter loop must not inherit old frames
        if f.startswith('s') and f.endswith('.png'):
            os.remove(os.path.join(stack_dir, f))
    order = list(range(FRAMES)) + list(range(FRAMES - 2, 0, -1))
    cache = {}
    for n, i in enumerate(order):
        dst = os.path.join(stack_dir, f's{n:04d}.png')
        if i not in cache:
            img = bpy.data.images.load(os.path.join(OUT_DIR, f'f{i:03d}.png'))
            w, h = img.size
            px = np.empty(w * h * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            bpy.data.images.remove(img)
            px = px.reshape(h, w, 4)
            a = px[..., 3:4]
            rgb = px[..., :3] * a
            top = np.concatenate([rgb, np.ones_like(a)], axis=2)
            bottom = np.concatenate([np.repeat(a, 3, axis=2), np.ones_like(a)], axis=2)
            # Blender images are bottom-up: alpha goes first so it ends up below.
            cache[i] = np.concatenate([bottom, top], axis=0)
        frame = cache[i]
        h2, w = frame.shape[0], frame.shape[1]
        out = bpy.data.images.new('stack', w, h2, alpha=False)
        out.pixels.foreach_set(frame.ravel())
        out.filepath_raw = dst
        out.file_format = 'PNG'
        out.save()
        bpy.data.images.remove(out)
    print('STACKED', len(order))

    # Encode with Blender's own FFmpeg through the sequencer.
    scene = bpy.context.scene
    scene.render.resolution_x = w
    scene.render.resolution_y = h2
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.sequencer_colorspace_settings.name = 'sRGB'
    se = scene.sequence_editor_create()
    strips = se.strips if hasattr(se, 'strips') else se.sequences
    files = sorted(os.listdir(stack_dir))
    strip = strips.new_image('stack', os.path.join(stack_dir, files[0]), 1, 1)
    for f in files[1:]:
        strip.elements.append(f)
    strip.colorspace_settings.name = 'sRGB'
    scene.frame_start = 1
    scene.frame_end = len(files)
    r = scene.render
    r.use_sequencer = True
    try:
        r.image_settings.media_type = 'VIDEO'  # Blender 5: video is its own media type
    except AttributeError:
        pass
    r.image_settings.file_format = 'FFMPEG'
    r.ffmpeg.format = 'MPEG4'
    r.ffmpeg.codec = 'H264'
    r.ffmpeg.constant_rate_factor = arg('crf', 'HIGH')
    r.ffmpeg.ffmpeg_preset = 'BEST'
    r.ffmpeg.gopsize = FPS
    r.ffmpeg.audio_codec = 'NONE'
    os.makedirs(PUBLIC, exist_ok=True)
    r.filepath = os.path.join(PUBLIC, f'{CORE}_')
    bpy.ops.render.render(animation=True)
    produced = [f for f in os.listdir(PUBLIC) if f.startswith(f'{CORE}_') and f.endswith('.mp4')]
    final = os.path.join(PUBLIC, f'{CORE}.mp4')
    if produced:
        os.replace(os.path.join(PUBLIC, produced[0]), final)
    print('ENCODED', final)

    # Poster: the middle of the sweep, the pose the reduced-motion page holds.
    mid = FRAMES // 2
    img = bpy.data.images.load(os.path.join(OUT_DIR, f'f{mid:03d}.png'))
    try:
        scene.render.image_settings.media_type = 'IMAGE'
    except AttributeError:
        pass
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.quality = 86
    img.save_render(filepath=os.path.join(PUBLIC, f'{CORE}.webp'), scene=scene)
    print('POSTER')


if '--pack' in args:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    pack()
else:
    render()
