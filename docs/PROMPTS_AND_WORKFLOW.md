# Prompts and Workflow — Vietnamese Tea Stall

This document summarizes the work session for building the Vietnamese sidewalk tea-stall asset library and integrating the Texel Splatting demo. The session content has been **summarized and rewritten**: the sample prompts below are reusable templates, not verbatim quotations. Do not store transcripts, reference images, personal machine paths, out-of-scope conversations, or confidential information in the public repository.

## Initial requirements and scope change

The initial request focused on creating 3D assets from reference images, prioritizing a red plastic stool and a conical hat as a proof of concept, and using TopoTopo exclusively for geometry and production assets. It initially said not to modify the renderer during the asset phase. The project owner later expanded and changed the scope: build the asset library and Texel Splatting demo in parallel, without waiting for new assets before starting renderer work. This change is recorded in the project contract; the initial request must not be interpreted as prohibiting renderer integration for the entire project.

Core requirements:

- Treat reference images as the primary source of truth; prioritize the actual shape and identifying features, and do not invent major unsupported details.
- Keep procedural graphs editable and reproducible; use documented TopoTopo schemas. Do not use Blender or external 3D geometry generation services.
- Produce static GLBs according to the contract: meters, Y-up, triangle meshes, normals, opaque material colors; support named multiple meshes/materials and hierarchy in the loader.
- Preserve the Texel Splatting baseline and core technique; demonstrate the same geometry through Direct, Cubemap, and Splat.
- Begin integration with clearly labeled mocks so renderer work is not blocked while production assets are unavailable.
- Verify with tests, builds, logs, and actual runs; clearly state what has not been tested.

## Reusable prompt templates

### 1. Parallel-work coordination prompt

```text
Carry out project [PROJECT] in [REPOSITORY]. Before making changes, read the project instructions, interface contract, and current Git state.

Split work in parallel with non-overlapping file ownership:
- Asset lead: use [asset tool] exclusively for production geometry/assets; keep graphs editable and provide GLBs, metadata, and validation results.
- Demo lead: work on the renderer/demo in [demo directory]; do not overwrite the asset directory or the history of a nested upstream repository.
- Coordinator: finalize the asset contract, coordinate checkpoints, review integration, and verify.

Every agent/child must set exactly model `openai-codex/gpt-6-luna` and thinking `high`. Do not use ambiguous aliases or `:batch`; inspect agent status/output, and rerun with the correct route if the model fails.

Do not make the demo wait for assets: use labeled synthetic fixtures. Finalize the contract before integration. Preserve the baseline and core technique. Record ownership, dependencies, checkpoints, test evidence, and blockers. Do not claim a feature is complete without corresponding evidence.
```

### 2. Reference-based asset prompt — template

```text
Create [ASSET] for a Vietnamese sidewalk tea stall based on the supplied reference image. The image is the primary source of truth. Before modeling, briefly describe the silhouette, proportions, structure, and any parts that are inferred. Preserve openings, gaps, curves, and identifying features; do not invent major unsupported details.

Use TopoTopo only to create geometry and export production assets. Use actual documented schemas/tools; do not guess node types or parameters. Keep the graph clearly named, editable, deterministic, and parameterized for dimensions and materials. Use meters, Y-up, front +Z where meaningful, and an origin at the ground contact plane.

Create front/side/top/three-quarter views; compare them with the image, describe differences, revise the graph, and iterate. Check bounds, normals/winding, materials, triangle count, disconnected components, and topology limitations. Export a GLB according to the contract. Report exact files, dimensions, triangle/material counts, validation results, and limitations; do not claim fidelity or tests that were not performed.
```

Essential project note: the furniture shown in the reference is a **low backless stool**, not a chair with a back. The conical hat is a broad ivory cone with a narrow rim; explicitly identify unseen parts as inferred. Other props have no close-up references, so their proportions/forms must be described as assumptions, not as image-matched.

### 3. GLB renderer and three render paths prompt — template

```text
In [DEMO_REPO], integrate static GLB assets according to contract [LINK]. First inspect the upstream baseline, install/test/build commands, and scene-specific assumptions. Do not change the Texel Splatting algorithm without a specific reason and verification.

Create a GLB adapter with a documented scope: hierarchy/TRS, positions/normals, triangle indices, opaque base-color, bounds, transforms, and multiple meshes/materials. Start with a multi-mesh/color mock fixture; label it as a mock and do not present it as a production asset.

Render the same scene through Direct, Cubemap, and Splat using each mode's actual code path; do not disguise a fallback with an inaccurate label. When production assets are ready, switch paths/configuration rather than rewriting the renderer. Check mesh/materials, transforms, normals, winding, shadows, and console/shader errors. Record test/build/browser evidence within its actual scope; do not claim browser, GPU, mobile, or deployment support unless it has been tested.
```

### 4. Verification/handoff prompt

