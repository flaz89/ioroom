import './minimap.css';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useStore } from '../../../store/appStore';
import { activeLevel } from '../../../plan/planModel';
import { fitMinimap, minimapShapes } from '../../../plan/minimap';
import { walkPose } from '../../scene/controls/walk';
import { otherPlayers } from './otherPlayers';
import { xrStore } from '../../../xr/xrStore';

const SIZE = 100; // viewBox units (the css sets the size on screen)
const PAD = 6;

const path = (points, toMap) => `M${points.map((p) => toMap(p).map((n) => n.toFixed(2)).join(' ')).join('L')}Z`;

/*
* MINIMAP of the tour on a flat screen (third / first person, out of XR): the active level from above (plan up =
* -Z, like the 2D plan) with floors, walls, the gaps of doors and windows (plan/minimap.js), and the walker as an
* orange arrow turned with the view (walkPose, written by WalkControls.jsx, read every animation frame: no React
* render while walking), and the other players in their color (otherPlayers.js: headset users and walkers of
* the room). On / off with the map button next to the tour views (store minimapOpen). Placement: minimap.css.
*/
export default function Minimap() {
    const isWalking = useStore((state) => state.workspace === 'tour' && state.tourView !== 'orbit');
    const isOpen = useStore((state) => state.minimapOpen); // toggle next to the tour views (WorkspaceSwitch.jsx)
    const level = useStore((state) => activeLevel(state.plan));
    const isXR = useSyncExternalStore(xrStore.subscribe, () => xrStore.getState().mode != null);
    const playerRef = useRef();
    const othersRef = useRef();
    const shown = isWalking && !isXR && isOpen;

    const map = useMemo(() => {
        const shapes = minimapShapes(level);
        const { toMap } = fitMinimap(shapes.bounds, SIZE, PAD);
        return {
            toMap,
            floors: shapes.floors.map((points) => path(points, toMap)),
            walls: shapes.walls.map((points) => path(points, toMap)),
            openings: shapes.openings.map((points) => path(points, toMap))
        };
    }, [level]);

    useEffect(() => {
        if (!shown) return;
        let raf = 0;
        const tick = () => {
            const [u, v] = map.toMap([walkPose.x, walkPose.z]);
            playerRef.current?.setAttribute('transform', `translate(${u.toFixed(2)} ${v.toFixed(2)}) rotate(${(-walkPose.yaw * 180 / Math.PI).toFixed(1)})`);
            playerRef.current?.setAttribute('visibility', walkPose.active ? 'visible' : 'hidden');
            // the other players: a dot in their color with a tick towards where they look (rebuilt only on change)
            const others = otherPlayers().map(({ x, z, yaw, color }) => {
                const [ou, ov] = map.toMap([x, z]);
                return `<g transform="translate(${ou.toFixed(1)} ${ov.toFixed(1)}) rotate(${(-yaw * 180 / Math.PI).toFixed(0)})">`
                    + `<path d="M0 0L0 -4.6" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`
                    + `<circle r="2.4" fill="${color}" stroke="#fff" stroke-width=".6"/></g>`;
            }).join('');
            if (othersRef.current && othersRef.current.dataset.markup !== others) {
                othersRef.current.innerHTML = others;
                othersRef.current.dataset.markup = others;
            }
            raf = requestAnimationFrame(tick);
        };
        tick();
        return () => cancelAnimationFrame(raf);
    }, [shown, map]);

    if (!shown) return null;
    return (
        <svg className="minimap" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-label="Map">
            {/* door / window gaps: holes cut out of the walls (the floor shows through), no background to paint */}
            <mask id="minimap-gaps">
                <rect x="0" y="0" width={SIZE} height={SIZE} fill="white" />
                {map.openings.map((d, i) => <path key={i} d={d} fill="black" />)}
            </mask>
            {map.floors.map((d, i) => <path key={`f${i}`} d={d} className="minimap-floor" />)}
            <g mask="url(#minimap-gaps)">
                {map.walls.map((d, i) => <path key={`w${i}`} d={d} className="minimap-wall" />)}
            </g>
            <g ref={othersRef} />
            <g ref={playerRef} visibility="hidden">
                <path d="M0 -4.5L3.2 3.2L0 1.6L-3.2 3.2Z" className="minimap-player" />
            </g>
        </svg>
    );
}
