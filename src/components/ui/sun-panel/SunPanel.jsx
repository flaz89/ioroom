import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { useStore } from '../../../store/appStore';
import { CITIES, findCity } from '../../scene/sun/sun';
import { SYNC_HOST, isAdmin } from '../../../sync/roomSync';
import './sun-panel.css';

// "14 Oct" for a day of the year (UTC: no time zone shift of the label)
const formatDay = (day) =>
    new Date(Date.UTC(new Date().getFullYear(), 0, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
// "15:05" for minutes after midnight
const formatTime = (minutes) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/*
* Sun toolbar button: opens a small panel next to the left toolbar with the sun settings of the
* environment (store `sun`, light: components/light/Light.jsx):
* - location: picked from a fixed list of cities; only the owner can change it in a shared room
*   (everyone, when sync is off);
* - day of the year and clock time: sliders, the sun moves live along its arc (shown while sliding);
* - north: room orientation, degrees clockwise from the back wall.
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
    const canEditLocation = !SYNC_HOST || isAdmin;

    return (
        <div className="sun-control">
            <CircleButton svg={svg.sun} onClick={() => togglePanel('sun')} isActive={isOpen} title="Sun light" />
            {isOpen && (
                <div className="sun-panel">
                    <span className="sun-title">Sun</span>

                    <label className="sun-row">
                        <span>Location</span>
                        {canEditLocation ? (
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

                    <label className="sun-row">
                        <span>North <b>{sun.northDeg}°</b></span>
                        <input type="range" min={0} max={359} value={sun.northDeg}
                            onChange={(event) => setSun({ northDeg: Number(event.target.value) })} />
                    </label>
                </div>
            )}
        </div>
    );
}
