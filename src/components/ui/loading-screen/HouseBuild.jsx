import { useEffect, useRef } from 'react';

// One house elevation in DXF-style orange lines (house units: x 0..100, ground at y 80).
// stage: the construction phase the stroke belongs to (1 = foundation ... 5 = details, finished house).
const HOUSE = [
    { stage: 1, d: 'M 8 80 V 76 H 92 V 80' },                                       // foundation
    { stage: 1, d: 'M 14 80 l -3 4 M 26 80 l -3 4 M 38 80 l -3 4 M 50 80 l -3 4 M 62 80 l -3 4 M 74 80 l -3 4 M 86 80 l -3 4' }, // ground hatch
    { stage: 2, d: 'M 14 76 V 38' },                                                // walls
    { stage: 2, d: 'M 86 76 V 38' },
    { stage: 2, d: 'M 14 57 H 86' },                                                // first floor
    { stage: 3, d: 'M 14 38 H 86' },                                                // eaves
    { stage: 3, d: 'M 6 41 L 50 12 L 94 41' },                                      // roof, with overhang
    { stage: 3, d: 'M 68 24 V 15 H 75 V 28.5' },                                    // chimney
    { stage: 4, d: 'M 44 76 V 62 H 56 V 76' },                                      // door
    { stage: 4, d: 'M 21 70 h 14 v -8 h -14 Z M 65 70 h 14 v -8 h -14 Z' },          // ground floor windows
    { stage: 4, d: 'M 21 51 h 14 v -8 h -14 Z M 43 51 h 14 v -8 h -14 Z M 65 51 h 14 v -8 h -14 Z' }, // first floor
    { stage: 5, d: 'M 28 62 v 8 M 72 62 v 8 M 28 43 v 8 M 50 43 v 8 M 72 43 v 8' }, // window mullions
    { stage: 5, d: 'M 53 69.5 h 1.5' },                                             // door handle
    { stage: 5, d: 'M 46 29 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0' }                     // gable oculus
];
const STAGES = 5;           // columns, left to right: one construction phase each
const COLUMN = 31;          // viewBox width of a column: the 26 wide house + a small gap
const HOUSE_SCALE = 0.26;   // house units -> viewBox (100 wide -> 26, in a 31 wide column)
const WIDTH = STAGES * COLUMN;
const GROUND_Y = 80 * HOUSE_SCALE;
const HEIGHT = 85 * HOUSE_SCALE; // down to the bottom of the ground hatch

// Calibration knobs
const CYCLE_MS = 4500;  // one full build of the five columns; restarts if the loading takes longer
const BUILD_END = 0.82; // share of the cycle spent drawing; the rest shows the finished row
const FADE = 0.05;      // share of the cycle for the fade in / out at the loop seam

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

// Column i shows every stroke up to its stage (i + 1). Draw order: the ground line first, then the columns
// left to right, each drawing its strokes in build order within its own time slot.
const COLUMNS = Array.from({ length: STAGES }, (_, column) => HOUSE.filter(({ stage }) => stage <= column + 1));

/*
* Loading animation (LoadingScreen.jsx): a construction time-lapse as a row of FIVE FIXED COLUMNS, each one
* a phase of the same house (foundation, structure, roof, openings, details = finished). The columns are
* drawn one after the other, left to right, line by line; then the cycle starts again (fade at the seam).
* In each column the earlier phases are dimmed and its own phase is full orange: what each step adds reads
* at a glance.
* EFFICIENCY: one SVG, animated with requestAnimationFrame writing the styles directly (no React re-render
* per frame); each stroke has pathLength 1, so its drawn share is just 1 - dashoffset.
* Reduced motion: the finished row, still.
*/
export default function HouseBuild() {
    const rowRef = useRef(null);
    const groundRef = useRef(null);
    const pathRefs = useRef([]); // [column][stroke]

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
        const groundEnd = BUILD_END * 0.1;                 // the ground line: first 10% of the build
        const slot = (BUILD_END - groundEnd) / STAGES;     // time slot of each column
        let frame;
        const start = performance.now();
        const tick = (now) => {
            // unmounting: React clears the refs before this effect's cleanup cancels the last frame
            if (rowRef.current === null) return;
            const t = ((now - start) % CYCLE_MS) / CYCLE_MS; // 0..1 in the cycle
            groundRef.current.style.strokeDashoffset = String(1 - clamp01(t / groundEnd));
            pathRefs.current.forEach((paths, column) => {
                const from = groundEnd + column * slot;
                const share = slot / paths.length; // each stroke of the column: same slice of its slot
                paths.forEach((path, index) => {
                    if (path === null) return;
                    path.style.strokeDashoffset = String(1 - clamp01((t - from - index * share) / share));
                });
            });
            rowRef.current.style.opacity = String(Math.min(clamp01(t / FADE), clamp01((1 - t) / FADE)));
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, []);

    return (
        <svg className="house-build" viewBox={`0 -1 ${WIDTH} ${HEIGHT + 2}`} aria-hidden="true">
            <g ref={rowRef}>
                <path ref={groundRef} d={`M 0 ${GROUND_Y} H ${WIDTH}`} pathLength="1" />
                {COLUMNS.map((strokes, column) => (
                    // house x 40..160 centered in its column
                    <g key={column} transform={`translate(${column * COLUMN + COLUMN / 2 - 100 * HOUSE_SCALE} 0) scale(${HOUSE_SCALE})`}>
                        {strokes.map(({ d, stage }, index) => (
                            <path key={index} d={d} pathLength="1" className={stage <= column ? 'is-earlier' : undefined}
                                ref={(node) => { (pathRefs.current[column] ??= [])[index] = node; }} />
                        ))}
                    </g>
                ))}
            </g>
        </svg>
    );
}
