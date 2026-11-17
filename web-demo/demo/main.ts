import { uploadTriangles } from "../src/bvh";
import { loadGlb, type SceneAsset } from "../src/glb";
import { createCubemap } from "../src/cubemap";
import { createLBVH, dispatchLBVH } from "../src/lbvh";
import { computeVertexAABB } from "../src/lighting";
import { lookAt, multiply, perspective } from "../src/math";
import { createGodRays } from "../src/godrays";
import { createPostProcess } from "../src/post";
import { createSplat } from "../src/splat";
import { createSphere, createStones } from "./scene";
import { createDirect } from "./direct";
import {
    createSky,
    sampleGradient,
    lightDirection,
    shadowFade,
    uploadSky,
    uploadSkyScene,
} from "../src/sky";

const query = new URLSearchParams(location.search);
const probeSizeLevels = [192, 384, 512];
const probeSizeParam = Number(query.get("probeSize") ?? 384);
const PROBE_SIZE = probeSizeLevels.includes(probeSizeParam) ? probeSizeParam : 384;
const probeSpacingLevels = [0.5, 1, 2];
const probeSpacingParam = Number(query.get("probeSpacing") ?? 1);
const PROBE_SPACING = probeSpacingLevels.includes(probeSpacingParam) ? probeSpacingParam : 1;
const qualityLevels = [1, 1.5, 2.5];
const requestedQuality = Number(query.get("quality") ?? 2.5);
const renderQuality = qualityLevels.includes(requestedQuality) ? requestedQuality : 2.5;
const FOV = 60;
const fovRad = (FOV * Math.PI) / 180;
const viewportH = Math.ceil(renderQuality * PROBE_SIZE * Math.tan(fovRad / 2));

const bar = document.querySelector(".loading-bar") as HTMLElement;
const overlay = document.querySelector(".loading-overlay") as HTMLElement;
const rendererStatus = document.getElementById("renderer-status");
const sceneState = document.getElementById("scene-state");
const baselineScene = query.get("baseline") === "1";
const sceneSelect = document.getElementById("scene-select") as HTMLSelectElement | null;
function setRendererStatus(message: string) { if (rendererStatus) rendererStatus.textContent = message; }
function sceneUrl(): string { return query.get("asset") || "./production/tea-stall.glb"; }
if (sceneSelect) sceneSelect.value = baselineScene ? "baseline" : (query.get("scene") === "mock" ? "mock" : "asset");
sceneSelect?.addEventListener("change", () => {
    const next = new URL(location.href);
    next.searchParams.delete("baseline");
    if (sceneSelect.value === "baseline") next.searchParams.set("baseline", "1");
    else next.searchParams.set("scene", sceneSelect.value);
    location.href = next.toString();
});
function bindQuerySelect(id:string,param:string,levels:number[],current:number){
    const select=document.getElementById(id) as HTMLSelectElement|null;
    if(select)select.value=String(current);
    select?.addEventListener("change",()=>{
        if(!levels.includes(Number(select.value)))return;
        const next=new URL(location.href);
        next.searchParams.set(param,select.value);
        location.href=next.toString();
    });
}
bindQuerySelect("render-quality","quality",qualityLevels,renderQuality);
bindQuerySelect("probe-resolution","probeSize",probeSizeLevels,PROBE_SIZE);
bindQuerySelect("probe-spacing","probeSpacing",probeSpacingLevels,PROBE_SPACING);
function progress(p: number) {
    bar.style.width = `${p * 100}%`;
}
const yieldFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

if (!navigator.gpu) {
    setRendererStatus("WebGPU unavailable in this browser.");
    throw new Error("WebGPU not supported");
}
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
    setRendererStatus("No WebGPU adapter found.");
    throw new Error("No WebGPU adapter");
}
setRendererStatus(`WebGPU ${adapter.info?.description || adapter.info?.vendor || "available"} · probe ${PROBE_SIZE}px / ${PROBE_SPACING}m · render ${renderQuality}×`);

const canvas = document.querySelector("canvas")!;
const dpr = window.devicePixelRatio || 1;
const aspect = canvas.clientWidth / canvas.clientHeight;
let renderW = Math.ceil(viewportH * aspect);
const renderH = viewportH;
canvas.width = Math.floor(canvas.clientWidth * dpr);
canvas.height = Math.floor(canvas.clientHeight * dpr);

const device = await adapter.requestDevice();
const context = canvas.getContext("webgpu")!;
const format = navigator.gpu.getPreferredCanvasFormat();
canvas.style.imageRendering = "pixelated";
context.configure({ device, format, alphaMode: "premultiplied" });

progress(0.05);
await yieldFrame();

// Shell grass constants
const LAYERS = 8;
const SUBDIVISIONS = 16;
const AREA = 200;
const HEIGHT = 0.1;
const COLOR = 0x5a8a32;
const DENSITY = 80;
const ROOT_L = 0.85;
const TIP_L = 1.05;
const HUE_FREQ = 10.0;
const HUE_VAR = 0.02;

// Shell mesh: ground plane (y=0) + LAYERS shell layers
const vertsPerSide = SUBDIVISIONS + 1;
const totalLayers = LAYERS + 1;
const vertexCount = totalLayers * vertsPerSide * vertsPerSide;
const indexCount = totalLayers * SUBDIVISIONS * SUBDIVISIONS * 6;
const vertices = new Float32Array(vertexCount * 3);
const indices = new Uint16Array(indexCount);

