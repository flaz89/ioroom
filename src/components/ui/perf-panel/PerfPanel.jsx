import './perf-panel.css';
import { useStore } from '../../../store/appStore';

// Formatting helpers: "-" when a metric is not available on the current browser/renderer
const fixed = (value, digits = 1) => (value == null ? '-' : value.toFixed(digits));
const count = (value) => (value == null ? '-' : value.toLocaleString('en-US'));
const megabytes = (bytes) => (bytes == null ? '-' : `${(bytes / 1048576).toFixed(1)} MB`);

/*
* Performance overlay (DOM). Shows the snapshot published by <PerfSampler>; works for both renderers.
* GPU time and GPU memory are WebGPU-only, JS heap is Chromium-only.
*/
export default function PerfPanel() {
    const isVisible = useStore((state) => state.perfOpen);
    const stats = useStore((state) => state.perf.stats);

    if (!isVisible || !stats) return null;

    const rows = [
        ['FPS', fixed(stats.fps, 0)],
        ['Frame', `${fixed(stats.frameMs)} ms`],
        ['CPU update', `${fixed(stats.cpuMs - stats.renderMs)} ms`],
        ['CPU render', `${fixed(stats.renderMs)} ms`],
        ['GPU', stats.gpuMs == null ? '-' : `${fixed(stats.gpuMs, 2)} ms`],
        ['Draw calls', count(stats.drawCalls)],
        ['Triangles', count(stats.triangles)],
        ['Geometries', count(stats.geometries)],
        ['Textures', count(stats.textures)],
        ['Shaders', count(stats.shaders)],
        ['GPU mem (est.)', megabytes(stats.gpuMemoryBytes)],
        ['JS heap', stats.jsHeapUsedBytes == null ? '-' : `${megabytes(stats.jsHeapUsedBytes)} / ${megabytes(stats.jsHeapLimitBytes)}`]
    ];

    return (
        <div className="perf-panel" aria-live="off">
            <div className="perf-panel-header" title={stats.gpuName ?? undefined}>
                {stats.backend}{stats.gpuName && <span className="perf-panel-gpu"> · {stats.gpuName}</span>}
            </div>
            <dl className="perf-panel-grid">
                {rows.map(([label, value]) => (
                    <div key={label} className="perf-panel-row">
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
