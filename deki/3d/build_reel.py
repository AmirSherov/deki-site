"""
Builds the 3D DEKI reel (the "d" logotype) and exports it as a glTF binary.

    E:/Blender/blender.exe -b -P 3d/build_reel.py -- <out_dir>

The disc lies in Blender's XZ plane facing -Y, so after the glTF Y-up
conversion it faces +Z in three.js. Mesh names (Tape, Disc, Hub, Stem,
Inlay) are used by the site to assign materials at runtime.
"""
import math
import os
import sys

import bpy
import bmesh

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else os.path.join(os.path.dirname(__file__), "..", "assets"))
os.makedirs(OUT, exist_ok=True)

SEG = 128  # radial segments: smooth silhouette, still light


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, roughness=0.3, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def annulus(name, r_out, r_in, depth, y=0.0, bevel=0.02, mat=None):
    """Ring standing in XZ plane, centred on y, thickness along Y."""
    bm = bmesh.new()
    outer = bmesh.ops.create_circle(bm, cap_ends=False, radius=r_out, segments=SEG)["verts"]
    inner = bmesh.ops.create_circle(bm, cap_ends=False, radius=r_in, segments=SEG)["verts"]
    bmesh.ops.bridge_loops(bm, edges=[e for e in bm.edges])
    face_geom = bm.faces[:]
    ext = bmesh.ops.extrude_face_region(bm, geom=face_geom)
    moved = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, 0, depth))
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, -depth / 2))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    # stand it up: circle was in XY, rotate so it faces -Y
    ob.rotation_euler = (math.radians(90), 0, 0)
    ob.location.y = y
    if mat:
        me.materials.append(mat)
    finish(ob, bevel)
    return ob


def box(name, sx, sy, sz, loc, bevel=0.02, mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    if mat:
        ob.data.materials.append(mat)
    finish(ob, bevel)
    return ob


def finish(ob, bevel):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    if bevel:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(50)
        mod.harden_normals = True
    ob.data.shade_smooth()
    try:
        ob.data.set_sharp_from_angle(angle=math.radians(40))
    except Exception:
        pass
    bpy.ops.object.select_all(action="DESELECT")


def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    ob.select_set(False)


def boolean(target, cutter, op="DIFFERENCE"):
    mod = target.modifiers.new("Bool", "BOOLEAN")
    mod.operation = op
    mod.object = cutter
    mod.solver = "EXACT"
    bpy.context.view_layer.objects.active = target
    target.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    target.select_set(False)
    bpy.data.objects.remove(cutter, do_unlink=True)


def build():
    reset()
    black = material("Tape", (0.006, 0.006, 0.007), metallic=0.1, roughness=0.22)
    green = material("Disc", (0.10, 1.0, 0.0), roughness=0.32,
                     emission=(0.10, 1.0, 0.0), strength=0.15)
    hub = material("Hub", (0.16, 0.85, 0.0), roughness=0.4,
                   emission=(0.16, 0.85, 0.0), strength=0.2)
    gold = material("Inlay", (0.85, 0.62, 0.22), metallic=1.0, roughness=0.25)

    # outer tape winding (black) + gold inlays on the front face
    tape = annulus("Tape", 1.0, 0.78, 0.24, bevel=0.025, mat=black)
    for r in (0.995, 0.885):
        annulus("Inlay", r, r - 0.012, 0.012, y=-0.125, bevel=0.0, mat=gold)

    # tape tail rising tangentially into the stem of the "d"
    stem = box("Stem", 0.11, 0.24, 1.42, (0.945, 0, 0.62), bevel=0.025, mat=black)
    box("Inlay", 0.012, 0.012, 1.35, (0.893, -0.125, 0.70), bevel=0.0, mat=gold)

    # bright green reel, slightly proud of the tape
    annulus("Disc", 0.775, 0.625, 0.30, bevel=0.025, mat=green)
    annulus("Disc", 0.595, 0.45, 0.28, bevel=0.025, mat=green)
    annulus("Hub", 0.63, 0.59, 0.22, bevel=0.0, mat=hub)

    # inner hub with the six cassette teeth
    annulus("Hub", 0.45, 0.335, 0.26, bevel=0.02, mat=hub)
    for i in range(6):
        a = math.radians(90 + i * 60)
        t = box("Hub", 0.13, 0.22, 0.13, (0, 0, 0.285), bevel=0.012, mat=hub)
        bpy.context.view_layer.objects.active = t
        t.select_set(True)
        bpy.ops.object.transform_apply(location=True)
        t.select_set(False)
        t.rotation_euler = (0, math.pi / 2 - a, 0)

    for ob in list(bpy.context.scene.objects):
        if ob.type == "MESH":
            apply_all(ob)

    # merge by material name so the GLB has one mesh per material
    groups = {}
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH":
            groups.setdefault(ob.data.materials[0].name if ob.data.materials else ob.name, []).append(ob)
    for name, obs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        bpy.context.active_object.name = name

    # centre the composition on the reel centre (origin) — already true
    return groups.keys()


def export():
    path = os.path.join(OUT, "deki_reel.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_materials="EXPORT",
    )
    print("EXPORTED", path, os.path.getsize(path))


def render_poster():
    """Studio still used as the no-WebGL fallback and social preview."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1400
    scene.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("W")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.0, 0.05, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.4

    def light(name, kind, loc, energy, color, size=2.0):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.color = color
        if kind == "AREA":
            ld.size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        c = lo.constraints.new("TRACK_TO")
        tgt = bpy.data.objects.get("Disc")
        c.target = tgt
        scene.collection.objects.link(lo)

    light("Key", "AREA", (-3, -4, 3), 900, (1, 1, 1), 3)
    light("Rim", "AREA", (4, 2, 2.5), 1200, (0.55, 0.2, 1.0), 2)
    light("Fill", "AREA", (2, -4, -2), 300, (0.4, 1.0, 0.3), 3)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 70
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = (2.6, -6.4, 1.6)
    scene.collection.objects.link(cam)
    scene.camera = cam
    empty = bpy.data.objects.new("Aim", None)
    empty.location = (0.2, 0, 0.25)
    scene.collection.objects.link(empty)
    c = cam.constraints.new("TRACK_TO")
    c.target = empty

    for ob in scene.objects:
        if ob.type == "MESH":
            ob.rotation_euler.z = math.radians(-14)

    scene.render.filepath = os.path.join(OUT, "deki_reel.png")
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
            try:
                prefs.compute_device_type = dev
                prefs.get_devices()
                if any(d.type == dev for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = True
                    scene.cycles.device = "GPU"
                    break
            except Exception:
                continue
    except Exception:
        pass
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath)


build()
export()
if "--no-render" not in argv:
    render_poster()
