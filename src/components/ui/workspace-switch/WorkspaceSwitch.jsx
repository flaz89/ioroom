import { useStore } from '../../../store/appStore';
import { isAdmin } from '../../../sync/roomSync';
import './workspace-switch.css';
import { svg } from '../../../utils/svg-logos';

// Views of the builder (store builderView)
const BUILDER_VIEWS = [
    { id: '2d', label: '2D', title: 'Top view floor plan' },
    { id: '3d', label: '3D', title: 'Perspective view' }
];

// Views of the tour on a flat screen (store tourView)
const TOUR_VIEWS = [
    { id: 'orbit', icon: svg.orbitView, label: 'Orbit', title: 'Orbit around the environment' },
    { id: 'third', icon: svg.thirdPerson, label: 'Third person', title: 'Third person: WASD / arrows to walk, hold the left button and drag to look around' },
    { id: 'first', icon: svg.firstPerson, label: 'First person', title: 'First person: WASD / arrows to walk, hold the left button and drag to look around' }
];

const MODES = [
    { id: 'builder', label: 'Builder', title: 'Build the environment: floor plan, walls' },
    { id: 'designer', label: 'Designer', title: 'Furnish the environment: materials, furniture, notes' },
    { id: 'tour', label: 'Tour', title: 'Visit the environment: open doors, try the furniture, nothing moves' }
];

/*
* Builder | Designer | Tour segmented switch (store/slices/workspaceSlice.js). Guests get Designer | Tour (the
* builder is the admin's). Provisional position (bottom center, the top center is taken by the compass).
* In the builder, a second switch picks the view: 2D plan or 3D perspective.
*/
export default function WorkspaceSwitch() {
    const workspace = useStore((state) => state.workspace);
    const setWorkspace = useStore((state) => state.setWorkspace);
    const builderView = useStore((state) => state.builderView);
    const setBuilderView = useStore((state) => state.setBuilderView);
    const modes = isAdmin ? MODES : MODES.filter((mode) => mode.id !== 'builder');

    return (
        <>
            <Segmented label="Workspace mode" options={modes} value={workspace} onPick={setWorkspace} />
            {workspace === 'builder' && (
                <Segmented label="Builder view" options={BUILDER_VIEWS} value={builderView} onPick={setBuilderView} />
            )}
            {workspace === 'tour' && <TourViewSwitch className="tour-view-bottom" />}
        </>
    );
}

/*
* Orbit / third / first person icons of the tour (store tourView). Rendered twice: here in the bottom bar
* (desktop) and at the top center (phones, App.jsx); ui.css shows one of the two.
* Next to them: in first / third person the MINIMAP toggle (everyone, store minimapOpen); admin only and in the
* orbit view, the PLAYER START tool (store placingStart,
* scene/level/PlayerStart.jsx). It prepares the visit for everyone (saved in the plan), so guests never see it.
*/
export function TourViewSwitch({ className }) {
    const isTour = useStore((state) => state.workspace === 'tour');
    const tourView = useStore((state) => state.tourView);
    const setTourView = useStore((state) => state.setTourView);
    const isPlacingStart = useStore((state) => state.placingStart);
    const setPlacingStart = useStore((state) => state.setPlacingStart);
    const isMinimapOpen = useStore((state) => state.minimapOpen);
    const toggleMinimap = useStore((state) => state.toggleMinimap);
    if (!isTour) return null;
    return (
        <>
            <Segmented label="Tour view" options={TOUR_VIEWS} value={tourView} onPick={setTourView} className={className} />
            {isAdmin && tourView === 'orbit' && (
                <div className={`workspace-switch ${className}`}>
                    <button className={isPlacingStart ? 'has-icon is-active' : 'has-icon'} aria-pressed={isPlacingStart}
                        aria-label="Player start" onClick={() => setPlacingStart(!isPlacingStart)}
                        title={isPlacingStart ? 'Press on the floor where the visit starts, drag towards where it looks (Esc to cancel)' : 'Player start: where the visit starts'}>
                        {svg.playerStart}
                    </button>
                </div>
            )}
            {/* first / third person, same place: the minimap on / off (everyone) */}
            {tourView !== 'orbit' && (
                <div className={`workspace-switch ${className}`}>
                    <button className={isMinimapOpen ? 'has-icon is-active' : 'has-icon'} aria-pressed={isMinimapOpen}
                        aria-label="Map" title={isMinimapOpen ? 'Hide the map' : 'Show the map'} onClick={toggleMinimap}>
                        {svg.map}
                    </button>
                </div>
            )}
        </>
    );
}

// Glass pill of mutually exclusive buttons (radio group): the current one is orange
function Segmented({ label, options, value, onPick, className }) {
    return (
        <div className={className ? `workspace-switch ${className}` : 'workspace-switch'} role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <button
                    key={option.id}
                    role="radio"
                    aria-checked={value === option.id}
                    onClick={() => onPick(option.id)}
                    title={option.title}
                    aria-label={option.icon ? option.label : undefined}
                    className={[value === option.id ? 'is-active' : '', option.icon ? 'has-icon' : ''].join(' ').trim() || undefined}
                >{option.icon ?? option.label}</button>
            ))}
        </div>
    );
}
