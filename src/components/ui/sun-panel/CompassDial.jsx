import { useRef } from 'react';

/*
* Round compass to set the room orientation (store sun.northDeg) in the sun panel.
* The room is drawn fixed in the middle, its back wall (-Z) at the top; the ring with N/E/S/W turns
* around it: N points where geographic north is. Drag anywhere on the dial to turn it (N follows the
* pointer); arrow keys turn it by 5° (Shift: 15°). The sun (day) or the moon (night) is shown on the ring.
* Props: value (northDeg), onChange(deg), sunAzimuth / moonAzimuth (degrees or null), disabled
* (read-only: guests see the orientation but cannot change it).
*/
const SIZE = 132;
const C = SIZE / 2;
const RING = 54;           // radius of the letters ring
const LETTERS = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];

const normalize = (degrees) => ((Math.round(degrees) % 360) + 360) % 360;
// Point at `radius` from the center, `degrees` clockwise from the top
const polar = (degrees, radius) => {
    const radians = degrees * Math.PI / 180;
    return [C + Math.sin(radians) * radius, C - Math.cos(radians) * radius];
};

export default function CompassDial({ value, onChange, sunAzimuth, moonAzimuth, disabled = false }) {
    const svgRef = useRef();

    // North follows the pointer angle around the center
    const fromPointer = (event) => {
        const box = svgRef.current.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        onChange(normalize(Math.atan2(dx, -dy) * 180 / Math.PI));
    };

    const onPointerDown = (event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        fromPointer(event);
    };
    const onPointerMove = (event) => {
        if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
    };
    const onKeyDown = (event) => {
        const step = event.shiftKey ? 15 : 5;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onChange(normalize(value + step));
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onChange(normalize(value - step));
        else return;
        event.preventDefault();
    };

    const ticks = [];
    for (let degree = 0; degree < 360; degree += 15) {
        const isMajor = degree % 90 === 0;
        const [x1, y1] = polar(value + degree, C - 4);
        const [x2, y2] = polar(value + degree, C - (isMajor ? 12 : 8));
        ticks.push(<line key={degree} x1={x1} y1={y1} x2={x2} y2={y2} className={isMajor ? 'dial-tick is-major' : 'dial-tick'} />);
    }

    return (
        <svg
            ref={svgRef}
            className={disabled ? 'compass-dial is-disabled' : 'compass-dial'}
            width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="slider" aria-label="Room orientation (north)" aria-valuemin={0} aria-valuemax={359}
            aria-valuenow={value} aria-readonly={disabled} tabIndex={disabled ? -1 : 0}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onKeyDown={disabled ? undefined : onKeyDown}
        >
            <circle cx={C} cy={C} r={C - 2} className="dial-face" />
            {ticks}

            {/* Room, fixed: the back wall is the thicker top side */}
            <rect x={C - 14} y={C - 14} width={28} height={28} rx={3} className="dial-room" />
            <line x1={C - 14} y1={C - 14} x2={C + 14} y2={C - 14} className="dial-room-back" />

            {LETTERS.map(([letter, offset]) => {
                const [x, y] = polar(value + offset, RING - 20);
                return <text key={letter} x={x} y={y} className={letter === 'N' ? 'dial-letter is-north' : 'dial-letter'}>{letter}</text>;
            })}

            {/* North pointer on the rim */}
            {(() => {
                const [x, y] = polar(value, C - 15);
                return <circle cx={x} cy={y} r={3.5} className="dial-north" />;
            })()}

            {sunAzimuth != null && (() => {
                const [x, y] = polar(value + sunAzimuth, C - 15);
                return <circle cx={x} cy={y} r={4} className="dial-sun" />;
            })()}

            {/* Moon: crescent = lit disc minus a disc shifted towards its dark side */}
            {moonAzimuth != null && (() => {
                const [x, y] = polar(value + moonAzimuth, C - 15);
                return (
                    <g className="dial-moon">
                        <mask id="dial-moon-mask">
                            <circle cx={x} cy={y} r={5} fill="white" />
                            <circle cx={x - 2.5} cy={y - 1.2} r={4.3} fill="black" />
                        </mask>
                        <circle cx={x} cy={y} r={5} mask="url(#dial-moon-mask)" />
                    </g>
                );
            })()}
        </svg>
    );
}
