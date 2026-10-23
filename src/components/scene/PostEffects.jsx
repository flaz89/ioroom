import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RenderPipeline, UnsignedByteType } from 'three/webgpu';
import { pass, mrt, output, normalView, diffuseColor, metalness, roughness, velocity, vec4, packNormalToRGB, unpackRGBToNormal, sample } from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { useStore } from '../../store/appStore';
import { SSGI_QUALITIES } from '../../store/slices/settingSlice';

// SSGI sampling radius in meters (three.js default 12, sized for big scenes). Indoors light bounces over a
// few meters; a big radius also COSTS more the closer the camera gets: projected on screen it spans more
// pixels, so the samples scatter over the whole frame (cache misses) -> ~9 fps zoomed in vs 30 zoomed out.
const SSGI_RADIUS = 3;
// SSR ray-march quality [0, 1] (share of 64 steps). Calibration knob.
const SSR_QUALITY = 0.5;
// SSR rendered at this share of the canvas resolution (each axis): reflections are blurred by roughness
// anyway, half resolution costs a quarter. 1 = full.
const SSR_RESOLUTION = 0.5;

/*
* Desktop WebGPU post-processing (three.js RenderPipeline, TSL nodes), each effect switchable from the store
* settings (settingSlice: ssgi, ssr). Takes over the frame: useFrame with priority 1 stops R3F's own render
* and renders the pipeline instead. Switching an effect rebuilds the pipeline (a handful of nodes, cheap);
* quality and intensities (settings ssgiQuality, giIntensity, ssrIntensity) only update uniforms, live.
*
* Pipeline:
* 1. scene pass with MRT (4 attachments): lit color, albedo + metalness, view normal + roughness, velocity.
*    No MSAA on it (samples: 0): the renderer is created with antialias (MSAA x4, Scene.jsx) and the pass
*    would inherit it, but TRAA copies the pass depth into its single-sampled history (copyTextureToTexture:
*    sample counts must match -> a WebGPU validation error every frame). TRAA does the anti-aliasing anyway;
* 2. SSGI (optional) from color + depth + normal: ambient occlusion and one bounce of indirect diffuse light,
*    EVERY FRAME from what is on screen (no bake): (color + albedo * GI) * AO; AO and GI optionally denoised
*    (settings.denoise: edge-aware spatial filter, on top of the temporal one of TRAA);
* 3. SSR (optional): screen-space reflections from the same buffers, added on top (it outputs premultiplied
*    color). reflectNonMetals: dielectrics reflect too (polished marble, glossy wood, ceramics), not only
*    metals; their reflection follows their roughness (blur) and Fresnel;
* 4. TRAA: accumulates frames over time, which both anti-aliases and denoises the SSGI (its sampling pattern
*    rotates every frame);
* 5. transparent objects (UI in the scene: labels, gizmos, notes...) in a second pass, laid over the result.
*    The first pass draws opaque objects only: a transparent quad writes the effect buffers over its whole
*    area, even where invisible, and the SSGI darkened that rectangle (a halo around the note labels).
* Limits of screen space: light bounces and reflections only come from surfaces that are on screen, and
* things moving without writing velocity can leave short ghosting trails (TRAA; see the physical glass in
* Openings3D.jsx).
*
* WebGPU backend only (Scene.jsx mounts it): XR runs on WebGLRenderer, without post-processing.
*/
export default function PostEffects() {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const camera = useThree((state) => state.camera);
    const isSsgi = useStore((state) => state.settings.ssgi);
    const isSsr = useStore((state) => state.settings.ssr);
    const isDenoise = useStore((state) => state.settings.denoise);

    // The overlay pass draws with a COPY of the camera, synced every frame before the pipeline renders: TRAA
    // jitters the real camera by a sub-pixel offset during the pipeline, and overlays are not accumulated by
    // TRAA, so with the jittered camera their thin lines shimmered.
    const overlayCamera = useMemo(() => camera.clone(), [camera]);

    const effects = useMemo(() => {
        const renderPipeline = new RenderPipeline(gl);

        // OPAQUE objects only (transmissive glass included): they feed the effects. Transparent ones (labels,
        // gizmos, notes, measures, grid...) would overwrite the effect buffers over their whole quad, even where
        // they are invisible -> AO / GI halos around them; they get their own pass below, on top of the result.
        const scenePass = pass(scene, camera, { samples: 0 });
        scenePass.transparent = false;
        // FOUR attachments, packed: WebGPU's default limit is 32 bytes per pixel over all color attachments and
        // each of these costs 8 (rgba16float, and rgba8unorm too) -> a fifth one fails every pipeline ("Bytes
        // per sample (40) exceeded maximum allowed limit (32)"). Metalness rides in the albedo's alpha,
        // roughness in the normal's alpha (both free).
        scenePass.setMRT(mrt({
            output,
            diffuseColor: vec4(diffuseColor.rgb, metalness),
            normal: vec4(packNormalToRGB(normalView), roughness),
            velocity
        }));
        const color = scenePass.getTextureNode('output');
        const albedo = scenePass.getTextureNode('diffuseColor');
        const depth = scenePass.getTextureNode('depth');
        const packedNormal = scenePass.getTextureNode('normal');
        const motion = scenePass.getTextureNode('velocity');
        // bandwidth: albedo + metalness and packed normal + roughness fit in 8 bits per channel
        for (const name of ['diffuseColor', 'normal']) scenePass.getTexture(name).type = UnsignedByteType;
        const normal = sample((uv) => unpackRGBToNormal(packedNormal.sample(uv).rgb));

        let lit = color.rgb;
        let giPass = null;
        let ssrPass = null;
        if (isSsgi) {
            giPass = ssgi(color, depth, normal, camera);
            giPass.radius.value = SSGI_RADIUS; // quality and intensity: uniforms, set below from the settings
            let ao = giPass.getAONode();
            let gi = giPass.getGINode();
            if (isDenoise) {
                // edge-aware spatial denoise (depth + normals keep edges sharp): the raw SSGI is noisiest where
                // it is the only light (shadowed areas). Two extra full-screen passes.
                ao = denoise(ao, depth, normal, camera).r;
                gi = denoise(gi, depth, normal, camera);
            }
            // AO darkens the BOUNCED light too, not only the direct + environment light: a shadowed room is lit
            // almost only by the bounce, so with `lit * AO + albedo * GI` the AO had nothing to darken and the
            // bounce from a sunlit wall made the creases next to it BRIGHTER than the rest (corners, objects
            // against a wall). Applied to the sum, corners and contacts get darker as expected.
            lit = lit.add(albedo.rgb.mul(gi.rgb)).mul(ao);
        }
        if (isSsr) {
            ssrPass = ssr(color, depth, normal, {
                metalnessNode: albedo.a,
                roughnessNode: packedNormal.a,
                diffuseNode: albedo.rgb,
                reflectNonMetals: true,
                camera
            });
            ssrPass.quality.value = SSR_QUALITY;
            ssrPass.resolutionScale = SSR_RESOLUTION;
            lit = lit.add(ssrPass.rgb);
        }
        // TRANSPARENT BACKGROUND: the page's own background must show behind the 3D view (canvas alpha 0 where
        // nothing is drawn). The scene pass alpha cannot be trusted for that: TRAA renders it from inside its
        // own update, after resetting the renderer state (RendererUtils.resetRendererState: clear color black,
        // alpha 1), so the empty sky comes out opaque. Coverage from the DEPTH instead (still at the cleared far
        // value 1 where nothing was drawn). Out of TRAA the color is premultiplied by the resolved coverage (the
        // sky is black), which is what the premultiplied canvas expects.
        const coverage = depth.r.lessThan(1).select(1, 0);
        const resolvedColor = traa(vec4(lit, 1), depth, motion, camera).rgb;
        // TRAA drops the alpha channel (its output alpha is 1 everywhere), so the coverage gets its own TRAA,
        // through the color channels: jitter-averaged like the color. Taken raw per frame it flickered on thin
        // lines and noised the edges. ponytail: a second full-screen TRAA resolve for one channel; pack it with
        // the color if the cost shows.
        const resolvedCoverage = traa(vec4(coverage, coverage, coverage, 1), depth, motion, camera).r;
        const resolved = vec4(resolvedColor, resolvedCoverage);

        // TRANSPARENT objects, drawn after the effects: depth-tested against the opaque pass (shared depth
        // texture, not cleared) into a target cleared to transparent black, then laid over the resolved image.
        // Normal blending leaves premultiplied color in that target: over = top + bottom * (1 - top alpha).
        // Overlays stay sharp: no AO, no TRAA history (no ghosting when they move).
        // ponytail: no anti-aliasing on the overlays (thin lines show stair-stepping). Keep the overlay pass ONLY
        // in this final output node: inside any node rendered to a texture first (SMAA on the composed image,
        // or the overlay composed before TRAA) the whole opaque scene turns black (three r186, reproduced in
        // Chromium too). Narrowed down: it happens only with `overlayPass.opaque = false`, the pass order is
        // right (opaque pass first) and the renderer flags are restored; the root cause is still open.
        const overlayPass = pass(scene, overlayCamera, { samples: 0, depthTexture: scenePass.getTexture('depth'), autoClearDepth: false });
        overlayPass.opaque = false;
        const overlay = overlayPass.getTextureNode('output');
        renderPipeline.outputNode = vec4(
            resolved.rgb.mul(overlay.a.oneMinus()).add(overlay.rgb),
            resolved.a.mul(overlay.a.oneMinus()).add(overlay.a)
        );
        return { pipeline: renderPipeline, giPass, ssrPass };
    }, [gl, scene, camera, overlayCamera, isSsgi, isSsr, isDenoise]);
    const { pipeline, giPass, ssrPass } = effects;
    useEffect(() => () => pipeline.dispose(), [pipeline]);

    // live knobs: uniforms only, no rebuild
    const ssgiQuality = useStore((state) => state.settings.ssgiQuality);
    const giIntensity = useStore((state) => state.settings.giIntensity);
    const aoIntensity = useStore((state) => state.settings.aoIntensity);
    const ssrIntensity = useStore((state) => state.settings.ssrIntensity);
    useEffect(() => {
        if (giPass === null) return;
        const { slices, steps } = SSGI_QUALITIES[ssgiQuality];
        giPass.sliceCount.value = slices;
        giPass.stepCount.value = steps;
        giPass.giIntensity.value = giIntensity;
        giPass.aoIntensity.value = aoIntensity;
    }, [giPass, ssgiQuality, giIntensity, aoIntensity]);
    useEffect(() => {
        if (ssrPass !== null) ssrPass.intensity.value = ssrIntensity;
    }, [ssrPass, ssrIntensity]);

    // priority 1: this callback renders the frame (R3F skips its own render)
    useFrame(() => {
        overlayCamera.copy(camera); // before the pipeline jitters `camera` (TRAA)
        pipeline.render();
    }, 1);
    return null;
}
