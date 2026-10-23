import CircleButton from '../circle-button/CircleButton';
import { useStore } from '../../../store/appStore';
import { svg } from '../../../utils/svg-logos';
import { SSGI_QUALITIES, RENDER_RANGES } from '../../../store/slices/settingSlice';
import './render-panel.css';

// Sliders of the numeric settings, each shown under the switch it belongs to (`after`)
const SLIDERS = [
    { key: 'giIntensity', label: 'GI intensity', after: 'ssgi', format: (value) => value.toFixed(1) },
    { key: 'ssrIntensity', label: 'Reflection intensity', after: 'ssr', format: (value) => value.toFixed(2) }
];

// One row per render setting (store settings, settingSlice.js RENDER_DEFAULTS), in pipeline order.
// `needs`: another setting this one only works with (shown disabled otherwise).
const ROWS = [
    { key: 'ssgi', label: 'Global illumination', hint: 'SSGI: indirect light and ambient occlusion, every frame' },
    { key: 'denoise', label: 'Denoise GI', hint: 'Experimental: smooths the GI grain, can flicker', needs: 'ssgi' },
    { key: 'ssr', label: 'Reflections', hint: 'SSR: glossy surfaces reflect what is on screen' },
    { key: 'lightProbes', label: 'Light probes', hint: 'Experimental: baked GI, rebuilt after each change' }
];

/*
* "Rendering" button of the settings group: a panel to switch the render effects on and off live and tune
* them (GI quality preset, GI and reflection intensity), to see what each one adds and costs (open the
* Performance panel alongside). Values are per device (settingSlice.js). A knob is shown only while its
* effect is on.
* The effects run on the desktop WebGPU renderer only: elsewhere (WebGL fallback, XR) the panel says so and
* the switches only take effect there.
*/
export default function RenderPanel() {
    // Open state shared with the other toolbar panels: only one open at a time (store/slices/panelSlice.js)
    const isOpen = useStore((state) => state.openPanel === 'render');
    const togglePanel = useStore((state) => state.togglePanel);
    const settings = useStore((state) => state.settings);
    const toggleRenderSetting = useStore((state) => state.toggleRenderSetting);
    const setRenderSetting = useStore((state) => state.setRenderSetting);
    const isWebGPU = useStore((state) => state.renderer.backend === 'webgpu');

    return (
        <div className="render-control">
            <CircleButton svg={svg.render} onClick={() => togglePanel('render')} isActive={isOpen} title="Rendering" />
            {isOpen && (
                <div className="render-panel">
                    <span className="render-title">Rendering</span>
                    {!isWebGPU && <span className="render-note">These effects need WebGPU: not active on this renderer.</span>}
                    {ROWS.map(({ key, label, hint, needs }) => {
                        const isDisabled = needs != null && !settings[needs];
                        return (
                            <div key={key} className="render-group">
                                <label className={`render-row${isDisabled ? ' is-disabled' : ''}`} title={hint}>
                                    <input type="checkbox" checked={settings[key]} disabled={isDisabled}
                                        onChange={() => toggleRenderSetting(key)} />
                                    <span>{label}</span>
                                </label>
                                {/* GI quality preset */}
                                {key === 'ssgi' && settings.ssgi && (
                                    <div className="render-knob">
                                        <span>Quality</span>
                                        <select value={settings.ssgiQuality} onChange={(event) => setRenderSetting('ssgiQuality', event.target.value)}>
                                            {Object.entries(SSGI_QUALITIES).map(([id, { label: name }]) => <option key={id} value={id}>{name}</option>)}
                                        </select>
                                    </div>
                                )}
                                {SLIDERS.filter((slider) => slider.after === key && settings[key]).map((slider) => (
                                    <div key={slider.key} className="render-knob">
                                        <span>{slider.label} <b>{slider.format(settings[slider.key])}</b></span>
                                        <input type="range" {...RENDER_RANGES[slider.key]} value={settings[slider.key]}
                                            onChange={(event) => setRenderSetting(slider.key, Number(event.target.value))} />
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