```text
Before concluding: run unit tests, type/check, production build, and an appropriate smoke test. If UI/runtime is in scope, run the demo and exercise the main flow when possible. Compare hashes of integrated assets with their sources; distinguish test fixtures from production assets. Review the diff and both the root Git repository and any nested repositories; exclude secrets, local paths, and images/assets not approved for release. Clearly report PASS/FAIL, commands and artifact evidence, remaining limitations, what was not tested, commit, and remote status.
```

## Workflow followed

1. **Confirm goals, inspect the repository, and define publication boundaries.** Read the request, contract, Texel Splatting baseline, file ownership, root Git repository, and nested repository. Keep the upstream repository inside `web-demo/` separate; do not mix its nested Git history into the root repository.
2. **Define a shared contract.** Uncompressed GLB 2.0, static triangle meshes, meters/Y-up, POSITION/NORMAL required, opaque base color; no V1 dependency on textures, skinning, animation, meshopt, Draco, or GPU instancing.
3. **Divide the work in parallel.** The asset branch owns graphs/exports/previews and uses TopoTopo only for production geometry; the demo branch owns `web-demo/`. The demo uses synthetic fixtures before production assets are available. Delegate disjoint files and require checking the exact model/thinking route before creating agents.
4. **Inspect the baseline and build the adapter.** Keep the upstream baseline choice separate; build a clearly scoped GLB loader and generalize the render paths. Run mock-based tests first, then integrate actual GLBs after the checkpoint is met.
5. **Iterate on assets against references and feedback.** Compare multi-angle previews with references and revise the graph rather than stopping at the first generation. For example, the bamboo pipe was revised to have a longer bamboo body and a smaller bowl; its orientation in the scene was updated so the bowl is visible from the demo camera angle. Pipe/bowl proportions are inferred because there is no close-up reference. Do not hide remaining topology limitations.
6. **Integrate by checkpoints.** Mock GLB → first validated asset → complete scene → three-mode verification. Synchronize assets by hash, then rerun tests/build and QA against the final hash.
7. **Review independently and publish with qualifications.** Review the renderer, evidence, license, and publication branch. The current GitHub release contains code, mocks, and one explicitly authorized README showcase image: production assets, TopoTopo graphs, reference images, previews, and private evidence are otherwise excluded. The showcase depicts production assets that are not bundled and is included for display only, outside the repository's MIT license grant. The demo does not imply that mocks are the production scene.

## Corrections and lessons learned

- An agent initially failed because of `:batch` model routing. The user identified the error and requested a rerun with the exact route. Remember to use `openai-codex/gpt-6-luna` with thinking `high`, not an ambiguous alias or `:batch`; verify the output rather than assuming the agent ran successfully.
- The initial asset-only scope prohibited renderer changes, but a subsequent request deliberately expanded the project into two parallel workstreams. The updated contract is the current source of truth.
- Do not wait for real assets to develop the loader; fixtures allow independent progress but must always be labeled as mocks.
- One successful render is not enough to establish quality. Revise based on previews, inspect assets after export, synchronize by hash, and rerun QA on the latest assets.
- Do not overstate results: Direct/Cubemap do not have the ID/outline output available in the Splat path; there is no picking/selection. The rAF benchmark reflects CPU/display callback timing, not GPU timestamps. No deployment or mobile support is claimed.

## Evidence and verification scope

The project session's notes/handoffs contain detailed results but are internal documents excluded from the release. They record 8 TopoTopo GLBs, graphs, and verified provenance; no structural errors/warnings from the Khronos validator; and 7/7 demo tests, check, and build passing at the time of handoff. Native Chrome/WebGPU on a Mac was tested in Direct, Cubemap, and Splat with the final asset hash, with no page/console errors. The handoff also reports the feature gap for ID/outline described above.

For verification of this document, `npm test`, `npm run check`, and `npm run build` all succeeded; the current output is 6/6 tests passing. The build synchronized 8 GLBs from the ignored local asset directory into `web-demo/public/production/`; those files must not be staged or committed. This is not a browser/GPU rerun for this documentation update.

This is an **evidence summary from the session handoff**, not a claim that readers can reproduce it from the code-only repository. The following demo commands can be rerun in the public repository; they check code and mocks, not the excluded production assets:

```sh
cd web-demo
npm ci
npm test
npm run check
npm run build
```

No public deployment or mobile verification was performed; this does not imply compatibility with all browsers/GPUs. Full asset limitations include open shells, open/non-manifold edges, and contact/intersections between some components; watertight or entirely non-intersecting geometry is not claimed.

## Reuse scope

The prompt templates allow reuse of the workflow, but do not relicense excluded assets. The root `LICENSE` covers only code and documentation released under the stated license scope; see [`PUBLICATION.md`](PUBLICATION.md). Except for the explicitly authorized, display-only README showcase image (which is not covered by the repository's MIT license), do not upload session transcripts, private paths, reference images, or TopoTopo assets to a public release without confirming rights and obtaining separate approval.
