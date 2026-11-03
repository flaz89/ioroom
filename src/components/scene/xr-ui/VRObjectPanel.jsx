import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useStore } from '../../../store/appStore';
import { useModel } from '../../../models/catalog';
import { variantOf, variantPriceKey, variantTint, variantsLabel } from '../../../models/variants';
import { DEFAULT_VAT, formatEuro, priceBreakdown } from '../../../materials/pricing';
import { isLockedByOther } from '../../../sync/presence';
import { openOutsideXR } from '../../../xr/xrStore';
import { drawPanel, useCanvasTexture } from './useCanvasTexture';
import VRButton from './VRButton';
import VRGrabBar from './VRGrabBar';
import { PointerFilterContext, acceptsPanelPointer } from './pointers';
import { VR_PANEL, placeInFrontOfUser } from './layout';

/*
* In-VR product card of the selected furniture piece (store openPanel 'object'; plan U6, R11; desktop
* counterpart: ui/object-card/ObjectCard.jsx). Opened by a ray resting 1.5 s on a piece (SingleObject.jsx
* CARD_DWELL_MS), in first person and in tabletop. Placed once in front of the user, grab bar below.
* Rows: manufacturer + name, X · info text (size, Fixed, variant label · variant under the pointer or the
* current one, code, price net + VAT: the price frozen in the project, else the list) · one dot per variant
* (press = setObjectVariant, synced and undoable) · Website (the manufacturer page, only when the model has a
* link: a new browser tab behind the scene, xrStore.js openOutsideXR; the button then says how to see it,
* "Open Meta Menu", and does nothing more until the card is opened again) · Close. Deleting stays the
* VR delete gesture (FistDeleteGesture.jsx). A piece held by another device: its variant does not change. Closes itself when the selection goes.
* Calibration knobs in meters: tune on the headset.
*/
const DISTANCE = 0.45;
const BELOW_EYES = 0.15;
const WIDTH = 0.3;
const PAD = 0.015;
const HEADER_H = 0.045;
const INFO_H = 0.085;
const DOT = 0.03;           // variant buttons (square)
const DOT_STEP = 0.036;
const DOTS_PER_ROW = 7;
const BUTTONS_H = 0.045;
const PIXELS_PER_METER = 3000;
const NEUTRAL = '#a8a196';  // dot of a variant without a color (the desktop neutral gradient's middle)

// Variant dot drawing for VRButton `icon`, one function per color: a stable icon keeps the button's canvas
// from being redrawn (and re-uploaded) on every render of the panel, e.g. at each hover
const dotIcons = new Map();
function dotIcon(color) {
    if (!dotIcons.has(color)) {
        dotIcons.set(color, (ctx, x, y, size) => {
            ctx.beginPath();
            ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.lineWidth = Math.max(2, size * 0.06);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.stroke();
        });
    }
    return dotIcons.get(color);
}

export default function VRObjectPanel() {
    const object = useStore((state) => state.objects.instances.find((obj) => obj.id === state.objects.selectedId && obj.type === 'model'));
    const closePanel = useStore((state) => state.closePanel);
    // selection gone (deselected, deleted, a primitive selected): close, so the teleport works again
    useEffect(() => { if (object == null) closePanel(); }, [object, closePanel]);
    if (object == null) return null;
    // keyed: placed again in front of the user for every piece
    return <ObjectCardPanel key={object.id} object={object} />;
}

