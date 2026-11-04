import { useRef, useState } from 'react';
import { useStore } from '../../../store/appStore';
import { objectsList } from '../../../store/slices/objectsSlice';
import { useModelList } from '../../../models/catalog';
import { SHAPES, brandsOf, categoriesWith, modelsIn, searchModels, subtypesIn } from '../../../models/grouping';
import { deleteModel, modelFileUrl } from '../../../models/modelsApi';
import { dropPoint, spawnPoint } from '../../../models/spawnPoint';
import { variantTint } from '../../../models/variants';
import { activeLevel } from '../../../plan/planModel';
import { SYNC_HOST, isAdmin } from '../../../sync/roomSync';
import { viewGroundPoint } from '../../scene/level/viewGroundProbe';
import { setCursorGrabbing } from '../../scene/sceneCursor';
import { usePanelInViewport } from '../usePanelInViewport';
import ModelCreateModal from './ModelCreateModal';
import CategoryIcon, { ShapeIcon } from './categoryIcons';
import './catalog-menu.css';

const canManage = Boolean(SYNC_HOST) && isAdmin;
const DRAG_START_PX = 6; // a press moving less than this stays a click (pick the model)

/*
* "+" menu (plan U5, R1–R4): the furniture catalog in two levels.
* - Level 1: grid of the categories with furniture (models/grouping.js), each with its symbol
*   (categoryIcons.jsx) and count, Basic shapes always last.
* - Level 2: chips of the subtypes present, grid of the models (thumbnail, name, "Fixed" mark), back.
* - Search (name or variant code) over the whole catalog, within the active manufacturer.
* - Manufacturer filter: a list on the left on desktop; on phones a button switches to the manufacturers
*   screen and back (css). The active one stays as a chip with × until removed.
* - A click on a model shows its variants (first one picked) and "Add": the piece goes on the floor at the
*   center of the view, inside the plan (models/spawnPoint.js), selected; the menu closes.
* - DRAG a model or basic shape tile into the scene (mouse, pen, touch; starts after DRAG_START_PX): a full-size hologram
*   follows the pointer on the floor (store modelDrag, level/ModelDragGhost.jsx), the thumbnail follows it
*   where it cannot land (panels, walls, outside); releasing on the floor adds it there with the picked
*   variant (or the first), selected, and the menu closes. Basic shapes: same gesture, their symbol follows.
* - Basic shapes add the primitives as before (no variant).
* Catalog loading / failed (Retry) / empty results are shown in place of the grid.
* OWNER (admin token): "+" next to the search uploads a new piece (ModelCreateModal.jsx), "✎" on a model
* edits its card and variants (same modal), "×" deletes it from the catalog (second press confirms). Furniture
* already placed from a deleted model shows a placeholder box.
*/
export default function CatalogMenu({ onClose }) {
    const panelRef = useRef();
    usePanelInViewport(panelRef, true);
    const models = useModelList();
    const status = useStore((state) => state.libraryModelsStatus);
    const [category, setCategory] = useState(null);
    const [subtype, setSubtype] = useState(null);
    const [brand, setBrand] = useState(null);
    const [query, setQuery] = useState('');
    const [brandsOpen, setBrandsOpen] = useState(false); // phones: the manufacturers screen
    const [picked, setPicked] = useState(null); // { model, variantId }
    const brands = brandsOf(models);
    const searching = query.trim() !== '';

    // owner: the upload / edit modal ({ model } = edit, {} = new) and the delete waiting for its confirming press
    const [modal, setModal] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [deleteError, setDeleteError] = useState(null);
    const remove = async (model) => {
        if (confirmDelete !== model.id) return setConfirmDelete(model.id);
        setConfirmDelete(null);
        setDeleteError(null);
        try {
            await deleteModel(model.id);
            const { libraryModels, setLibraryModels } = useStore.getState();
            setLibraryModels(libraryModels.filter((item) => item.id !== model.id));
            if (picked?.model.id === model.id) setPicked(null);
        } catch (error) {
            setDeleteError(error.message);
        }
    };
    const manage = canManage ? { confirmDelete, onEdit: (model) => setModal({ model }), onDelete: remove } : null;

    const openCategory = (id) => { setCategory(id); setSubtype(null); setPicked(null); };
    const pickBrand = (name) => { setBrand(name); setBrandsOpen(false); setSubtype(null); setPicked(null); };
    const addShape = (type) => { useStore.getState().addObject(type); onClose(); };
    const addPicked = () => {
        const { plan, addModel } = useStore.getState();
        addModel(picked.model, picked.variantId, spawnPoint(activeLevel(plan), viewGroundPoint()));
        onClose();
    };

    // Drag of a model tile into the scene: window listeners from the press until the release
    const drag = useStore((state) => state.modelDrag);
    // piece: a model record, or { type } of a basic shape
    const startPress = (event, piece) => {
        if (event.button !== 0) return;
        const dragged = piece.type != null ? { type: piece.type }
            : { model: piece, variantId: picked?.model.id === piece.id ? picked.variantId : piece.variants[0]?.id };
        const startX = event.clientX, startY = event.clientY;
        let dragging = false;
        const move = (moved) => {
            if (!dragging && Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_START_PX) return;
            dragging = true;
            setCursorGrabbing('model-drag', true);
            const { plan, setModelDrag } = useStore.getState();
            const point = dropPoint(activeLevel(plan), viewGroundPoint(moved.clientX, moved.clientY));
            setModelDrag({ ...dragged, point, x: moved.clientX, y: moved.clientY });
        };
        const end = (ended) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            if (!dragging) return;
            setCursorGrabbing('model-drag', false);
            if (ended.type === 'pointerup') useStore.getState().dropModel();
            else useStore.getState().setModelDrag(null);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    };

    let body;
    if (brandsOpen) {
        body = <BrandList brands={brands} brand={brand} onPick={pickBrand} />;
    } else if (searching) {
        const results = searchModels(models, query, brand);
        body = results.length > 0
            ? <ModelGrid models={results} picked={picked} onPick={setPicked} onPress={startPress} manage={manage} />
            : <Empty text={brand ? `No results for "${query.trim()}" from ${brand}` : `No results for "${query.trim()}"`}
                actions={[brand && ['Clear manufacturer', () => setBrand(null)], ['Clear search', () => setQuery('')]]} />;
    } else if (category === SHAPES) {
        body = (
            <>
                <BackRow title="Basic shapes" onBack={() => openCategory(null)} />
                <div className="catalog-grid">
                    {objectsList.map((item) => (
                        <button key={item.type} className="catalog-tile is-shape" onClick={() => addShape(item.type)}
                            onPointerDown={(event) => startPress(event, { type: item.type })}>
                            <ShapeIcon type={item.type} />
                            <span className="catalog-tile-name">{item.name}</span>
                        </button>
                    ))}
                </div>
            </>
        );
    } else if (category != null) {
        const chips = subtypesIn(models, category, brand);
        const shown = modelsIn(models, { category, subtype, brand });
        const label = categoriesWith(models).find((item) => item.id === category)?.label ?? category;
        body = (
            <>
                <BackRow title={label} onBack={() => openCategory(null)} />
                {chips.length > 1 && (
                    <div className="catalog-chips" role="group" aria-label="Type">
                        {[{ id: null, label: 'All' }, ...chips].map((chip) => (
                            <button key={chip.id ?? 'all'} className={subtype === chip.id ? 'is-active' : ''} aria-pressed={subtype === chip.id}
                                onClick={() => { setSubtype(chip.id); setPicked(null); }}>{chip.label}</button>
                        ))}
                    </div>
                )}
                {shown.length > 0
                    ? <ModelGrid models={shown} picked={picked} onPick={setPicked} onPress={startPress} manage={manage} />
                    : <Empty text={`No ${label.toLowerCase()} from ${brand}`} actions={[['Clear manufacturer', () => setBrand(null)]]} />}
            </>
        );
    } else {
        const categories = categoriesWith(models, brand);
        body = (
            <>
                {status === 'loading' && <span className="catalog-note">Loading the catalog…</span>}
                {status === 'error' && (
                    <div className="catalog-note is-error" role="alert">
                        Catalog not available
                        <button onClick={() => useStore.getState().loadLibraryModels()}>Retry</button>
                    </div>
                )}
                {status === 'ready' && brand != null && categories.length === 1 && (
                    <Empty text={`No furniture from ${brand}`} actions={[['Clear manufacturer', () => setBrand(null)]]} />
                )}
                <div className="catalog-grid">
                    {categories.map((item) => {
                        const inCategory = item.id === SHAPES ? [] : modelsIn(models, { category: item.id, brand });
                        return (
                            <button key={item.id} className="catalog-tile" onClick={() => openCategory(item.id)}
                                aria-label={item.id === SHAPES ? item.label : `${item.label}, ${inCategory.length}`}>
                                <CategoryIcon id={item.id} />
                                <span className="catalog-tile-name">{item.label}</span>
                                {item.id !== SHAPES && <span className="catalog-tile-count">{inCategory.length}</span>}
                            </button>
                        );
                    })}
                </div>
            </>
        );
    }

    return (
        <>
        <div className="catalog-menu" ref={panelRef} role="dialog" aria-label="Add">
            {brands.length > 0 && (
                <aside className="catalog-brands" aria-label="Manufacturers">
                    <BrandList brands={brands} brand={brand} onPick={pickBrand} />
                </aside>
            )}
            <div className="catalog-main">
                <div className="catalog-top">
                    <input className="catalog-search" type="search" value={query} placeholder="Search name or code"
                        aria-label="Search the catalog" onChange={(event) => { setQuery(event.target.value); setPicked(null); }} />
                    {brands.length > 0 && (
                        <button className={brandsOpen ? 'catalog-brands-toggle is-active' : 'catalog-brands-toggle'}
                            aria-pressed={brandsOpen} onClick={() => setBrandsOpen(!brandsOpen)}>Brands</button>
                    )}
                    {canManage && (
                        <button className="catalog-new" onClick={() => setModal({})} title="New furniture" aria-label="New furniture">+</button>
                    )}
                </div>
                {deleteError && <span className="catalog-note is-error" role="alert">{deleteError}</span>}
                {brand != null && !brandsOpen && (
                    <span className="catalog-brand-chip">
                        {brand}
                        <button onClick={() => setBrand(null)} aria-label={`Remove the ${brand} filter`}>×</button>
                    </span>
                )}
                <div className="catalog-body">{body}</div>
                {picked != null && (
                    <div className="catalog-pick">
                        <span className="catalog-pick-name">{picked.model.name}</span>
                        <div className="catalog-variants" role="radiogroup" aria-label="Variant">
                            {picked.model.variants.map((variant) => (
                                <button key={variant.id} role="radio" aria-checked={picked.variantId === variant.id}
                                    className={picked.variantId === variant.id ? 'is-active' : ''}
                                    onClick={() => setPicked({ ...picked, variantId: variant.id })}>
                                    <span className="catalog-swatch" style={swatchStyle(variant)} aria-hidden="true" />
                                    {variant.name}
                                </button>
                            ))}
                        </div>
                        <button className="catalog-add" onClick={addPicked}>Add</button>
                    </div>
                )}
            </div>
        </div>
        {/* outside the panel (its transform would become the containing block of anything fixed): the dragged
            piece's thumbnail, where it cannot land */}
        {drag?.x != null && drag.point == null && (drag.type != null
            ? <span className="catalog-drag-ghost is-shape" style={{ left: drag.x, top: drag.y }}><ShapeIcon type={drag.type} /></span>
            : <img className="catalog-drag-ghost" src={modelFileUrl(drag.model.files.thumb)} alt="" style={{ left: drag.x, top: drag.y }} />
        )}
        {/* outside the panel: its transform would become the containing block of the fixed backdrop */}
        {modal != null && (
            <ModelCreateModal model={modal.model} onClose={() => setModal(null)}
                initialCategory={category != null && category !== SHAPES ? category : undefined} />
        )}
        </>
    );
}

