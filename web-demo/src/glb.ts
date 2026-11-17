export interface SceneMaterial {
    name: string;
    baseColor: [number, number, number, number];
    doubleSided: boolean;
}

export interface SceneMesh {
    name: string;
    materialIndex: number;
    doubleSided: boolean;
    vertices: Float32Array; // position.xyz, normal.xyz, color.rgba
    indices: Uint32Array;
    bounds: { min: [number, number, number]; max: [number, number, number] };
}

export interface SceneAsset {
    meshes: SceneMesh[];
    materials: SceneMaterial[];
    bounds: { min: [number, number, number]; max: [number, number, number] };
    warnings: string[];
}

type GltfPrimitive = { attributes: Record<string, number>; indices?: number; material?: number; mode?: number };
type GltfDocument = {
    asset?: { version?: string };
    extensionsUsed?: string[];
    extensionsRequired?: string[];
    buffers?: { byteLength: number; uri?: string }[];
    bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }[];
    accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean; min?: number[]; max?: number[] }[];
    meshes?: { name?: string; primitives: GltfPrimitive[] }[];
    nodes?: { name?: string; mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
    scenes?: { nodes?: number[] }[];
    scene?: number;
    materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] }; alphaMode?: string; doubleSided?: boolean }[];
    textures?: unknown[];
    images?: unknown[];
    skins?: unknown[];
    animations?: unknown[];
};

const componentBytes: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };

function fail(message: string): never { throw new Error(`GLB import: ${message}`); }
function identity(): number[] { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mul(a: number[], b: number[]): number[] {
    const o = new Array<number>(16).fill(0);
    for (let c=0;c<4;c++) for (let r=0;r<4;r++) for (let k=0;k<4;k++) o[c*4+r] += a[k*4+r]*b[c*4+k];
    return o;
}
function nodeMatrix(node: NonNullable<GltfDocument["nodes"]>[number]): number[] {
    if (node.matrix) {
        if (node.matrix.length !== 16) fail("node.matrix must contain 16 values");
        return [...node.matrix];
    }
    const [x,y,z,w] = node.rotation ?? [0,0,0,1];
    const [sx,sy,sz] = node.scale ?? [1,1,1];
    const [tx,ty,tz] = node.translation ?? [0,0,0];
    return [
        (1-2*y*y-2*z*z)*sx, (2*x*y+2*w*z)*sx, (2*x*z-2*w*y)*sx, 0,
        (2*x*y-2*w*z)*sy, (1-2*x*x-2*z*z)*sy, (2*y*z+2*w*x)*sy, 0,
        (2*x*z+2*w*y)*sz, (2*y*z-2*w*x)*sz, (1-2*x*x-2*y*y)*sz, 0,
        tx,ty,tz,1,
    ];
}
function determinant3(m: number[]): number {
    const a=m[0], b=m[4], c=m[8], d=m[1], e=m[5], f=m[9], g=m[2], h=m[6], i=m[10];
    return a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
}
function transformNormal(m: number[], n: number[]): [number,number,number] {
    // inverse-transpose of the affine 3x3 (cofactor matrix divided by determinant)
    const a=m[0], b=m[4], c=m[8], d=m[1], e=m[5], f=m[9], g=m[2], h=m[6], i=m[10];
    const det=determinant3(m);
    if (Math.abs(det)<1e-12) fail("singular node transform cannot transform normals");
    const x=((e*i-f*h)*n[0]+(f*g-d*i)*n[1]+(d*h-e*g)*n[2])/det;
    const y=((c*h-b*i)*n[0]+(a*i-c*g)*n[1]+(b*g-a*h)*n[2])/det;
    const z=((b*f-c*e)*n[0]+(c*d-a*f)*n[1]+(a*e-b*d)*n[2])/det;
    const len=Math.hypot(x,y,z);
    return len > 1e-20 ? [x/len,y/len,z/len] : [0,1,0];
}
function transformPosition(m: number[], p: number[]): [number,number,number] {
    const x=p[0],y=p[1],z=p[2],w=m[3]*x+m[7]*y+m[11]*z+m[15];
    if (Math.abs(w)<1e-20) fail("position transform produced zero homogeneous w");
    return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,(m[2]*x+m[6]*y+m[10]*z+m[14])/w];
}
function boundsOf(vertices: Float32Array) {
    const min:[number,number,number]=[Infinity,Infinity,Infinity], max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<vertices.length;i+=10) for(let c=0;c<3;c++){const v=vertices[i+c];min[c]=Math.min(min[c],v);max[c]=Math.max(max[c],v);}
    return {min,max};
}

