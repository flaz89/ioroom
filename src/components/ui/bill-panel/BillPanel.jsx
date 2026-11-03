import { useMemo, useRef } from 'react';
import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { useStore } from '../../../store/appStore';
import { PLAIN_ID } from '../../../materials/library';
import { billOfQuantities, furnitureBill, sumTotals } from '../../../materials/billOfQuantities';
import { formatEuro } from '../../../materials/pricing';
import { surfaceAreas, surfaceLabel } from '../../scene/level/room/roomLayout';
import { activeLevel } from '../../../plan/planModel';
import './bill-panel.css';

const formatNumber = (value) => value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/*
* Bill of quantities ("computo metrico") toolbar button: a centered modal with the cost of the room
* surfaces and furniture, visible to everyone in the room (permissions later). Materials: one row per
* material in use (Plain is not billed): the faces it covers, area, waste, quantity to buy, net price €/m²
* and net amount. Furniture: one row per catalog model + variant (primitives are not billed): pieces, net
* price per piece and net amount. Then the net total, VAT and total of both. Prices are those frozen in the project (materials/billOfQuantities.js);
* a material priced only in the current list is marked "list price". "Print" uses the browser's print
* dialog (also "Save as PDF"): see printBill below.
*/

/*
* Prints the bill on its own page: the table and the totals (not the notes, marked .bill-note) are copied
* into a hidden iframe with a light print layout (A4, dark text on white), then the browser's print
* dialog opens on it. Independent of the app's layout (canvas, toolbars, modal sizes on phones).
*/
const PRINT_CSS = `
    @page { size: A4; margin: 16mm; }
    body { margin: 0; font: 11pt/1.4 "SUSE Mono", ui-monospace, monospace; color: #111; }
    h1 { font-size: 15pt; margin: 0 0 4mm; }
    .bill-date { color: #666; margin-bottom: 6mm; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 2mm; text-align: left; vertical-align: top; border-bottom: 1px solid #ccc; }
    th { font-weight: 500; color: #555; white-space: nowrap; }
    .num { text-align: right; white-space: nowrap; }
    .bill-name { font-weight: 600; }
    .bill-faces { display: block; font-size: 9pt; color: #666; }
    .bill-meta { color: #666; }
    .bill-link { display: none; } /* a link can't be clicked on paper */
    .bill-totals { display: grid; grid-template-columns: auto auto; gap: 1.5mm 8mm; width: max-content; margin: 6mm 0 0 auto; text-align: right; }
    .bill-grand { font-size: 13pt; font-weight: 700; }
    .bill-section { color: #111; font-weight: 700; background: linear-gradient(90deg, #ffd29a, transparent); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
`;
function printBill(source) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position: fixed; width: 0; height: 0; border: 0; visibility: hidden;';
    document.body.appendChild(frame);
    const content = source.cloneNode(true);
    content.querySelectorAll('.bill-note').forEach((note) => note.remove());
    const date = new Date().toLocaleDateString(undefined, { dateStyle: 'long' });
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Bill of quantities</title><style>${PRINT_CSS}</style></head>`
        + `<body><h1>Bill of quantities</h1><div class="bill-date">${date}</div>${content.innerHTML}</body></html>`);
    doc.close();
    frame.contentWindow.focus();
    frame.contentWindow.print(); // blocking in most browsers; removed after, with a margin for those that are not
    setTimeout(() => frame.remove(), 1000);
}
export default function BillPanel() {
    const isOpen = useStore((state) => state.openPanel === 'bill');
    const togglePanel = useStore((state) => state.togglePanel);
    const closePanel = useStore((state) => state.closePanel);
    const surfaces = useStore((state) => state.surfaces);
    const snapshots = useStore((state) => state.priceSnapshots);
    const library = useStore((state) => state.libraryMaterials);
    const instances = useStore((state) => state.objects.instances);
    const models = useStore((state) => state.libraryModels);
    const level = useStore((state) => activeLevel(state.plan));
    const areas = useMemo(() => surfaceAreas(level), [level]);
    const printableRef = useRef(); // table + totals (+ notes, left out of the print)
    const bill = useMemo(
        () => (isOpen ? billOfQuantities({ surfaces, areas, snapshots, library, plainId: PLAIN_ID }) : null),
        [isOpen, surfaces, areas, snapshots, library]
    );
    const furniture = useMemo(
        () => (isOpen ? furnitureBill({ instances, snapshots, models }) : null),
        [isOpen, instances, snapshots, models]
    );
    const empty = !bill || (bill.rows.length === 0 && furniture.rows.length === 0);
    const totals = bill && sumTotals([bill.totals, furniture.totals]);
    const unpriced = bill ? bill.unpriced + furniture.unpriced : 0;

    return (
        <div className="bill-control">
            <CircleButton svg={svg.bill} onClick={() => togglePanel('bill')} isActive={isOpen} title="Bill of quantities" />
            {isOpen && (
                <div className="bill-backdrop" onClick={closePanel}>
                    <div className="bill-panel" onClick={(event) => event.stopPropagation()}>
                        <div className="bill-header">
                            <span className="bill-title">Bill of quantities</span>
                            <div className="bill-actions">
                                <button onClick={() => printBill(printableRef.current)} disabled={empty}>Print</button>
                                <button onClick={closePanel} aria-label="Close">×</button>
                            </div>
                        </div>

                        <div className="bill-printable" ref={printableRef}>
                        {empty && (
                            <span className="bill-empty">Nothing to bill yet: drag a material onto the floor or a wall, or add furniture from "+".</span>
                        )}
                        {bill.rows.length > 0 && (
                            <div className="bill-table-wrap">
                                <table className="bill-table">
                                    <thead>
                                        <tr>
                                            <th className="bill-section">Materials</th>
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
                                                    <span className="bill-faces">{row.faces.map((face) => surfaceLabel(face.surfaceId, level)).join(', ')}</span>
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

                        {furniture.rows.length > 0 && (
                            <div className="bill-table-wrap">
                                <table className="bill-table">
                                    <thead>
                                        <tr>
                                            <th className="bill-section">Furniture</th>
                                            <th className="num">Pieces</th>
                                            <th className="num">€/piece net</th>
                                            <th className="num">Net</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {furniture.rows.map((row) => (
                                            <tr key={row.key}>
                                                <td>
                                                    <span className="bill-name">{row.name}</span>
                                                    {row.variant && <span className="bill-meta"> · {row.variant}</span>}
                                                    {row.url && <a className="bill-link" href={row.url} target="_blank" rel="noopener noreferrer"> ↗</a>}
                                                    {(row.brand || row.code) && <span className="bill-faces">{[row.brand, row.code].filter(Boolean).join(' · ')}</span>}
                                                </td>
                                                <td className="num">{row.quantity}</td>
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

                        {!empty && (
                            <div className="bill-totals">
                                <span>Net total</span><b>{formatEuro(totals.net)}</b>
                                <span>VAT</span><b>{formatEuro(totals.vat)}</b>
                                <span className="bill-grand">Total (VAT incl.)</span><b className="bill-grand">{formatEuro(totals.total)}</b>
                            </div>
                        )}
                        {unpriced > 0 && (
                            <span className="bill-meta bill-note">{unpriced} item{unpriced > 1 ? 's' : ''} without a price: not in the totals.</span>
                        )}
                        <span className="bill-meta bill-note">Prices frozen when each material or furniture variant was first used in this project. Areas of the room surfaces (doors and windows not subtracted yet).</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