function ObjectCardPanel({ object }) {
    const groupRef = useRef();
    const getThree = useThree((state) => state.get);
    const model = useModel(object.modelId);
    const snapshot = useStore((state) => state.priceSnapshots[variantPriceKey(object.modelId, object.variantId)]);
    const { closePanel, setObjectVariant } = useStore.getState(); // actions never change
    const [hovered, setHovered] = useState(null);
    const [siteOpened, setSiteOpened] = useState(false);

    useLayoutEffect(() => {
        placeInFrontOfUser(groupRef.current, getThree().camera, DISTANCE, BELOW_EYES);
    }, [getThree]);

    const variant = model ? variantOf(model, object.variantId) : null;
    const card = snapshot ?? variant;
    const amounts = card?.price != null ? priceBreakdown(1, card.price, card.vatRate) : null;
    const name = model?.name ?? snapshot?.name ?? 'Unknown piece';
    const lines = model ? [
        `${model.size.map((meters) => Math.round(meters * 100)).join(' × ')} cm${model.fixed ? ' · Fixed' : ''}`,
        `${variantsLabel(model)} · ${(hovered ?? variant)?.name ?? ''}`,
        variant?.code ? `Code ${variant.code}` : '',
        amounts ? `${formatEuro(amounts.net)} + VAT ${card.vatRate ?? DEFAULT_VAT}%${snapshot ? '' : ' · list price'}` : 'Price not available'
    ] : [snapshot?.variant ?? '', 'No longer in the catalog'];

    const variants = model?.variants ?? [];
    const dotRows = variants.length > 1 ? Math.ceil(variants.length / DOTS_PER_ROW) : 0;
    const height = HEADER_H + INFO_H + dotRows * DOT_STEP + BUTTONS_H + PAD;
    const top = height / 2;

    const background = useCanvasTexture(Math.round(WIDTH * 2000), Math.round(height * 2000), (ctx, w, h) => drawPanel(ctx, w, h), [height]);
    const header = useCanvasTexture(Math.round((WIDTH - 0.05) * PIXELS_PER_METER), Math.round(HEADER_H * PIXELS_PER_METER), (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.7;
        ctx.font = `500 ${Math.round(h * 0.26)}px "SUSE Mono", monospace`;
        ctx.fillText(model?.brand ?? '', 0, h * 0.28);
        ctx.globalAlpha = 1;
        ctx.font = `600 ${Math.round(h * 0.36)}px "SUSE Mono", monospace`;
        const fit = w / ctx.measureText(name).width;
        if (fit < 1) ctx.font = `600 ${Math.round(h * 0.36 * fit)}px "SUSE Mono", monospace`;
        ctx.fillText(name, 0, h * 0.68);
    }, [model?.brand, name]);
    const info = useCanvasTexture(Math.round((WIDTH - PAD * 2) * PIXELS_PER_METER), Math.round(INFO_H * PIXELS_PER_METER), (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        const row = h / 4;
        lines.forEach((line, index) => {
            ctx.globalAlpha = index === 1 ? 1 : 0.75; // the variant row stands out
            ctx.font = `${index === 1 ? 600 : 500} ${Math.round(row * 0.55)}px "SUSE Mono", monospace`;
            ctx.fillText(line, 0, row * (index + 0.5));
        });
    }, [lines.join('\n')]);

    const locked = isLockedByOther(object.id);
    const dotsTop = top - HEADER_H - INFO_H;
    const buttonsY = -top + PAD + BUTTONS_H / 2 - 0.005;

    return (
        <PointerFilterContext.Provider value={acceptsPanelPointer}>
        <group ref={groupRef}>
            <mesh position-z={-0.001} renderOrder={-1} userData={VR_PANEL} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                <planeGeometry args={[WIDTH, height]} />
                <meshBasicMaterial map={background} transparent toneMapped={false} />
            </mesh>
            <mesh position={[-0.025 / 2, top - HEADER_H / 2 - 0.004, 0.001]} raycast={() => null}>
                <planeGeometry args={[WIDTH - 0.05, HEADER_H]} />
                <meshBasicMaterial map={header} transparent depthWrite={false} toneMapped={false} />
            </mesh>
            <VRButton label="X" size={[0.026, 0.026]} onClick={closePanel} position={[WIDTH / 2 - PAD, top - HEADER_H / 2 - 0.004, 0.001]} />
            <mesh position={[0, top - HEADER_H - INFO_H / 2, 0.001]} raycast={() => null}>
                <planeGeometry args={[WIDTH - PAD * 2, INFO_H]} />
                <meshBasicMaterial map={info} transparent depthWrite={false} toneMapped={false} />
            </mesh>

            {/* variants: one dot each (its swatch color), the current one highlighted */}
            {dotRows > 0 && variants.map((item, index) => (
                <VRButton key={item.id} icon={dotIcon(variantTint(item) ?? NEUTRAL)} size={[DOT, DOT]} active={item.id === variant.id}
                    onClick={() => { if (!locked && item.id !== variant.id) setObjectVariant(object.id, item.id); }}
                    onPointerEnter={() => setHovered(item)} onPointerLeave={() => setHovered((current) => (current === item ? null : current))}
                    position={[-WIDTH / 2 + PAD + DOT / 2 + (index % DOTS_PER_ROW) * DOT_STEP, dotsTop - DOT_STEP / 2 - Math.floor(index / DOTS_PER_ROW) * DOT_STEP, 0.001]} />
            ))}

            {model?.url && (
                // one tab per card opening: once pressed it only says where the page is (no 10 tabs from 10 presses)
                <VRButton label={siteOpened ? 'Open Meta Menu' : 'Website'} size={[siteOpened ? 0.15 : 0.09, 0.032]} active={siteOpened}
                    onClick={() => { if (siteOpened) return; openOutsideXR(model.url); setSiteOpened(true); }}
                    position={[-WIDTH / 2 + PAD + (siteOpened ? 0.075 : 0.045), buttonsY, 0.001]} />
            )}
            <VRButton label="Close" size={[0.09, 0.032]} onClick={closePanel} position={[WIDTH / 2 - PAD - 0.045, buttonsY, 0.001]} />
            <VRGrabBar targetRef={groupRef} y={-height / 2 - 0.022} />
        </group>
        </PointerFilterContext.Provider>
    );
}
