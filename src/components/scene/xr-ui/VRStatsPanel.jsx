import { useStore } from '../../../store/appStore';
import { drawPanel, useCanvasTexture } from './useCanvasTexture';

const WIDTH_M = 0.16;  // panel size in meters
const HEIGHT_M = 0.1 * 452 / 320; // keeps the canvas aspect (7 rows + the menu-hidden line)

/*
* In-VR version of the performance panel: draws the same stats published by <PerfSampler>
* (perfSlice) on a canvas texture, redrawn only when a new sample arrives (~2 Hz).
*/
export default function VRStatsPanel(groupProps) {
    const stats = useStore((state) => state.perf.stats);
    const hidden = useStore((state) => state.perf.hiddenStats);

    const texture = useCanvasTexture(512, 452, (ctx, w, h) => {
        drawPanel(ctx, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left'; // the 2D context keeps state between redraws
        ctx.font = '700 30px "SUSE Mono", monospace';
        ctx.fillText(stats ? `${stats.backend}  ${stats.fps.toFixed(0)} FPS` : 'Collecting...', 28, 24);
        if (!stats) return;

        const rows = [
            ['Frame', `${stats.frameMs.toFixed(1)} ms`],
            ['CPU update', `${(stats.cpuMs - stats.renderMs).toFixed(1)} ms`],
            ['CPU render', `${stats.renderMs.toFixed(1)} ms`],
            ['Draw calls', stats.drawCalls.toLocaleString('en-US')],
            ['Triangles', stats.triangles.toLocaleString('en-US')],
            ['Textures', String(stats.textures)],
            ['JS heap', stats.jsHeapUsedBytes == null ? '-' : `${(stats.jsHeapUsedBytes / 1048576).toFixed(0)} MB`]
        ];
        ctx.font = '400 26px "SUSE Mono", monospace';
        rows.forEach(([label, value], i) => {
            const y = 80 + i * 44;
            ctx.globalAlpha = 0.65;
            ctx.textAlign = 'left';
            ctx.fillText(label, 28, y);
            ctx.globalAlpha = 1;
            ctx.textAlign = 'right';
            ctx.fillText(value, w - 28, y);
        });
        // last sample with the wrist menu hidden: frame, draw calls, CPU update + render
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ff9a1a';
        ctx.font = '400 22px "SUSE Mono", monospace';
        ctx.fillText(hidden ? `Hidden ${hidden.frameMs.toFixed(1)}ms ${hidden.drawCalls}dc U${(hidden.cpuMs - hidden.renderMs).toFixed(1)} R${hidden.renderMs.toFixed(1)}` : 'Hidden: lower the hand', 28, 80 + rows.length * 44);
    }, [stats, hidden]);

    return (
        <group {...groupProps}>
            {/* raycast disabled: the panel must not block rays aimed at the buttons or the scene */}
            <mesh raycast={() => null}>
                <planeGeometry args={[WIDTH_M, HEIGHT_M]} />
                <meshBasicMaterial map={texture} transparent toneMapped={false} />
            </mesh>
        </group>
    );
}
