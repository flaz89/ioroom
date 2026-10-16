import { MATERIAL_KINDS, kindOf } from '../../../materials/grouping';
import { DEFAULT_VAT, formatEuro, priceBreakdown } from '../../../materials/pricing';

/*
* Material card (desktop): opened by holding the mouse on a ball of the materials panel
* (MaterialsPanel.jsx), next to the panel. Shows the color map LARGE, tiled 2×2 with the real size of one
* tile, so pattern and scale read at a glance; then kind, product code, net price €/m² + VAT + total,
* waste and the manufacturer link. Plain has no card.
* onPointerEnter / onPointerLeave: the panel keeps the card open while the pointer is on it (to click the link).
*/
export default function MaterialCard({ material, onPointerEnter, onPointerLeave }) {
    const kind = MATERIAL_KINDS.find((item) => item.id === kindOf(material))?.label;
    const size = String(material.tileSize).replace('.', ',');
    const hasPrice = material.price != null;
    const perSqm = hasPrice ? priceBreakdown(1, material.price, material.vatRate) : null;
    return (
        <div className="material-card" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
            <div className="material-card-preview" style={{ backgroundImage: `url(${material.maps.color})` }}>
                <span className="material-card-scale">{size} m × {size} m per tile</span>
            </div>
            <div className="material-card-body">
                <span className="material-card-name">{material.name}</span>
                <span className="material-card-meta">{kind}{material.code ? ` · ${material.code}` : ''}</span>
                {hasPrice ? (
                    <div className="material-card-price">
                        <span><b>{formatEuro(perSqm.net)}</b> /m² + VAT {material.vatRate ?? DEFAULT_VAT}%</span>
                        <span className="material-card-meta">{formatEuro(perSqm.total)} /m² VAT incl.{material.waste ? ` · waste ${String(material.waste).replace('.', ',')}%` : ''}</span>
                    </div>
                ) : (
                    <span className="material-card-meta">No price yet</span>
                )}
                {material.url && (
                    <a className="material-card-link" href={material.url} target="_blank" rel="noopener noreferrer">Manufacturer page ↗</a>
                )}
            </div>
        </div>
    );
}