/** Narrow static GLB 2 adapter: external/data URI buffers, compression, textures and extensions are rejected. */
export function parseGlb(input: ArrayBuffer): SceneAsset {
    const view = new DataView(input);
    if(input.byteLength<20 || view.getUint32(0,true)!==0x46546c67) fail("invalid GLB magic");
    if(view.getUint32(4,true)!==2) fail("only GLB version 2 is supported");
    if(view.getUint32(8,true)!==input.byteLength) fail("header length does not match file size");
    let offset=12, json:GltfDocument|undefined, bin:ArrayBuffer|undefined;
    while(offset+8<=input.byteLength){
        const len=view.getUint32(offset,true), type=view.getUint32(offset+4,true); offset+=8;
        if(offset+len>input.byteLength) fail("chunk extends beyond file");
        if(type===0x4e4f534a) json=JSON.parse(new TextDecoder().decode(new Uint8Array(input,offset,len)).replace(/[\\u0000\\s]+$/g,"")) as GltfDocument;
        else if(type===0x004e4942) bin=input.slice(offset,offset+len);
        offset+=len;
    }
    if(!json || json.asset?.version!=="2.0") fail("missing glTF 2.0 JSON chunk");
    if((json.extensionsRequired?.length??0)>0 || (json.extensionsUsed?.length??0)>0) fail(`unsupported glTF extension(s): ${[...(json.extensionsRequired??[]),...(json.extensionsUsed??[])].join(", ")}`);
    if((json.buffers?.length??0)>1) fail("multiple buffers are unsupported");
    if((json.textures?.length??0)>0 || (json.images?.length??0)>0) fail("textures/images are unsupported; use opaque baseColorFactor materials");
    if((json.skins?.length??0)>0) fail("skinned meshes are unsupported; provide static geometry");
    if((json.animations?.length??0)>0) fail("animations are unsupported; provide static geometry");
    if(json.buffers?.some(b=>b.uri)) fail("external or data URI buffers are unsupported; provide a self-contained GLB");
    if(json.buffers?.length && !bin) fail("BIN chunk is missing");
    const bufferViews=json.bufferViews??[], accessors=json.accessors??[];
    const accessor=(idx:number, expected:string):number[][]=>{
        const a=accessors[idx]; if(!a) fail(`accessor ${idx} does not exist`);
        if(a.type!==expected) fail(`accessor ${idx} must have type ${expected}`);
        if(a.componentType!==5126 && !(expected==="SCALAR" && [5121,5123,5125].includes(a.componentType))) fail(`accessor ${idx} has unsupported component type ${a.componentType}`);
        if(a.bufferView===undefined) fail(`accessor ${idx} sparse/implicit data is unsupported`);
        const bv=bufferViews[a.bufferView]; if(!bv || bv.buffer!==0 || !bin) fail(`accessor ${idx} has invalid bufferView`);
        const n=expected==="VEC3"?3:expected==="VEC4"?4:1, size=componentBytes[a.componentType], stride=bv.byteStride??size*n, start=(bv.byteOffset??0)+(a.byteOffset??0);
        if(stride<size*n) fail(`accessor ${idx} has invalid byteStride`);
        const arr:number[][]=[];
        for(let i=0;i<a.count;i++){
            const vals:number[]=[];
            for(let c=0;c<n;c++){
                const p=start+i*stride+c*size;
                if(p+size>(bv.byteOffset??0)+bv.byteLength || p+size>bin.byteLength) fail(`accessor ${idx} reads beyond bufferView`);
                let v:number;
                if(a.componentType===5126)v=new DataView(bin).getFloat32(p,true);
                else if(a.componentType===5121)v=new DataView(bin).getUint8(p);
                else if(a.componentType===5123)v=new DataView(bin).getUint16(p,true);
                else v=new DataView(bin).getUint32(p,true);
                if(a.normalized && a.componentType===5121)v/=255;
                if(a.normalized && a.componentType===5123)v/=65535;
                vals.push(v);
            }
            arr.push(vals);
        }
        return arr;
    };
    const materials=(json.materials??[]).map((m,i)=>{
        if(m.alphaMode && m.alphaMode!=="OPAQUE") fail(`material ${m.name??i} uses ${m.alphaMode}; only opaque materials are supported`);
        if((m as any).extensions) fail(`material ${m.name??i} uses unsupported extensions`);
        const c=m.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1];
        return {name:m.name??`Material ${i}`,baseColor:[c[0],c[1],c[2],c[3]] as [number,number,number,number],doubleSided:m.doubleSided??false};
    });
    if(!materials.length) materials.push({name:"Default",baseColor:[1,1,1,1],doubleSided:false});
    const meshes:SceneMesh[]=[];
    const sourceMeshes=json.meshes??[], nodes=json.nodes??[];
    const visit=(nodeIndex:number,parent:number[],stack:Set<number>)=>{
        if(stack.has(nodeIndex))fail("node hierarchy contains a cycle");
        const node=nodes[nodeIndex]; if(!node)fail(`node ${nodeIndex} does not exist`);
        const world=mul(parent,nodeMatrix(node)), det=determinant3(world);
        if(Math.abs(det)<1e-12)fail(`node ${node.name??nodeIndex} has singular transform`);
        if(node.mesh!==undefined){
            const src=sourceMeshes[node.mesh]; if(!src)fail(`node ${node.name??nodeIndex} references missing mesh ${node.mesh}`);
            for(let pi=0;pi<src.primitives.length;pi++){
                const p=src.primitives[pi];
                if((p.mode??4)!==4)fail(`mesh ${src.name??node.mesh} primitive ${pi} is not TRIANGLES`);
                if((p as any).targets || (p as any).extensions) fail(`mesh ${src.name??node.mesh} primitive ${pi} uses morph targets/extensions`);
                const pos=accessor(p.attributes.POSITION,"VEC3"), normIndex=p.attributes.NORMAL;
                if(normIndex===undefined)fail(`mesh ${src.name??node.mesh} primitive ${pi} is missing NORMAL`);
                const normals=accessor(normIndex,"VEC3");
                const colorAccessor=p.attributes.COLOR_0===undefined?undefined:accessors[p.attributes.COLOR_0];
                if(colorAccessor && colorAccessor.type!=="VEC3" && colorAccessor.type!=="VEC4") fail("COLOR_0 must be VEC3 or VEC4");
                const colors=colorAccessor?accessor(p.attributes.COLOR_0,colorAccessor.type):undefined;
                if(normals.length!==pos.length || (colors && colors.length!==pos.length))fail("attribute counts do not match POSITION");
                const verts=new Float32Array(pos.length*10);
                for(let i=0;i<pos.length;i++){
                    const wp=transformPosition(world,pos[i]), wn=transformNormal(world,normals[i]), color=colors?.[i]??[1,1,1,1], base=materials[p.material??0]?.baseColor;
                    for(let c=0;c<3;c++){verts[i*10+c]=wp[c];verts[i*10+3+c]=wn[c];}
                    for(let c=0;c<3;c++)verts[i*10+6+c]=(color[c]??1)*(base?.[c]??1);
                    // OPAQUE glTF materials ignore baseColorFactor.a and COLOR_0.a. This lane
                    // is renderer metadata (0=legacy procedural, 1=GLB, 2=double-sided GLB).
                    verts[i*10+9]=1;
                }
                let inds=p.indices===undefined?Array.from({length:pos.length},(_,i)=>i):accessor(p.indices,"SCALAR").map(v=>v[0]);
                if(inds.length%3)fail("triangle index count is not divisible by 3");
                if(det<0)for(let i=0;i<inds.length;i+=3)[inds[i+1],inds[i+2]]=[inds[i+2],inds[i+1]];
                if(inds.some(i=>i<0||i>=pos.length||!Number.isInteger(i)))fail("index is outside POSITION accessor");
                const materialIndex=p.material??0;
                if(materialIndex>=materials.length)fail(`primitive references missing material ${materialIndex}`);
                const v=new Float32Array(verts);
                meshes.push({name:`${node.name??src.name??`Mesh ${node.mesh}`}${src.primitives.length>1?` / part ${pi+1}`:""}`,materialIndex,doubleSided:materials[materialIndex].doubleSided,vertices:v,indices:Uint32Array.from(inds),bounds:boundsOf(v)});
            }
        }
        const next=new Set(stack);next.add(nodeIndex);
        for(const child of node.children??[])visit(child,world,next);
    };
    if(nodes.length){
        const scene=json.scenes?.[json.scene??0];
        if(!scene)fail("scene root is missing");
        for(const root of scene.nodes??[])visit(root,identity(),new Set());
    }else{
        for(let i=0;i<sourceMeshes.length;i++) visitMeshDirect(sourceMeshes[i],i);
    }
    function visitMeshDirect(src: NonNullable<GltfDocument["meshes"]>[number], meshIndex:number) {
        const nodeIndex=nodes.length;
        // Reuse the normal importer by constructing one identity node.
        nodes.push({name:src.name??`Mesh ${meshIndex}`,mesh:meshIndex});
        visit(nodeIndex,identity(),new Set());
        nodes.pop();
    }
    if(!meshes.length)fail("scene contains no renderable triangle primitives");
    const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
    for(const mesh of meshes)for(let c=0;c<3;c++){min[c]=Math.min(min[c],mesh.bounds.min[c]);max[c]=Math.max(max[c],mesh.bounds.max[c]);}
    return {meshes,materials,bounds:{min,max},warnings:[]};
}

export async function loadGlb(url:string, signal?:AbortSignal):Promise<SceneAsset>{
    const response=await fetch(url,{signal});
    if(!response.ok)throw new Error(`GLB load failed (${response.status}): ${url}`);
    return parseGlb(await response.arrayBuffer());
}
