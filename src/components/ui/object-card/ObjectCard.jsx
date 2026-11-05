import './object-card.css';
import { useState } from 'react';
import { useStore } from '../../../store/appStore';
import { useModel } from '../../../models/catalog';
import { modelFileUrl } from '../../../models/modelsApi';
import { variantOf, variantPriceKey, variantTint, variantsLabel } from '../../../models/variants';
import { DEFAULT_VAT, formatEuro, priceBreakdown } from '../../../materials/pricing';
import { isLockedByOther } from '../../../sync/presence';

/*
* Product card of the selected furniture piece (plan U8), Designer only: manufacturer, name, size, "Fixed",
* variants, code, price, link. Variants = what they change ("Leather", models/variants.js variantsLabel)
* followed by one colored dot each; the name of the variant under the pointer (else the current one) is
* shown next to the label; click = setObjectVariant (synced, undoable like any object change).
* Bound to the selection, outside the one-panel rule (panelSlice.js), under the compass (.top-center in
* ui.css): a button with the piece's name, a click expands / collapses the card (kept between selections).
* Price = the current catalog. A model deleted from the catalog shows only what its snapshot remembers
* (priceSnapshots, models/variants.js).
*/
export default function ObjectCard() {
    const object = useStore((state) => state.objects.instances.find((obj) => obj.id === state.objects.selectedId && obj.type === 'model'));
    const hidden = useStore((state) => state.workspace !== 'designer');
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState(null); // variant under the pointer
    const model = useModel(object?.modelId);
    const snapshot = useStore((state) => object ? state.priceSnapshots[variantPriceKey(object.modelId, object.variantId)] : null);
    const setObjectVariant = useStore((state) => state.setObjectVariant);
    if (!object || hidden) return null;

    const name = model?.name ?? snapshot?.name ?? 'Unknown piece';
    const toggle = (
        <button className="object-card-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {name}<span className="object-card-chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
    );
    if (!open) return <div className="object-card">{toggle}</div>;

    if (!model) {
        return (
            <div className="object-card is-open">
                {toggle}
                <div className="object-card-body">
                    <span className="object-card-meta">{snapshot?.variant ? `${snapshot.variant} · ` : ''}No longer in the catalog</span>
                </div>
            </div>
        );
    }

    const variant = variantOf(model, object.variantId);
    const amounts = variant.price != null ? priceBreakdown(1, variant.price, variant.vatRate) : null;
    const locked = isLockedByOther(object.id);
    return (
        <div className="object-card is-open">
            {toggle}
            <img className="object-card-thumb" src={modelFileUrl(model.files.thumb)} alt="" />
            <div className="object-card-body">
                <span className="object-card-meta">{model.brand}</span>
                <span className="object-card-meta">
                    {model.size.map((meters) => Math.round(meters * 100)).join(' × ')} cm{model.fixed ? ' · Fixed' : ''}
                </span>
                <span className="object-card-variant-label">{variantsLabel(model)}</span>
                {/* own line, never wraps: a long name must not move the dots below */}
                <span className="object-card-meta object-card-variant-name" title={(hovered ?? variant).name}>{(hovered ?? variant).name}</span>
                {model.variants.length > 0 && (
                    <div className="object-card-variants" role="radiogroup" aria-label={variantsLabel(model)} onPointerLeave={() => setHovered(null)}>
                        {model.variants.map((item) => (
                            <button key={item.id} role="radio" aria-checked={item.id === variant.id} aria-label={item.name}
                                className={item.id === variant.id ? 'is-active' : ''} disabled={locked}
                                style={variantTint(item) ? { background: variantTint(item) } : undefined}
                                onPointerEnter={() => setHovered(item)}
                                onClick={() => item.id !== variant.id && setObjectVariant(object.id, item.id)} />
                        ))}
                    </div>
                )}
                {variant.code && <span className="object-card-meta">Code {variant.code}</span>}
                {amounts ? (
                    <div className="object-card-price">
                        <span><b>{formatEuro(amounts.net)}</b> + VAT {variant.vatRate ?? DEFAULT_VAT}%</span>
                        <span className="object-card-meta">{formatEuro(amounts.total)} VAT incl.</span>
                    </div>
                ) : (
                    <span className="object-card-meta">Price not available</span>
                )}
                {model.url && <a className="object-card-link" href={model.url} target="_blank" rel="noopener noreferrer">Manufacturer page ↗</a>}
            </div>
        </div>
    );
}
