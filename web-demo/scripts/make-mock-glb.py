#!/usr/bin/env python3
"""Generate a clearly synthetic, demo-only glTF 2.0 GLB fixture; not production geometry."""
import json, math, os, struct

parts = []
materials = [
    {"name":"Weathered teal table","pbrMetallicRoughness":{"baseColorFactor":[0.24,0.36,0.33,1]}},
    {"name":"Stool red","pbrMetallicRoughness":{"baseColorFactor":[0.72,0.08,0.055,1]}},
    {"name":"Ivory hat","doubleSided":True,"pbrMetallicRoughness":{"baseColorFactor":[0.85,0.77,0.57,1]}},
    {"name":"Bamboo","pbrMetallicRoughness":{"baseColorFactor":[0.43,0.31,0.13,1]}},
    {"name":"Pavement","pbrMetallicRoughness":{"baseColorFactor":[0.37,0.39,0.36,1]}},
]
def add_box(name, center, size, mat):
    cx,cy,cz=center; sx,sy,sz=[v/2 for v in size]
    faces=[
      ((-1,0,0),[(-sx,-sy,-sz),(-sx,-sy,sz),(-sx,sy,sz),(-sx,sy,-sz)]),
      ((1,0,0),[(sx,-sy,sz),(sx,-sy,-sz),(sx,sy,-sz),(sx,sy,sz)]),
      ((0,-1,0),[(-sx,-sy,sz),(-sx,-sy,-sz),(sx,-sy,-sz),(sx,-sy,sz)]),
      ((0,1,0),[(-sx,sy,-sz),(-sx,sy,sz),(sx,sy,sz),(sx,sy,-sz)]),
      ((0,0,-1),[(sx,-sy,-sz),(-sx,-sy,-sz),(-sx,sy,-sz),(sx,sy,-sz)]),
      ((0,0,1),[(-sx,-sy,sz),(sx,-sy,sz),(sx,sy,sz),(-sx,sy,sz)]),
    ]
    pos=[]; nor=[]; inds=[]
    for n,quad in faces:
        b=len(pos)//3
        for x,y,z in quad: pos.extend([x+cx,y+cy,z+cz]); nor.extend(n)
        inds.extend([b,b+1,b+2,b,b+2,b+3])
    parts.append((name,mat,pos,nor,inds))
def add_cylinder(name, center, radius, height, mat, sides=16):
    cx,cy,cz=center; pos=[]; nor=[]; inds=[]
    # side quads with smooth radial normals; top/bottom caps are explicit flat faces
    for j in range(sides):
        a=2*math.pi*j/sides; b=2*math.pi*(j+1)/sides
        base=len(pos)//3
        for y,ang in [(-height/2,a),(-height/2,b),(height/2,b),(height/2,a)]:
            pos.extend([cx+radius*math.cos(ang),cy+y,cz+radius*math.sin(ang)])
            nor.extend([math.cos(ang),0,math.sin(ang)])
        inds.extend([base,base+1,base+2,base,base+2,base+3])
    for y,up in [(-height/2,-1),(height/2,1)]:
        base=len(pos)//3; pos.extend([cx,cy+y,cz]);nor.extend([0,up,0])
        for j in range(sides):
            a=2*math.pi*j/sides;b=2*math.pi*(j+1)/sides
            pos.extend([cx+radius*math.cos(a),cy+y,cz+radius*math.sin(a)])
            pos.extend([cx+radius*math.cos(b),cy+y,cz+radius*math.sin(b)])
            nor.extend([0,up,0,0,up,0])
            inds.extend([base,base+1,base+2] if up>0 else [base,base+2,base+1])
    parts.append((name,mat,pos,nor,inds))
# compact recognizable layout around origin
add_box("Pavement", (0,-0.08,0),(5.4,0.16,4.2),4)
add_box("Tea table top", (0,0.83,0),(1.65,0.14,0.82),0)
for x in [-0.68,0.68]:
  for z in [-0.29,0.29]: add_box("Table leg", (x,0.40,z),(0.09,0.75,0.09),0)
for x,z in [(-1.25,-0.45),(1.24,-0.38),(-0.5,0.95),(0.62,1.02)]:
  add_cylinder("Backless red stool seat",(x,0.42,z),0.24,0.09,1)
  for dx,dz in [(-0.14,-0.14),(0.14,-0.14),(-0.14,0.14),(0.14,0.14)]:
    add_box("Stool leg",(x+dx,0.20,z+dz),(0.07,0.40,0.07),1)
add_cylinder("Conical-hat mock crown",(0.12,1.12,0.03),0.27,0.16,2)
# broad brim as a thin ivory disk
add_cylinder("Conical-hat mock brim",(0.12,1.03,0.03),0.65,0.035,2)
add_cylinder("Bamboo pipe",(0.55,1.38,-0.05),0.035,1.1,3,12)
add_cylinder("Tea jar",(0.05,0.98,-0.16),0.10,0.14,3,12)
def u32(x): return struct.pack('<I',x)
binary=bytearray(); views=[]; accessors=[]; meshes=[]; nodes=[]
def add_view(payload,target):
    while len(binary)%4: binary.append(0)
    start=len(binary);binary.extend(payload)
    idx=len(views);views.append({"buffer":0,"byteOffset":start,"byteLength":len(payload),"target":target});return idx
for idx,(name,mat,pos,nor,ind) in enumerate(parts):
    pv=add_view(struct.pack('<%sf'%len(pos),*pos),34962)
    nv=add_view(struct.pack('<%sf'%len(nor),*nor),34962)
    iv=add_view(struct.pack('<%sH'%len(ind),*ind),34963)
    pa=len(accessors);accessors.append({"bufferView":pv,"componentType":5126,"count":len(pos)//3,"type":"VEC3"})
    na=len(accessors);accessors.append({"bufferView":nv,"componentType":5126,"count":len(nor)//3,"type":"VEC3"})
    ia=len(accessors);accessors.append({"bufferView":iv,"componentType":5123,"count":len(ind),"type":"SCALAR"})
    meshes.append({"name":name,"primitives":[{"attributes":{"POSITION":pa,"NORMAL":na},"indices":ia,"material":mat}]})
    nodes.append({"name":name,"mesh":idx})
doc={"asset":{"version":"2.0","generator":"Vietnamese Tea Stall mock fixture generator"},
     "scene":0,"scenes":[{"nodes":list(range(len(nodes)))}],"nodes":nodes,"meshes":meshes,
     "materials":materials,"buffers":[{"byteLength":len(binary)}],"bufferViews":views,"accessors":accessors}
j=json.dumps(doc,separators=(',',':')).encode()
while len(j)%4:j+=b' '
while len(binary)%4:binary.append(0)
total=12+8+len(j)+8+len(binary)
out=struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
os.makedirs('public',exist_ok=True)
open('public/mock-tea-stall.glb','wb').write(out)
print(f'Wrote public/mock-tea-stall.glb ({len(out)} bytes), {len(meshes)} named meshes, {len(materials)} materials; SYNTHETIC MOCK ONLY')