let vi = 0;
let ii = 0;
for (let layer = 0; layer < totalLayers; layer++) {
    const y = layer / LAYERS;
    const baseVertex = layer * vertsPerSide * vertsPerSide;
    for (let gz = 0; gz < vertsPerSide; gz++) {
        for (let gx = 0; gx < vertsPerSide; gx++) {
            vertices[vi++] = gx / SUBDIVISIONS - 0.5;
            vertices[vi++] = y;
            vertices[vi++] = gz / SUBDIVISIONS - 0.5;
        }
    }
    for (let gz = 0; gz < SUBDIVISIONS; gz++) {
        for (let gx = 0; gx < SUBDIVISIONS; gx++) {
            const bl = baseVertex + gz * vertsPerSide + gx;
            const br = bl + 1;
            const tl = bl + vertsPerSide;
            const tr = tl + 1;
            indices[ii++] = bl;
            indices[ii++] = tl;
            indices[ii++] = br;
            indices[ii++] = br;
            indices[ii++] = tl;
            indices[ii++] = tr;
        }
    }
}

const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, 0, vertices);

const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(indexBuffer, 0, indices);

// Imported static geometry is packed into one world-space stream. The baseline stones use
// alpha=0 so the original procedural stone palette remains unchanged; GLB vertex colors carry alpha=1.
const baselineStones = createStones();
let sceneAsset: SceneAsset | null = null;
let sceneLabel = "Original Texel Splatting baseline";
let stoneVertices: Float32Array;
let stoneIndices: Uint32Array;
function baselineGeometry() {
    const vertices=new Float32Array((baselineStones.vertices.length/6)*12);
    for(let i=0;i<baselineStones.vertices.length/6;i++){
        vertices.set(baselineStones.vertices.subarray(i*6,i*6+6),i*12);
        vertices.set([1,1,1,0,2,0],i*12+6);
    }
    return {vertices,indices:Uint32Array.from(baselineStones.indices)};
}
function packAsset(asset: SceneAsset) {
    const vertexCount=asset.meshes.reduce((n,m)=>n+m.vertices.length/10,0);
    const indexCount=asset.meshes.reduce((n,m)=>n+m.indices.length,0);
    const vertices=new Float32Array(vertexCount*12), indices=new Uint32Array(indexCount);
    let vo=0,io=0;
    for(const [meshIndex,mesh] of asset.meshes.entries()){
        for(let i=0;i<mesh.vertices.length/10;i++){
            const src=i*10,dst=(vo+i)*12;
            vertices.set(mesh.vertices.subarray(src,src+10),dst);
            if(mesh.doubleSided)vertices[dst+9]=2;
            vertices[dst+10]=10+meshIndex;
            vertices[dst+11]=mesh.materialIndex+1;
        }
        for(let i=0;i<mesh.indices.length;i++)indices[io+i]=mesh.indices[i]+vo;
        vo+=mesh.vertices.length/10;io+=mesh.indices.length;
    }
    return {vertices,indices};
}
if(baselineScene){
    ({vertices:stoneVertices,indices:stoneIndices}=baselineGeometry());
}else{
    const requestedProduction=query.get("scene")!=="mock";
    const source=requestedProduction?sceneUrl():"./mock-tea-stall.glb";
    try{
        sceneAsset=await loadGlb(source);
        ({vertices:stoneVertices,indices:stoneIndices}=packAsset(sceneAsset));
        sceneLabel=requestedProduction?source:"Synthetic mock tea-stall fixture (not production geometry)";
    }catch(error){
        if(requestedProduction){
            try{
                sceneAsset=await loadGlb("./mock-tea-stall.glb");
                ({vertices:stoneVertices,indices:stoneIndices}=packAsset(sceneAsset));
                sceneLabel=`Production unavailable; synthetic mock fallback (${String(error)})`;
                setRendererStatus("Production asset could not load; running clearly labeled synthetic mock fallback.");
            }catch(mockError){
                ({vertices:stoneVertices,indices:stoneIndices}=baselineGeometry());
                sceneLabel=`Production and mock unavailable; original baseline fallback (${String(mockError)})`;
                setRendererStatus("Production and mock scene unavailable; using original baseline.");
            }
        }else{
            ({vertices:stoneVertices,indices:stoneIndices}=baselineGeometry());
            sceneLabel=`Mock unavailable; original baseline fallback (${String(error)})`;
            setRendererStatus("Mock fixture could not load; using original baseline.");
        }
    }
}
if (sceneState) sceneState.textContent = sceneLabel;
const stoneVertexBuffer = device.createBuffer({size:stoneVertices.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(stoneVertexBuffer,0,stoneVertices);
const stoneIndexBuffer = device.createBuffer({size:stoneIndices.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(stoneIndexBuffer,0,stoneIndices);
const stoneIndexCount = stoneIndices.length;

// Sphere geometry (orb + wisps)
const sphere = createSphere(8);
const orbVertexBuffer = device.createBuffer({
    size: sphere.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(orbVertexBuffer, 0, sphere.vertices);
const orbIndexBuffer = device.createBuffer({
    size: sphere.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(orbIndexBuffer, 0, sphere.indices);
const orbIndexCount = sphere.indices.length;

const orbBuffers = Array.from({ length: 4 }, () =>
    device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
);

// GPU LBVH from stone geometry
const { triBuffer, triAABBBuffer, count: triCount } = uploadTriangles(device, stoneVertices, stoneIndices, 12);
const lbvh = await createLBVH(device, triAABBBuffer, triCount);
const initEncoder = device.createCommandEncoder();
dispatchLBVH(lbvh, initEncoder, device);
device.queue.submit([initEncoder.finish()]);
await device.queue.onSubmittedWorkDone();
const nodeBuffer = lbvh.treeNodes;
const triIdBuffer = lbvh.sortedIds;

// Uniforms: viewProj(64) + sunDir(12)+shadowFade(4) + sunColor(12)+pad(4) + ambient(12)+pad(4) + cameraPos(12)+pad(4) = 128
const uniformBuffer = device.createBuffer({
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// Point lights: 64 * (position(12)+pad(4) + color(12)+radius(4)) = 64 * 32 = 2048
const lightBuffer = device.createBuffer({
    size: 64 * 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const flickerQueue = new Float32Array(16);
for (let i = 0; i < 16; i++) flickerQueue[i] = 0.8 + Math.random() * 0.25;
let flickerIdx = 0;
let elapsed = 0;

const baseR = ((COLOR >> 16) & 0xff) / 255;
const baseG = ((COLOR >> 8) & 0xff) / 255;
const baseB = (COLOR & 0xff) / 255;

const sceneBindGroupLayout = device.createBindGroupLayout({
    entries: [
        {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
});

const sky = createSky(device, "rgba8unorm");

const sceneBindGroup = device.createBindGroup({
    layout: sceneBindGroupLayout,
    entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: nodeBuffer } },
        { binding: 2, resource: { buffer: triBuffer } },
        { binding: 3, resource: { buffer: triIdBuffer } },
        { binding: 4, resource: { buffer: lightBuffer } },
        { binding: 5, resource: { buffer: sky.skyBuffer } },
    ],
});

progress(0.2);
await yieldFrame();

const stoneAABB = computeVertexAABB(stoneVertices, 12);
const grassAABB = { min: [-AREA / 2, 0, -AREA / 2] as [number, number, number], max: [AREA / 2, HEIGHT, AREA / 2] as [number, number, number] };
const orbsAABB = { min: [-3.5, 1.2, -3.5] as [number, number, number], max: [3.5, 2.8, 3.5] as [number, number, number] };

const sceneConfig = {
    device,
    vertexBuffer,
    indexBuffer,
    indexCount: baselineScene ? indexCount : 0,
    stoneVertexBuffer,
    stoneIndexBuffer,
    stoneIndexCount,
    orbVertexBuffer,
    orbIndexBuffer,
    orbIndexCount,
    orbBuffers,
    meshAABBs: { grass: grassAABB, stones: stoneAABB, orbs: orbsAABB },
    area: AREA,
    height: HEIGHT,
    baseR,
    baseG,
    baseB,
    density: DENSITY,
    rootL: ROOT_L,
    tipL: TIP_L,
    hueFreq: HUE_FREQ,
    hueVar: HUE_VAR,
    probeSize: PROBE_SIZE,
    probeSpacing: PROBE_SPACING,
};

const bvhConfig = {
    nodeBuffer,
    triBuffer,
    triIdBuffer,
    lightBuffer,
    skyBuffer: sky.skyBuffer,
    sceneBuffer: sky.sceneBuffer,
};

const cubemap = createCubemap({ ...sceneConfig, ...bvhConfig });

const splat = createSplat({ ...sceneConfig, ...bvhConfig });

const godrays = createGodRays(device);
const post = createPostProcess(device, format);

progress(0.8);
await yieldFrame();

function projectSunToScreen(
    vp: Float32Array,
    dirX: number,
    dirY: number,
    dirZ: number,
): { u: number; v: number; visibility: number } {
    const sx = -dirX * 1000;
    const sy = -dirY * 1000;
    const sz = -dirZ * 1000;
    const cx = vp[0] * sx + vp[4] * sy + vp[8] * sz + vp[12];
    const cy = vp[1] * sx + vp[5] * sy + vp[9] * sz + vp[13];
    const cw = vp[3] * sx + vp[7] * sy + vp[11] * sz + vp[15];
    if (cw <= 0) return { u: 0, v: 0, visibility: 0 };
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    const edge = Math.max(Math.abs(ndcX), Math.abs(ndcY));
    const t = Math.max(0, Math.min(1, (edge - 0.6) / 0.6));
    return {
        u: ndcX * 0.5 + 0.5,
        v: 1 - (ndcY * 0.5 + 0.5),
        visibility: Math.max(0, 1 - t * t * (3 - 2 * t)),
    };
}

let depthTexture = device.createTexture({
    size: [renderW, renderH],
    format: "depth32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

let colorTexture = device.createTexture({
    size: [renderW, renderH],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

let posterizeTexture = device.createTexture({
    size: [renderW, renderH],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

let colorView = colorTexture.createView();
let posterizeView = posterizeTexture.createView();
let depthView = depthTexture.createView();

const direct = createDirect({
    ...sceneConfig,
    sceneBindGroupLayout,
    sceneBindGroup,
    skyBuffer: sky.skyBuffer,
});

direct.resize(renderW, renderH, colorView, posterizeView);
post.resize(renderW, renderH);

let proj = perspective(FOV, renderW / renderH, 0.1, 200);

const resizeObserver = new ResizeObserver(() => {
    const newDpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * newDpr);
    canvas.height = Math.floor(canvas.clientHeight * newDpr);

    const newAspect = canvas.clientWidth / canvas.clientHeight;
    const w = Math.ceil(viewportH * newAspect);
    if (renderW === w) return;
    renderW = w;
    depthTexture.destroy();
    depthTexture = device.createTexture({
        size: [w, viewportH],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    colorTexture.destroy();
    colorTexture = device.createTexture({
        size: [w, viewportH],
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    posterizeTexture.destroy();
    posterizeTexture = device.createTexture({
        size: [w, viewportH],
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    colorView = colorTexture.createView();
    posterizeView = posterizeTexture.createView();
    depthView = depthTexture.createView();
    direct.resize(w, viewportH, colorView, posterizeView);
    godrays.resize(w, viewportH);
    post.resize(w, viewportH);
    proj = perspective(FOV, w / viewportH, 0.1, 200);
});
resizeObserver.observe(canvas);

let yaw = 0.927;
let pitch = baselineScene ? 0 : -0.243;
let px = baselineScene ? 20 : 3.0,
    py = baselineScene ? 1.6 : 1.35,
    pz = baselineScene ? 15 : 2.4;
let cameraMode: "orbit" | "free" = baselineScene ? "free" : "orbit";
let orbitTarget: [number,number,number] = [0,0.4,0];
let orbitRadius = Math.hypot(px-orbitTarget[0],pz-orbitTarget[2]);
let trajectoryPlaying = false;
let trajectorySeconds = 0;
const trajectoryDuration = 40;
const trajectoryStatus = document.getElementById("trajectory-status");
const trajectoryPlay = document.getElementById("trajectory-play");
const trajectoryPause = document.getElementById("trajectory-pause");
const trajectoryReset = document.getElementById("trajectory-reset");
const cameraReset = document.getElementById("camera-reset");
const cameraPreset = document.getElementById("camera-preset") as HTMLSelectElement | null;
const cameraModeSelect = document.getElementById("camera-mode") as HTMLSelectElement | null;
if(cameraModeSelect) cameraModeSelect.value=cameraMode;
function setCameraPreset(name: string) {
    trajectoryPlaying = false;
    const presets: Record<string,{position:[number,number,number];target:[number,number,number]}> = {
        orbit:{position:[2.65,1.45,2.15],target:[0,0.4,0]},
        chair:{position:[-0.25,0.78,1.10],target:[-0.72,0.20,0.02]},
        hat:{position:[-0.45,0.62,1.05],target:[-1.12,0.12,0.38]},
        pipe:{position:[-1.72,0.28,-0.35],target:[-1.12,0.04,-0.35]},
    };
    const preset=presets[name]??presets.orbit;
    [px,py,pz]=preset.position;orbitTarget=preset.target;
    const dx=orbitTarget[0]-px,dy=orbitTarget[1]-py,dz=orbitTarget[2]-pz;
    const horizontal=Math.hypot(dx,dz);
    yaw=Math.atan2(-dx,-dz);pitch=Math.atan2(dy,horizontal);
    orbitRadius=horizontal;
}
cameraReset?.addEventListener("click",()=>setCameraPreset("orbit"));
cameraPreset?.addEventListener("change",()=>setCameraPreset(cameraPreset.value));
trajectoryPlay?.addEventListener("click",()=>{cameraMode="orbit";if(cameraModeSelect)cameraModeSelect.value="orbit";trajectoryPlaying=true;syncTrajectoryStatus();});
trajectoryPause?.addEventListener("click",()=>{trajectoryPlaying=false;syncTrajectoryStatus();});
trajectoryReset?.addEventListener("click",()=>{trajectorySeconds=0;trajectoryPlaying=false;setCameraPreset("orbit");syncTrajectoryStatus();});
function applyTrajectory(t:number){
    // Fixed 40-second inspection path: stool orbit, lateral sweep, hat close-up,
    // thin pipe/bowl detail, and a cross-section of a 1 m probe-cell boundary.
    const q=((t%trajectoryDuration)+trajectoryDuration)%trajectoryDuration;
    let x:number,y:number,z:number,tx:number,ty:number,tz:number;
    if(q<8){const a=-Math.PI+q/8*Math.PI*2;x=-.72+Math.cos(a)*1.05;y=.82;z=.02+Math.sin(a)*1.05;[tx,ty,tz]=[-.72,.20,.02];}
    else if(q<14){const u=(q-8)/6;x=-1.6+u*3.2;y=.85;z=1.45;[tx,ty,tz]=[-.72,.20,.02];}
    else if(q<20){const u=(q-14)/6;x=-.45+u*.08;y=.62;z=1.05;[tx,ty,tz]=[-1.12,.12,.38];}
    else if(q<28){const u=(q-20)/8,a=Math.PI+u*Math.PI*2;x=-1.12+Math.cos(a)*.55;y=.30;z=-.35+Math.sin(a)*.55;[tx,ty,tz]=[-1.12,.04,-.35];}
    else if(q<36){const u=(q-28)/8;x=-1.7+u*3.4;y=1.15;z=2.15;[tx,ty,tz]=[0,.55,0];}
    else {const u=(q-36)/4;x=3-u*2;y=1.35;z=2.4;[tx,ty,tz]=[0,.4,0];}
    px=x;py=y;pz=z;orbitTarget=[tx,ty,tz];
    const dx=tx-x,dy=ty-y,dz=tz-z,h=Math.hypot(dx,dz);
    yaw=Math.atan2(-dx,-dz);pitch=Math.atan2(dy,h);orbitRadius=Math.max(.1,h);
}
function syncTrajectoryStatus(){if(trajectoryStatus){const s=Math.floor(trajectorySeconds),m=Math.floor(s/60),r=s%60;trajectoryStatus.textContent=`${trajectoryPlaying?"Tour playing":"Tour paused"} · ${m}:${String(r).padStart(2,"0")} / 0:40`;}}
cameraModeSelect?.addEventListener("change",()=>{
    cameraMode=cameraModeSelect.value==="free"?"free":"orbit";
    if(cameraMode==="orbit"){
        orbitTarget=[0,0.4,0];orbitRadius=Math.max(0.5,Math.hypot(px-orbitTarget[0],pz-orbitTarget[2]));
        pitch=Math.atan2(orbitTarget[1]-py,orbitRadius);
    }
});
canvas.addEventListener("wheel",e=>{
    if(cameraMode!=="orbit")return;
    orbitRadius=Math.max(0.45,Math.min(20,orbitRadius+Math.sign(e.deltaY)*0.25));
},{passive:true});

let hour = 16.5;
const timeSpeed = 0.05;
let dragging = false;

const slider = document.getElementById("time-slider") as HTMLInputElement;
const clock = document.getElementById("time-clock")!;

function syncSlider() {
    const h = Math.floor(hour) % 24;
    const m = Math.floor((hour % 1) * 60);
    clock.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    slider.value = String(Math.round(hour * 10));
}

slider.addEventListener("input", () => {
    hour = parseFloat(slider.value) / 10;
});
slider.addEventListener("mousedown", () => (dragging = true));
slider.addEventListener("mouseup", () => (dragging = false));
slider.addEventListener("touchstart", () => (dragging = true));
slider.addEventListener("touchend", () => (dragging = false));

const isTouchDevice = matchMedia("(pointer: coarse)").matches;

const keys: Record<string, boolean> = {};
if (!isTouchDevice) {
    canvas.addEventListener("click", () => canvas.requestPointerLock());
}
document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    const scale = 1.5 / canvas.clientHeight;
    const halfPi = Math.PI / 2 - 0.01;
    yaw -= e.movementX * scale;
    pitch = Math.max(-halfPi, Math.min(halfPi, pitch - e.movementY * scale));
});
const ui = document.querySelectorAll<HTMLElement>(".hud, .fps, .time-panel, .controls-hint");
document.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.key === "f" || e.key === "F") {
        const hidden = ui[0].style.display === "none";
        ui.forEach((el) => (el.style.display = hidden ? "" : "none"));
    }
});
document.addEventListener("keyup", (e) => {
    keys[e.code] = false;
});

type RenderMode = "none" | "cubemap" | "splat";
let mode: RenderMode = "splat";
let selectedMode: RenderMode = mode;
let compareActive = false;
const modeGroup = document.getElementById("mode-group")!;
modeGroup.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".mode-btn") as HTMLElement | null;
    if (!btn) return;
    mode = btn.dataset.mode as typeof mode;
    selectedMode = mode;
    compareActive = false;
    compareButton?.setAttribute("aria-pressed", "false");
    if(compareButton)compareButton.textContent=`Compare: ${modeName(mode)} / Direct`;
    modeGroup.querySelector(".active")?.classList.remove("active");
    modeGroup.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((button) => {
        const active = button === btn;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
});
const compareButton = document.getElementById("compare-toggle") as HTMLButtonElement | null;
compareButton?.addEventListener("click", () => {
    compareActive = !compareActive;
    mode = compareActive ? (selectedMode === "none" ? "splat" : "none") : selectedMode;
    compareButton.setAttribute("aria-pressed", String(compareActive));
    compareButton.textContent = `Compare: ${modeName(mode)} / ${modeName(mode === "none" ? "splat" : "none")}`;
    modeGroup.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach(button => {
        const active = button.dataset.mode === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
});
function modeName(value: RenderMode) { return value === "none" ? "Direct" : value === "cubemap" ? "Cubemap" : "Splat"; }
const benchmarkButton = document.getElementById("benchmark-run") as HTMLButtonElement | null;
benchmarkButton?.addEventListener("click",async()=>{
    if(benchmarkButton.disabled)return;
    benchmarkButton.disabled=true;const oldMode=mode,oldSelected=selectedMode,oldCompare=compareActive,oldPlaying=trajectoryPlaying,oldT=trajectorySeconds;
    const pose={px,py,pz,yaw,pitch,orbitRadius,target:[...orbitTarget] as [number,number,number]};
    const results:Record<string,{samples:number;p50FrameIntervalMs:number;p95FrameIntervalMs:number}>={};
    try{
        trajectoryPlaying=false;trajectorySeconds=10;applyTrajectory(trajectorySeconds);
        for(const m of ["none","cubemap","splat"] as const){
            mode=m;selectedMode=m;compareActive=false;
            const frames:number[]=[];let previous=0;const waitUntil=(duration:number,collect:boolean)=>new Promise<void>(resolve=>{const start=performance.now();const tick=(now:number)=>{if(previous&&collect)frames.push(now-previous);previous=now;if(now-start>=duration)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
            await waitUntil(1200,false);previous=0;await waitUntil(4000,true);
            const sorted=[...frames].sort((a,b)=>a-b),pct=(p:number)=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]??0;
            results[modeName(m)]={samples:sorted.length,p50FrameIntervalMs:pct(.5),p95FrameIntervalMs:pct(.95)};
        }
        const assetUrl=sceneUrl();let sceneHash="unavailable";try{const bytes=await(await fetch(assetUrl)).arrayBuffer();const digest=await crypto.subtle.digest("SHA-256",bytes);sceneHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");}catch{}
        const evidence={kind:"bounded-rAF-frame-interval-benchmark",scene:sceneLabel,sceneUrl:assetUrl,sceneSha256:sceneHash,viewport:{width:canvas.width,height:canvas.height,dpr:window.devicePixelRatio||1,renderWidth:renderW,renderHeight:renderH},probeResolution:PROBE_SIZE,probeSpacingMeters:PROBE_SPACING,renderQuality,trajectory:{name:"fixed 10-second lateral-sweep keyframe",seconds:10},warmupMsPerMode:1200,samplingMsPerMode:4000,adapter:{vendor:adapter.info?.vendor??"unavailable",architecture:adapter.info?.architecture??"unavailable",device:adapter.info?.device??"unavailable"},gpuTimestampQueriesUsed:false,method:"requestAnimationFrame callback intervals; CPU/display scheduling metric, not GPU execution timing",modes:results,recordedAt:new Date().toISOString()};
        const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="tea-stall-frame-interval-benchmark.json";a.click();URL.revokeObjectURL(url);
        setRendererStatus("Measurement saved · rAF intervals, not GPU timings");
    }catch(error){setRendererStatus(`Measurement failed: ${String(error)}`);}
    mode=oldMode;selectedMode=oldSelected;compareActive=oldCompare;trajectoryPlaying=oldPlaying;trajectorySeconds=oldT;px=pose.px;py=pose.py;pz=pose.pz;yaw=pose.yaw;pitch=pose.pitch;orbitRadius=pose.orbitRadius;orbitTarget=pose.target;
    modeGroup.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach(button=>{const active=button.dataset.mode===mode;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));});
    if(compareButton)compareButton.setAttribute("aria-pressed",String(compareActive));benchmarkButton.disabled=false;
});

const controlsHint = document.getElementById("controls-hint")!;
let hintDismissed = false;
function dismissHint() {
    if (hintDismissed) return;
    hintDismissed = true;
    controlsHint.classList.add("hidden");
}

const hud = document.querySelector<HTMLElement>(".hud");
const hudCollapse = document.getElementById("hud-collapse");
hudCollapse?.addEventListener("click", () => {
    if (!hud || !hudCollapse) return;
    const collapsed = hud.classList.toggle("collapsed");
    hudCollapse.textContent = collapsed ? "Show controls" : "−";
    hudCollapse.setAttribute("aria-expanded", String(!collapsed));
    hudCollapse.setAttribute("aria-label", collapsed ? "Expand controls" : "Collapse controls");
});
if (isTouchDevice) {
    dismissHint();
    const uiToggle = document.getElementById("ui-toggle");
    if (uiToggle) {
        let uiHidden = false;
        uiToggle.addEventListener("click", () => {
            uiHidden = !uiHidden;
            ui.forEach((el) => (el.style.display = uiHidden ? "none" : ""));
        });
    }
} else {
    document.addEventListener("keydown", (e) => {
        if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) dismissHint();
    }, { once: true });
    document.addEventListener("mousemove", (e) => {
        if (document.pointerLockElement === canvas) dismissHint();
    }, { once: true });
    setTimeout(dismissHint, 10000);
}

// Touch controls
let touchMX = 0;
let touchMZ = 0;
let joystickId: number | null = null;
let lookId: number | null = null;
let joystickOriginX = 0;
let joystickOriginY = 0;
let lookLastX = 0;
let lookLastY = 0;

let joystickBase: HTMLElement | null = null;
let joystickThumb: HTMLElement | null = null;

if (isTouchDevice) {
    const style = document.createElement("style");
    style.textContent = `
        .joystick-base {
            position: fixed;
            width: 120px;
            height: 120px;
            border-radius: 50%;
            border: 2px solid var(--border);
            background: var(--panel);
            pointer-events: none;
            z-index: 20;
            display: none;
            transform: translate(-50%, -50%);
        }
        .joystick-thumb {
            position: absolute;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--accent);
            opacity: 0.6;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);

    joystickBase = document.createElement("div");
    joystickBase.className = "joystick-base";
    joystickThumb = document.createElement("div");
    joystickThumb.className = "joystick-thumb";
    joystickBase.appendChild(joystickThumb);
    document.body.appendChild(joystickBase);

    function isUIElement(target: EventTarget | null): boolean {
        if (!target || !(target instanceof HTMLElement)) return false;
        return !!target.closest(".time-panel, .hud, .fps");
    }

    canvas.addEventListener("touchstart", (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (isUIElement(t.target)) continue;
            const midX = window.innerWidth / 2;
            if (t.clientX < midX && joystickId === null) {
                joystickId = t.identifier;
                joystickOriginX = t.clientX;
                joystickOriginY = t.clientY;
                joystickBase!.style.left = t.clientX + "px";
                joystickBase!.style.top = t.clientY + "px";
                joystickBase!.style.display = "block";
                joystickThumb!.style.transform = "translate(-50%, -50%)";
            } else if (lookId === null) {
                lookId = t.identifier;
                lookLastX = t.clientX;
                lookLastY = t.clientY;
            }
        }
    }, { passive: false });

    canvas.addEventListener("touchmove", (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === joystickId) {
                let dx = t.clientX - joystickOriginX;
                let dy = t.clientY - joystickOriginY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxR = 60;
                if (dist > maxR) {
                    dx = (dx / dist) * maxR;
                    dy = (dy / dist) * maxR;
                }
                touchMX = dx / maxR;
                touchMZ = dy / maxR;
                joystickThumb!.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            } else if (t.identifier === lookId) {
                const scale = 1.5 / canvas.clientHeight;
                const halfPi = Math.PI / 2 - 0.01;
                yaw -= (t.clientX - lookLastX) * scale;
                pitch = Math.max(-halfPi, Math.min(halfPi, pitch - (t.clientY - lookLastY) * scale));
                lookLastX = t.clientX;
                lookLastY = t.clientY;
            }
        }
    }, { passive: false });

    function handleTouchEnd(e: TouchEvent) {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === joystickId) {
                joystickId = null;
                touchMX = 0;
                touchMZ = 0;
                joystickBase!.style.display = "none";
            } else if (t.identifier === lookId) {
                lookId = null;
            }
        }
    }
    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("touchcancel", handleTouchEnd);
}


const fpsDisplay = document.getElementById("fps")!;
let fpsFrames = 0;
let fpsTime = performance.now();

let lastTime = performance.now();
let loaded = false;
let disposed = false;
const tmp4 = new Float32Array(4);
const tmp8 = new Float32Array(8);
const tmp16 = new Float32Array(16);

function frame() {
    if(disposed)return;
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    fpsFrames++;
    if (now - fpsTime >= 500) {
        fpsDisplay.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsTime))} fps`;
        fpsFrames = 0;
        fpsTime = now;
    }

    const sprinting = keys["ShiftLeft"] || keys["ShiftRight"];
    const speed = 2.5 * (sprinting ? 3 : 1);

    let mx = 0,
        mz = 0;
    if (keys["KeyW"]) mz -= 1;
    if (keys["KeyS"]) mz += 1;
    if (keys["KeyA"]) mx -= 1;
    if (keys["KeyD"]) mx += 1;
    mx += touchMX;
    mz += touchMZ;

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) {
        const move = (speed * dt) / len;
        const cy = Math.cos(yaw),
            sy = Math.sin(yaw);
        const dx=(mz * sy + mx * cy) * move;
        const dz=(mz * cy - mx * sy) * move;
        if(cameraMode==="orbit") { orbitTarget[0]+=dx;orbitTarget[2]+=dz; }
        else { px+=dx;pz+=dz; }
    }

    if (!dragging) {
        hour += dt * timeSpeed;
        if (hour >= 24) hour -= 24;
    }
    syncSlider();
    const elevation = 55 * Math.sin(((hour - 6) / 12) * Math.PI);
    const azimuth = (hour / 24) * 360 - 25;
    const output = sampleGradient(elevation);
    const [ldx, ldy, ldz] = lightDirection(azimuth, elevation);
    const sf = shadowFade(elevation);

    if(cameraMode==="orbit"){
        px=orbitTarget[0]+Math.sin(yaw)*orbitRadius;
        pz=orbitTarget[2]+Math.cos(yaw)*orbitRadius;
        py=orbitTarget[1]-orbitRadius*Math.tan(pitch);
    }
    if(trajectoryPlaying){trajectorySeconds=(trajectorySeconds+dt)%trajectoryDuration;applyTrajectory(trajectorySeconds);syncTrajectoryStatus();}
    const lx = -Math.sin(yaw) * Math.cos(pitch);
    const ly = Math.sin(pitch);
    const lz = -Math.cos(yaw) * Math.cos(pitch);
    const view = lookAt(px, py, pz, px + lx, py + ly, pz + lz, 0, 1, 0);
    const viewProj = multiply(proj, view);
    elapsed += dt;
    const patrolAngle = elapsed * 0.4;
    const bobY =
        2 +
        Math.sin(elapsed * 1.5) * 0.25 +
        Math.sin(elapsed * 2.3 + 1.7) * 0.1 +
        Math.sin(elapsed * 3.7 + 4.1) * 0.05;
    const lightX =
        Math.cos(patrolAngle) * 3 +
        Math.sin(elapsed * 0.7 + 0.3) * 0.12 +
        Math.sin(elapsed * 1.9 + 2.5) * 0.06;
    const lightZ =
        Math.sin(patrolAngle) * 3 +
        Math.sin(elapsed * 0.9 + 1.1) * 0.12 +
        Math.sin(elapsed * 2.1 + 3.8) * 0.06;

    flickerQueue[flickerIdx] = 0.8 + Math.random() * 0.25;
    flickerIdx = (flickerIdx + 1) & 15;
    let flickerSum = 0;
    for (let i = 0; i < 16; i++) flickerSum += flickerQueue[i];
    const flicker = flickerSum / 16;
    const heightDim = 0.85 + 0.15 * Math.max(0, Math.min(1, (bobY - 1.5) / 1.0));
    const intensity = 3 * flicker * heightDim;
    const flickerNorm = (flicker - 0.8) / 0.25;
    const lr = 0.3 + (flickerNorm > 0 ? flickerNorm * 0.2 : flickerNorm * 0.15);
    const lg = 0.75 + (flickerNorm > 0 ? flickerNorm * 0.15 : flickerNorm * 0.25);
    const lb = 0.82 + (flickerNorm > 0 ? flickerNorm * 0.13 : flickerNorm * 0.22);
    tmp4[0] = lightX; tmp4[1] = bobY; tmp4[2] = lightZ; tmp4[3] = 0;
    device.queue.writeBuffer(lightBuffer, 0, tmp4);
    tmp4[0] = lr * intensity; tmp4[1] = lg * intensity; tmp4[2] = lb * intensity; tmp4[3] = 15;
    device.queue.writeBuffer(lightBuffer, 16, tmp4);

    tmp8[0] = lightX; tmp8[1] = bobY; tmp8[2] = lightZ; tmp8[3] = 0.2;
    tmp8[4] = 0.75; tmp8[5] = 1.0; tmp8[6] = 1.0; tmp8[7] = 0;
    device.queue.writeBuffer(orbBuffers[0], 0, tmp8);
    const w1a = elapsed * 1.5;
    const w1b = Math.sin(elapsed * 2) * 0.1;
    tmp8[0] = lightX + Math.cos(w1a) * 0.3; tmp8[1] = bobY + w1b;
    tmp8[2] = lightZ + Math.sin(w1a) * 0.3; tmp8[3] = 0.12;
    tmp8[4] = 0.5; tmp8[5] = 0.9; tmp8[6] = 0.95; tmp8[7] = 0;
    device.queue.writeBuffer(orbBuffers[1], 0, tmp8);
    const w2a = elapsed * -1.1 + 2.1;
    const w2b = Math.sin(elapsed * 2 + 2.1) * 0.08;
    tmp8[0] = lightX + Math.cos(w2a) * 0.4; tmp8[1] = bobY + w2b;
    tmp8[2] = lightZ + Math.sin(w2a) * 0.4; tmp8[3] = 0.1;
    device.queue.writeBuffer(orbBuffers[2], 0, tmp8);
    const w3a = elapsed * 2.0 + 4.2;
    const w3b = Math.sin(elapsed * 2 + 4.2) * 0.06;
    tmp8[0] = lightX + Math.cos(w3a) * 0.22; tmp8[1] = bobY + w3b;
    tmp8[2] = lightZ + Math.sin(w3a) * 0.22; tmp8[3] = 0.08;
    device.queue.writeBuffer(orbBuffers[3], 0, tmp8);

    device.queue.writeBuffer(uniformBuffer, 0, viewProj);
    tmp4[0] = -ldx; tmp4[1] = -ldy; tmp4[2] = -ldz; tmp4[3] = sf;
    device.queue.writeBuffer(uniformBuffer, 64, tmp4);
    const sc = output.sunColor;
    const si = output.sunIntensity;
    tmp4[0] = sc.r * si; tmp4[1] = sc.g * si; tmp4[2] = sc.b * si; tmp4[3] = 0;
    device.queue.writeBuffer(uniformBuffer, 80, tmp4);
    const ac = output.ambientColor;
    const ai = output.ambientIntensity;
    tmp4[0] = ac.r * ai; tmp4[1] = ac.g * ai; tmp4[2] = ac.b * ai; tmp4[3] = 0;
    device.queue.writeBuffer(uniformBuffer, 96, tmp4);
    tmp4[0] = px; tmp4[1] = py; tmp4[2] = pz; tmp4[3] = 0;
    device.queue.writeBuffer(uniformBuffer, 112, tmp4);

    uploadSky(device, sky.skyBuffer, output, azimuth, elevation);
    const cy = Math.cos(yaw),
        sy = Math.sin(yaw);
    const cp = Math.cos(pitch),
        sp = Math.sin(pitch);
    tmp16[0] = cy; tmp16[1] = 0; tmp16[2] = -sy; tmp16[3] = 0;
    tmp16[4] = sp * sy; tmp16[5] = cp; tmp16[6] = sp * cy; tmp16[7] = 0;
    tmp16[8] = sy * cp; tmp16[9] = -sp; tmp16[10] = cy * cp; tmp16[11] = 0;
    tmp16[12] = px; tmp16[13] = py; tmp16[14] = pz; tmp16[15] = 1;
    uploadSkyScene(
        device,
        sky.sceneBuffer,
        tmp16,
        [ldx, ldy, ldz],
        [sc.r * si, sc.g * si, sc.b * si],
        output.zenith,
        renderW,
        renderH,
        FOV,
    );

    const encoder = device.createCommandEncoder();

    let postInput: GPUTextureView;

    const sun = projectSunToScreen(viewProj, ldx, ldy, ldz);

    if (mode === "splat") {
        splat.encode(
            encoder,
            {
                cameraPos: [px, py, pz],
                cameraFwd: [lx, ly, lz],
                sunDir: [-ldx, -ldy, -ldz],
                sunColor: [sc.r * si, sc.g * si, sc.b * si],
                ambient: [ac.r * ai, ac.g * ai, ac.b * ai],
                shadowFade: sf,
                pointLightCount: 1,
                time: performance.now() / 1000,
            },
            colorView,
            depthView,
            viewProj,
        );
        godrays.encode(encoder, colorView, depthView, posterizeView, sun);
        postInput = posterizeView;
    } else if (mode === "cubemap") {
        cubemap.encode(
            encoder,
            {
                cameraPos: [px, py, pz],
                cameraFwd: [lx, ly, lz],
                sunDir: [-ldx, -ldy, -ldz],
                sunColor: [sc.r * si, sc.g * si, sc.b * si],
                ambient: [ac.r * ai, ac.g * ai, ac.b * ai],
                shadowFade: sf,
            },
            colorView,
            depthView,
        );
        godrays.encode(encoder, colorView, depthView, posterizeView, sun);
        postInput = posterizeView;
    } else {
        direct.encode(
            encoder,
            (e, c, d) => sky.encode(e, c, d),
            colorView,
            depthView,
            posterizeView,
        );
        godrays.encode(encoder, colorView, depthView, posterizeView, sun);
        postInput = posterizeView;
    }

    post.encode(encoder, postInput, context.getCurrentTexture().createView());

    device.queue.submit([encoder.finish()]);
    if (loaded) requestAnimationFrame(frame);
}

// Warmup: submit one frame to force GPU shader compilation
lastTime = performance.now();
frame();
await device.queue.onSubmittedWorkDone();
progress(1);
await yieldFrame();

loaded = true;
lastTime = performance.now();
window.addEventListener("pagehide",()=>{
    disposed=true;
    loaded=false;
    resizeObserver.disconnect();
    direct.destroy();cubemap.destroy();splat.destroy();godrays.destroy();post.destroy();lbvh.destroy();
    device.destroy();
},{once:true});
overlay.style.opacity = "0";
overlay.addEventListener("transitionend", () => overlay.remove());
requestAnimationFrame(frame);
