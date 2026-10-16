import { useEffect, useState } from 'react';
import { ImageBitmapLoader, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { MATERIAL_KINDS, kindOf } from '../../../materials/grouping';
import { DEFAULT_VAT, formatEuro, priceBreakdown } from '../../../materials/pricing';
import { drawPanel, useCanvasTexture } from './useCanvasTexture';

/*
* VR material card (VRMaterialsPanel.jsx: a ray resting on a ball opens it beside the panel), like the
* desktop card (ui/materials-panel/MaterialCard.jsx): the color map LARGE, tiled 2×2, then name, kind,
* code and net price €/m² + VAT. Not interactive (rays pass through it). Placed by the parent.
* The texture is loaded on its own (not drei's cached one, whose tiling belongs to the room surfaces),
* decoded off the main thread, and disposed when the card closes: one 1K texture at a time.
*/
export const CARD_WIDTH = 0.24;      // meters
const INFO_HEIGHT = 0.07;
const PIXELS_PER_METER = 4000;
const noRaycast = () => null;

/*
* The color map as a texture, decoded OFF the main thread (ImageBitmapLoader: createImageBitmap) so
* opening / switching the card does not freeze a frame; only the GPU upload remains. ImageBitmaps ignore
* texture.flipY, so the bitmap is flipped while decoding.
*/
const bitmapLoader = new ImageBitmapLoader().setOptions({ imageOrientation: 'flipY' });
bitmapLoader.setCrossOrigin('anonymous');

function useColorMap(url) {
    const [texture, setTexture] = useState(null);
    useEffect(() => {
        let alive = true;
        let loaded = null;
        bitmapLoader.load(url, (bitmap) => {
            if (!alive) { bitmap.close(); return; }
            loaded = new Texture(bitmap);
            loaded.colorSpace = SRGBColorSpace;
            loaded.wrapS = loaded.wrapT = RepeatWrapping;
            loaded.repeat.set(2, 2);
            loaded.needsUpdate = true;
            setTexture(loaded);
        });
        return () => {
            alive = false;
            if (loaded) {
                loaded.dispose();
                loaded.image.close();
            }
            setTexture(null);
        };
    }, [url]);
    return texture;
}

export default function VRMaterialCard({ material, ...groupProps }) {
    const map = useColorMap(material.maps.color);
    const info = useCanvasTexture(Math.round(CARD_WIDTH * PIXELS_PER_METER), Math.round(INFO_HEIGHT * PIXELS_PER_METER), (ctx, w, h) => {
        drawPanel(ctx, w, h);
        const kind = MATERIAL_KINDS.find((item) => item.id === kindOf(material))?.label;
        const line = (text, y, size, weight = 400, alpha = 1) => {
            ctx.globalAlpha = alpha;
            ctx.font = `${weight} ${Math.round(h * size)}px "SUSE Mono", monospace`;
            ctx.fillText(text, w * 0.06, h * y, w * 0.88);
        };
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        line(material.name, 0.24, 0.2, 600);
        line(`${kind}${material.code ? ` · ${material.code}` : ''}`, 0.47, 0.14, 400, 0.7);
        if (material.price != null) {
            const perSqm = priceBreakdown(1, material.price, material.vatRate);
            line(`${formatEuro(perSqm.net)} /m² + VAT ${material.vatRate ?? DEFAULT_VAT}%`, 0.7, 0.15, 600);
            line(`${formatEuro(perSqm.total)} /m² VAT incl.`, 0.87, 0.12, 400, 0.7);
        } else {
            line('No price yet', 0.72, 0.14, 400, 0.7);
        }
        ctx.globalAlpha = 1;
    }, [material]);

    return (
        <group {...groupProps}>
            {/* origin = top center of the card */}
            <mesh position={[0, -CARD_WIDTH / 2, 0]} raycast={noRaycast}>
                <planeGeometry args={[CARD_WIDTH, CARD_WIDTH]} />
                <meshBasicMaterial map={map} color={map ? '#ffffff' : '#202850'} toneMapped={false} />
            </mesh>
            <mesh position={[0, -CARD_WIDTH - 0.006 - INFO_HEIGHT / 2, 0]} raycast={noRaycast}>
                <planeGeometry args={[CARD_WIDTH, INFO_HEIGHT]} />
                <meshBasicMaterial map={info} transparent toneMapped={false} />
            </mesh>
        </group>
    );
}
