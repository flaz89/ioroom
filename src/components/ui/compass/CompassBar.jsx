import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../../store/appStore';
import { subscribeCameraHeading } from '../../scene/sun/cameraHeading';
import { skyMarkers } from '../../scene/sun/sunLighting';
import './compass.css';

/*
* Game-style compass bar at the top center: a tape of geographic directions (N, NE, E...) that scrolls
* as the view turns, the current heading under the center mark, and the sun on the horizon (for the
* environment's place, day and time). After sunset the moon takes its place, opposite the sun (skyMarkers).
* Geographic = room heading minus the room orientation (store sun.northDeg).
*
* The tape covers three turns (-360..720 degrees) so any heading has 90 degrees visible on each side;
* it is moved imperatively (transform) from the camera heading listener: no React render per frame.
*/
const PX_PER_DEGREE = 2;            // tape scale; visible span = bar width / PX_PER_DEGREE
const TICK_STEP = 15;               // degrees between ticks
const LABELS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const TURNS = [-360, 0, 360];
const TAPE_DEGREES = [];
for (let degree = -360; degree < 720; degree += TICK_STEP) TAPE_DEGREES.push(degree);

const normalize = (degrees) => ((degrees % 360) + 360) % 360;
const tapeX = (degrees) => (degrees + 360) * PX_PER_DEGREE; // position of a direction on the tape

export default function CompassBar() {
    const barRef = useRef();
    const tapeRef = useRef();
    const sun = useStore((state) => state.sun);
    const northDeg = sun.northDeg;

    // Sun by day, moon at night (degrees)
    const { sunAzimuth, moonAzimuth } = useMemo(() => skyMarkers(sun), [sun]);

    // Scroll the tape so the geographic heading sits under the center mark
    useEffect(() => subscribeCameraHeading((roomHeading) => {
        const geographic = normalize(roomHeading - northDeg);
        const center = barRef.current.clientWidth / 2;
        tapeRef.current.style.transform = `translateX(${center - tapeX(geographic)}px)`;
    }), [northDeg]);

    return (
        <div className="compass" aria-hidden="true">
            <div className="compass-bar" ref={barRef}>
                <div className="compass-tape" ref={tapeRef}>
                    {TAPE_DEGREES.map((degree) => {
                        const label = LABELS[normalize(degree)];
                        return (
                            <span key={degree} className={label ? 'compass-tick is-major' : 'compass-tick'} style={{ left: tapeX(degree) }}>
                                {label && <span className={label === 'N' ? 'compass-label is-north' : 'compass-label'}>{label}</span>}
                            </span>
                        );
                    })}
                    {sunAzimuth != null && TURNS.map((turn) => (
                        <span key={`sun${turn}`} className="compass-sun" style={{ left: tapeX(sunAzimuth + turn) }} />
                    ))}
                    {moonAzimuth != null && TURNS.map((turn) => (
                        <span key={`moon${turn}`} className="compass-moon" style={{ left: tapeX(moonAzimuth + turn) }} />
                    ))}
                </div>
                <span className="compass-center" />
            </div>
        </div>
    );
}
