import { cp, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "../exports");
const target = join(root, "public", "production");
await mkdir(target, { recursive: true });
let names;
try { names = await readdir(source); }
catch (error) {
  if (error?.code === "ENOENT") {
    console.warn("No ../exports folder found; production assets remain unavailable. The labeled mock fixture still runs.");
    process.exit(0);
  }
  throw error;
}
let copied = 0;
for (const name of names) {
  if (!name.endsWith(".glb")) continue;
  await cp(join(source, name), join(target, name));
  copied++;
}
console.log(`Synced ${copied} TopoTopo GLB export(s) from ../exports -> public/production/`);
