import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseGlb } from "../src/glb.ts";

function makeGlb({ extensionsUsed, alphaMode, doubleSided, nonIndexed, mode, missingNormal } = {}) {
  const bin = Buffer.alloc(36 + 36 + 6 + 48);
  let p = 0;
  for (const v of [-1,0,0, 1,0,0, 0,1,0]) { bin.writeFloatLE(v,p);p+=4; }
  for (const v of [1,1,0, 1,1,0, 1,1,0]) { bin.writeFloatLE(v,p);p+=4; }
  [0,1,2].forEach((v,i)=>bin.writeUInt16LE(v,72+i*2));
  let cp=78;
  for(const v of [1,1,1,0, 1,1,1,0, 1,1,1,0]){bin.writeFloatLE(v,cp);cp+=4;}
  const doc = {
    asset:{version:"2.0"}, scene:0, scenes:[{nodes:[0]}],
    nodes:[{name:"parent",translation:[1,0,0],children:[1]},{name:"nested",scale:[-2,3,1],mesh:0}],
    meshes:[{name:"triangle",primitives:[{attributes:missingNormal?{POSITION:0,COLOR_0:3}:{POSITION:0,NORMAL:1,COLOR_0:3},indices:nonIndexed?undefined:2,mode,material:0}]}],
    materials:[{name:"green",alphaMode:alphaMode??"OPAQUE",doubleSided:doubleSided??false,pbrMetallicRoughness:{baseColorFactor:[0.2,0.4,0.6,0.5]}}],
    buffers:[{byteLength:bin.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36},{buffer:0,byteOffset:72,byteLength:6},{buffer:0,byteOffset:78,byteLength:48}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:"VEC3"},{bufferView:1,componentType:5126,count:3,type:"VEC3"},{bufferView:2,componentType:5123,count:3,type:"SCALAR"},{bufferView:3,componentType:5126,count:3,type:"VEC4"}],
    ...(extensionsUsed ? {extensionsUsed} : {}),
  };
  let json=Buffer.from(JSON.stringify(doc));while(json.length%4)json=Buffer.concat([json,Buffer.from(" ")]);
  const paddedBin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
  const total=12+8+json.length+8+paddedBin.length;
  const glb=Buffer.concat([Buffer.from([0x67,0x6c,0x54,0x46,2,0,0,0,total&255,(total>>>8)&255,(total>>>16)&255,(total>>>24)&255]),
    Buffer.from([json.length&255,(json.length>>>8)&255,(json.length>>>16)&255,(json.length>>>24)&255,0x4a,0x53,0x4f,0x4e]),json,
    Buffer.from([paddedBin.length&255,(paddedBin.length>>>8)&255,(paddedBin.length>>>16)&255,(paddedBin.length>>>24)&255,0x42,0x49,0x4e,0]),paddedBin]);
  return glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength);
}

test("mock fixture is multi-mesh and multi-material", async () => {
  const data=await readFile(new URL("../public/mock-tea-stall.glb",import.meta.url));
  const asset=parseGlb(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
  assert.ok(asset.meshes.length>3);
  assert.ok(asset.materials.length>1);
  assert.ok(asset.bounds.max[1]>1);
  assert.ok(asset.meshes.every(m=>m.vertices.length%10===0 && m.indices.length%3===0));
  const red=asset.meshes.find(m=>m.materialIndex===1);
  assert.ok(red);
  assert.ok(red.vertices[6]>0.6 && red.vertices[7]<0.2 && red.vertices[9]===1);
});

test("applies nested transforms, inverse-transpose normals and negative determinant winding", () => {
  const data=makeGlb();
  const asset=parseGlb(data);
  const mesh=asset.meshes[0];
  assert.deepEqual(mesh.bounds.min,[-1,0,0]);
  assert.deepEqual(mesh.bounds.max,[3,3,0]);
  assert.deepEqual(Array.from(mesh.indices),[0,2,1]);
  assert.ok(Math.abs(mesh.vertices[3]+0.8320503)<1e-5);
  assert.ok(Math.abs(mesh.vertices[4]-0.5547002)<1e-5);
  assert.ok(Math.abs(mesh.vertices[5])<1e-7);
  for (const [i,v] of [0.2,0.4,0.6,1].entries()) assert.ok(Math.abs(mesh.vertices[6+i]-v)<1e-6);
});

test("supports non-indexed triangle lists and rejects missing normals/unsupported modes", () => {
  const nonIndexed=parseGlb(makeGlb({nonIndexed:true}));
  assert.deepEqual(Array.from(nonIndexed.meshes[0].indices),[0,2,1]);
  assert.throws(()=>parseGlb(makeGlb({missingNormal:true})),/is missing NORMAL/);
  assert.throws(()=>parseGlb(makeGlb({mode:1})),/is not TRIANGLES/);
});

test("ignores alpha for opaque COLOR_0/baseColorFactor while preserving RGB", () => {
  const mesh=parseGlb(makeGlb()).meshes[0];
  assert.ok(Math.abs(mesh.vertices[6]-0.2)<1e-6);
  assert.ok(Math.abs(mesh.vertices[7]-0.4)<1e-6);
  assert.ok(Math.abs(mesh.vertices[8]-0.6)<1e-6);
  assert.equal(mesh.vertices[9],1);
});

test("preserves doubleSided material identity", () => {
  const asset=parseGlb(makeGlb({doubleSided:true}));
  assert.equal(asset.materials[0].doubleSided,true);
  assert.equal(asset.meshes[0].doubleSided,true);
});

test("rejects compression/extensions and transparent materials with actionable errors", () => {
  assert.throws(()=>parseGlb(makeGlb({extensionsUsed:["KHR_draco_mesh_compression"]})), /unsupported glTF extension/);
  assert.throws(()=>parseGlb(makeGlb({alphaMode:"BLEND"})), /only opaque materials are supported/);
});
