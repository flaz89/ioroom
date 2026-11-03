/*
* Line symbols of the "+" menu (CatalogMenu.jsx): catalog categories by id (models/grouping.js) and basic
* shapes by type (objectsList in objectsSlice.js). 48×48, stroke in currentColor; an id without its own
* symbol gets a box. `color` / `width` / `height`: for the VR panel, which draws them as images
* (xr-ui/buttonFace.js loadSvgImage passes them).
*/
const paths = {
    // chair from the front: framed backrest with a rail, seat, front legs long and back legs short
    seating: <><path d="M14 24V9a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v15M14 14h20" /><rect x="10" y="24" width="28" height="5" rx="2" /><path d="M13 29v13M35 29v13M19 29v8M29 29v8" /></>,
    // table: top and two legs
    tables: <><path d="M6 18h36M10 18v20M38 18v20M14 18v-2h20v2" /></>,
    // cabinet with two doors and handles
    storage: <><rect x="10" y="7" width="28" height="32" rx="1.5" /><path d="M24 7v32M21 21v4M27 21v4M13 39v3M35 39v3" /></>,
    // bed: headboard, mattress, pillow
    beds: <><path d="M6 14v26M6 28h36v12M6 34h36" /><rect x="10" y="22" width="9" height="6" rx="2" /><path d="M19 28v-4h23v4" /></>,
    // hob with four burners above an oven
    kitchens: <><rect x="8" y="8" width="32" height="32" rx="2" /><path d="M8 22h32" /><circle cx="17" cy="15" r="3" /><circle cx="31" cy="15" r="3" /><rect x="14" y="27" width="20" height="9" rx="1.5" /></>,
    // bathtub with tap
    bathroom: <><path d="M6 24h36v4a10 10 0 0 1-10 10H16A10 10 0 0 1 6 28z" /><path d="M12 24V12a4 4 0 0 1 8 0M14 38l-2 4M34 38l2 4" /></>,
    // pendant lamp: cord, shade, light
    lighting: <><path d="M24 4v12M14 28a10 10 0 0 1 20 0z" /><path d="M24 33v3M17 34l-2 3M31 34l2 3" /></>,
    // vase with a plant
    decor: <><path d="M17 26h14l-2 16H19z" /><path d="M24 26V12M24 18c-6 0-9-4-9-8 5 0 9 3 9 8M24 15c5 0 8-3 8-7-5 0-8 3-8 7" /></>,
    // garden umbrella over a small table
    outdoor: <><path d="M6 20a18 12 0 0 1 36 0z" /><path d="M24 20v22M16 34h16M18 34v8M30 34v8" /></>,
    // basic shapes: cube, cone, torus
    shapes: <>
        <path d="M4 24l8-4 8 4v9l-8 4-8-4zM4 24l8 4 8-4M12 28v9" />
        <path d="M30 6l-7 15a7 2.5 0 0 0 14 0z" />
        <ellipse cx="34" cy="36" rx="10" ry="6" /><ellipse cx="34" cy="35.5" rx="4" ry="2" />
    </>
};

const shapes = {
    box: <path d="M8 16l16-8 16 8v16l-16 8-16-8zM8 16l16 8 16-8M24 24v16" />,
    plane: <path d="M4 30l14-12h26L30 30z" />,
    capsule: <><rect x="15" y="5" width="18" height="38" rx="9" /><path d="M15 24a9 3 0 0 0 18 0" /></>,
    sphere: <><circle cx="24" cy="24" r="17" /><path d="M7 24a17 6 0 0 0 34 0" /></>,
    cylinder: <><ellipse cx="24" cy="11" rx="14" ry="5" /><path d="M10 11v26a14 5 0 0 0 28 0V11" /></>,
    circle: <ellipse cx="24" cy="26" rx="18" ry="9" />,
    donut: <><ellipse cx="24" cy="25" rx="19" ry="12" /><path d="M15 24a9 4 0 0 0 18 0M17 26.5a7 3.5 0 0 1 14 0" /></>,
    // trefoil knot: x = sin t + 2 sin 2t, y = cos t - 2 cos 2t
    knot: <path d="M24.0 19.4 26.9 19.6 29.7 20.2 32.3 21.3 34.6 22.6 36.5 24.2 37.9 26.1 38.9 28.0 39.3 29.9 39.2 31.8 38.5 33.4 37.4 34.8 35.9 35.8 34.0 36.4 31.9 36.5 29.6 36.2 27.2 35.4 24.9 34.1 22.7 32.3 20.8 30.2 19.2 27.8 17.9 25.2 17.0 22.4 16.6 19.7 16.6 17.0 17.1 14.6 18.0 12.4 19.1 10.6 20.6 9.3 22.3 8.5 24.0 8.2 25.7 8.5 27.4 9.3 28.9 10.6 30.0 12.4 30.9 14.6 31.4 17.0 31.4 19.7 31.0 22.4 30.1 25.2 28.8 27.8 27.2 30.2 25.3 32.3 23.1 34.1 20.8 35.4 18.4 36.2 16.1 36.5 14.0 36.4 12.1 35.8 10.6 34.8 9.5 33.4 8.8 31.8 8.7 29.9 9.1 28.0 10.1 26.1 11.5 24.2 13.4 22.6 15.7 21.3 18.3 20.2 21.1 19.6Z" />
};

export const ShapeIcon = ({ type, ...size }) => <Icon {...size}>{shapes[type]}</Icon>;

export default function CategoryIcon({ id, ...size }) {
    return <Icon {...size}>{paths[id]}</Icon>;
}

function Icon({ children, color, width, height }) {
    return (
        <svg className="catalog-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" color={color} width={width} height={height}>
            {children ?? <rect x="10" y="10" width="28" height="28" rx="2" />}
        </svg>
    );
}
