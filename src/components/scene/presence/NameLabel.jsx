import { drawPanel, useCanvasTexture } from '../xr-ui/useCanvasTexture';

const LABEL_PIXELS = [288, 72]; // canvas resolution
const noRaycast = () => {};

/*
* Name tag of a person in a shared room: their name on a dark pill outlined in their presence color.
* A sprite (always faces the viewer), drawn on top of the scene. `size` = [width, height] in parent units.
*/
export default function NameLabel({ name, color, size, ...props }) {
    const texture = useCanvasTexture(LABEL_PIXELS[0], LABEL_PIXELS[1], (ctx, w, h) => {
        drawPanel(ctx, w, h, 'rgba(16, 20, 48, 0.85)', color);
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(h * 0.42)}px "SUSE Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, w / 2, h / 2 + 2);
    }, [name, color]);

    return (
        <sprite scale={[size[0], size[1], 1]} raycast={noRaycast} renderOrder={10} {...props}>
            <spriteMaterial map={texture} depthTest={false} transparent toneMapped={false} />
        </sprite>
    );
}
