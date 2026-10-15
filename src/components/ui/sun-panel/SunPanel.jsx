import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { useMemo, useRef } from 'react';
import { usePanelInViewport } from '../usePanelInViewport';
import { useStore } from '../../../store/appStore';
import { skyMarkers } from '../../scene/sun/sunLighting';
import CompassDial from './CompassDial';
import { formatDay, formatTime } from '../../scene/sun/format';
import { CITIES, findCity } from '../../scene/sun/sun';
import { SYNC_HOST, isAdmin } from '../../../sync/roomSync';
import './sun-panel.css';

/*
* Sun toolbar button: opens a small panel next to the left toolbar with the sun settings of the
* environment (store `sun`, light: components/light/Light.jsx):
* - location: picked from a fixed list of cities;
* - day of the year and clock time: sliders, the sun moves live along its arc (shown while sliding);
* - north: room orientation, set by turning a round compass (CompassDial.jsx) around the room plan.
* Shared with everyone in the room (sync/sunSync.js). Location and north belong to the environment:
* only the owner changes them (everyone, when sync is off); guests see their values read-only.
*/
export default function SunPanel() {
    // Open state shared with the other toolbar panels: only one open at a time (store/slices/panelSlice.js)
    const isOpen = useStore((state) => state.openPanel === 'sun');
    const togglePanel = useStore((state) => state.togglePanel);
    const sun = useStore((state) => state.sun);
    const setSun = useStore((state) => state.setSun);
    const showSunArc = useStore((state) => state.showSunArc);
    // Day/time changes also show the sun's path in the scene for a moment
    const setSunShowingArc = (patch) => { setSun(patch); showSunArc(); };
    const canEditEnvironment = !SYNC_HOST || isAdmin; // location and north
    const panelRef = useRef();

    // Centered on the button (css), kept inside the screen
    usePanelInViewport(panelRef, isOpen);
    // Sun (day) / moon (night) on the dial ring, degrees
    const { sunAzimuth, moonAzimuth } = useMemo(() => skyMarkers(sun), [sun]);

    return (
        <div className="sun-control">
            <CircleButton svg={svg.sun} onClick={() => togglePanel('sun')} isActive={isOpen} title="Sun light" />
            {isOpen && (
                <div className="sun-panel" ref={panelRef}>
                    <span className="sun-title">Sun</span>

                    <label className="sun-row">
                        <span>Location</span>
                        {canEditEnvironment ? (
                            <select value={sun.cityId} onChange={(event) => setSun({ cityId: event.target.value })}>
                                {CITIES.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
                            </select>
                        ) : (
                            <span className="sun-value" title="Only the owner can change the location">{findCity(sun.cityId).name}</span>
                        )}
                    </label>

                    <label className="sun-row">
                        <span>Day <b>{formatDay(sun.day)}</b></span>
                        <input type="range" min={1} max={365} value={sun.day}
                            onChange={(event) => setSunShowingArc({ day: Number(event.target.value) })} />
                    </label>

                    <label className="sun-row">
                        <span>Time <b>{formatTime(sun.minutes)}</b></span>
                        <input type="range" min={0} max={1435} step={5} value={sun.minutes}
                            onChange={(event) => setSunShowingArc({ minutes: Number(event.target.value) })} />
                    </label>

                    <div className="sun-row">
                        <span>North <b>{sun.northDeg}°</b></span>
                        <div className="sun-dial">
                            <CompassDial
                                value={sun.northDeg}
                                onChange={(northDeg) => setSun({ northDeg })}
                                sunAzimuth={sunAzimuth}
                                moonAzimuth={moonAzimuth}
                                disabled={!canEditEnvironment}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
