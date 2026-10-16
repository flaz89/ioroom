import { useMemo } from 'react';
import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { useStore } from '../../../store/appStore';
import { PLAIN_ID } from '../../../materials/library';
import { billOfQuantities } from '../../../materials/billOfQuantities';
import { formatEuro } from '../../../materials/pricing';
import { ROOM_SIZES, surfaceAreas, surfaceLabel } from '../../scene/level/room/roomLayout';
import './bill-panel.css';

const formatNumber = (value) => value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/*
* Bill of quantities ("computo metrico") toolbar button: a centered modal with the cost of the room
* surfaces, visible to everyone in the room (permissions later). One row per material in use (Plain is
* not billed): the faces it covers, area, waste, quantity to buy, net price €/m² and net amount; then
* the net total, VAT and total. Prices are those frozen in the project (materials/billOfQuantities.js);
* a material priced only in the current list is marked "list price". "Print" uses the browser's print
* dialog (also "Save as PDF"), printing only this panel (bill-panel.css).
*/
export default function BillPanel() {
    const isOpen = useStore((state) => state.openPanel === 'bill');
    const togglePanel = useStore((state) => state.togglePanel);
    const closePanel = useStore((state) => state.closePanel);
    const surfaces = useStore((state) => state.surfaces);
    const snapshots = useStore((state) => state.priceSnapshots);
    const library = useStore((state) => state.libraryMaterials);
    const areas = useMemo(() => surfaceAreas(ROOM_SIZES), []);
    const bill = useMemo(
        () => (isOpen ? billOfQuantities({ surfaces, areas, snapshots, library, plainId: PLAIN_ID }) : null),
        [isOpen, surfaces, areas, snapshots, library]
    );

    return (
        <div className="bill-control">
            <CircleButton svg={svg.bill} onClick={() => togglePanel('bill')} isActive={isOpen} title="Bill of quantities" />
            {isOpen && (
                <div className="bill-backdrop" onClick={closePanel}>
                    <div className="bill-panel" onClick={(event) => event.stopPropagation()}>
                        <div className="bill-header">
                            <span className="bill-title">Bill of quantities</span>
                            <div className="bill-actions">
                                <button onClick={() => window.print()} disabled={bill.rows.length === 0}>Print</button>
                                <button onClick={closePanel} aria-label="Close">×</button>
                            </div>
                        </div>

                        {bill.rows.length === 0 ? (
                            <span className="bill-empty">No materials applied yet: drag a material onto the floor or a wall.</span>
                        ) : (
                            <div className="bill-table-wrap">
                                <table className="bill-table">
                                    <thead>
                                        <tr>
                                            <th>Material</th>
                                            <th className="num">m²</th>
                                            <th className="num">Waste</th>
                                            <th className="num">Qty m²</th>
                                            <th className="num">€/m² net</th>
                                            <th className="num">Net</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bill.rows.map((row) => (
                                            <tr key={row.materialId}>
                                                <td>
                                                    <span className="bill-name">{row.name}</span>
                                                    {row.code && <span className="bill-meta"> · {row.code}</span>}
                                                    {row.url && <a className="bill-link" href={row.url} target="_blank" rel="noopener noreferrer"> ↗</a>}
                                                    <span className="bill-faces">{row.faces.map((face) => surfaceLabel(face.surfaceId)).join(', ')}</span>
                                                </td>
                                                <td className="num">{formatNumber(row.area)}</td>
                                                <td className="num">{row.waste ? `${row.waste}%` : '–'}</td>
                                                <td className="num">{formatNumber(row.quantity)}</td>
                                                <td className="num">
                                                    {row.price == null ? <span className="bill-meta">no price</span> : formatEuro(row.price)}
                                                    {row.price != null && !row.frozen && <span className="bill-faces">list price</span>}
                                                </td>
                                                <td className="num">{row.net == null ? '–' : formatEuro(row.net)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {bill.rows.length > 0 && (
                            <div className="bill-totals">
                                <span>Net total</span><b>{formatEuro(bill.totals.net)}</b>
                                <span>VAT</span><b>{formatEuro(bill.totals.vat)}</b>
                                <span className="bill-grand">Total (VAT incl.)</span><b className="bill-grand">{formatEuro(bill.totals.total)}</b>
                            </div>
                        )}
                        {bill.unpriced > 0 && (
                            <span className="bill-meta">{bill.unpriced} material{bill.unpriced > 1 ? 's' : ''} without a price: not in the totals.</span>
                        )}
                        <span className="bill-meta">Prices frozen when each material was first applied to this project. Areas of the room surfaces (doors and windows not subtracted yet).</span>
                    </div>
                </div>
            )}
        </div>
    );
}