// manage (owner): { confirmDelete, onEdit(model), onDelete(model) } -> ✎ and × on every tile
function ModelGrid({ models, picked, onPick, onPress, manage }) {
    return (
        <div className="catalog-grid">
            {models.map((model) => (
                <button key={model.id} className={picked?.model.id === model.id ? 'catalog-tile is-picked' : 'catalog-tile'}
                    aria-pressed={picked?.model.id === model.id}
                    aria-label={`${model.name}, ${model.brand}${model.fixed ? ', fixed' : ''}`}
                    onPointerDown={(event) => onPress(event, model)}
                    onDragStart={(event) => event.preventDefault()}
                    onClick={() => onPick({ model, variantId: model.variants[0]?.id })}>
                    <img className="catalog-thumb" src={modelFileUrl(model.files.thumb)} alt="" loading="lazy" />
                    <span className="catalog-tile-name">{model.name}</span>
                    {model.fixed && <span className="catalog-fixed" title="Fixed: it cannot be moved in first-person VR">Fixed</span>}
                    {manage && (<>
                        <span className="catalog-manage is-edit" role="button" tabIndex={0} title="Edit furniture" aria-label={`Edit ${model.name}`}
                            onClick={(event) => { event.stopPropagation(); manage.onEdit(model); }}
                            onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); manage.onEdit(model); } }}>✎</span>
                        <span className={manage.confirmDelete === model.id ? 'catalog-manage is-delete is-confirm' : 'catalog-manage is-delete'}
                            role="button" tabIndex={0}
                            title={manage.confirmDelete === model.id ? 'Press again to delete' : 'Delete furniture'}
                            aria-label={manage.confirmDelete === model.id ? `Press again to delete ${model.name}` : `Delete ${model.name}`}
                            onClick={(event) => { event.stopPropagation(); manage.onDelete(model); }}
                            onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); manage.onDelete(model); } }}>
                            {manage.confirmDelete === model.id ? '?' : '×'}
                        </span>
                    </>)}
                </button>
            ))}
        </div>
    );
}

function BrandList({ brands, brand, onPick }) {
    return (
        <div className="catalog-brand-list">
            {[null, ...brands].map((name) => (
                <button key={name ?? 'all'} className={brand === name ? 'is-active' : ''} aria-pressed={brand === name}
                    onClick={() => onPick(name)}>{name ?? 'All manufacturers'}</button>
            ))}
        </div>
    );
}

function BackRow({ title, onBack }) {
    return (
        <div className="catalog-back">
            <button onClick={onBack} aria-label="Back to the categories">‹</button>
            <span>{title}</span>
        </div>
    );
}

function Empty({ text, actions }) {
    return (
        <div className="catalog-note">
            {text}
            {actions.filter(Boolean).map(([label, onClick]) => <button key={label} onClick={onClick}>{label}</button>)}
        </div>
    );
}

// Variant swatch: its first tint, else the plain catalog color (texture variants show their name)
function swatchStyle(variant) {
    const tint = variantTint(variant);
    return tint ? { background: tint } : undefined;
}
