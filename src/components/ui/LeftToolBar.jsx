import { useState } from "react";
import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";
import SharePanel from "./share-panel/SharePanel";
import RoomsPanel from "./rooms-panel/RoomsPanel";
import RenderPanel from "./render-panel/RenderPanel";
import SunPanel from "./sun-panel/SunPanel";
import MaterialsPanel from "./materials-panel/MaterialsPanel";
import BillPanel from "./bill-panel/BillPanel";
import RoomUsers from "./room-users/RoomUsers";
import SnapControl from "./snap-control/SnapControl";
import { SYNC_HOST, isAdmin } from "../../sync/roomSync";
import UnderlayPanel from "../builder/UnderlayPanel";
import { activeLevel } from "../../plan/planModel";

// Wall tool thickness side (store wallJustify), seen along the drawing direction
const JUSTIFY_STEPS = ['left', 'center', 'right'];
const JUSTIFY_LABELS = { left: 'L', center: 'C', right: 'R' };
const JUSTIFY_TITLES = {
    left: 'Draw walls: thickness on the left of the drawing direction',
    center: 'Draw walls: the line is the wall axis (half thickness each side)',
    right: 'Draw walls: thickness on the right of the drawing direction'
};

// Door / window tool (store openingType)
const OPENING_STEPS = ['door', 'window'];
const OPENING_LABELS = { door: 'D', window: 'W' };
const OPENING_TITLES = {
    door: 'Doors: click in a gap between two walls, or on a wall between the drawing\'s jambs',
    window: 'Windows: click on a wall between the drawing\'s jambs, or in a gap between two walls'
};

/*
* Ceiling button (same hover pattern as SnapControl): hover reveals a round button that shows / hides the
* ceilings in 3D on this device (store ceilingVisible). onClick / isActive / title: the button's own action
* (2D plan: the ceiling tool); without onClick (3D views) the button itself toggles the visibility.
*/
function CeilingControl({ onClick, isActive, title }) {
    const [isOpen, setIsOpen] = useState(false);
    const isVisible = useStore((state) => state.ceilingVisible);
    const setCeilingVisible = useStore((state) => state.setCeilingVisible);
    const toggle = () => setCeilingVisible(!isVisible);
    const visibilityTitle = isVisible ? 'Ceilings shown in 3D: click to hide' : 'Ceilings hidden in 3D: click to show';
    return (
        <div className="snap-control" onMouseEnter={() => setIsOpen(true)} onMouseLeave={() => setIsOpen(false)}>
            <CircleButton svg={svg.ceiling} onClick={onClick ?? toggle} isActive={onClick ? isActive : isVisible} title={onClick ? title : visibilityTitle} />
            {isOpen && (
                <div className="snap-steps is-right">
                    <button className={`snap-step${isVisible ? ' is-active' : ''}`} onClick={toggle} title={visibilityTitle}>
                        {isVisible ? svg.eye : svg.eyeOff}
                    </button>
                </div>
            )}
        </div>
    );
}

export default function LeftToolBar() {

    // Performance stats: stays open alongside the other panels (closes them only on phones, panelSlice.js)
    const isPerfVisible = useStore((state) => state.perfOpen);
    const togglePerf = useStore((state) => state.togglePerf);
    const isWireframe = useStore((state) => state.wireframe);
    const toggleWireframe = useStore((state) => state.toggleWireframe);

    // Settings group (performance, rendering, environments, share): expanded/collapsed, per device and per page view
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const openPanel = useStore((state) => state.openPanel);
    const closePanel = useStore((state) => state.closePanel);
    // Collapsing the group unmounts its buttons: a panel opened from it (environments, share) is closed too,
    // otherwise openPanel would keep pointing at a panel that is no longer rendered
    const toggleSettings = () => {
        if (isSettingsOpen && (openPanel === 'rooms' || openPanel === 'share' || openPanel === 'render')) closePanel();
        setSettingsOpen(!isSettingsOpen);
    };

    // Environment tools (sun, materials, bill) belong to the designer mode (store/slices/workspaceSlice.js)
    const isDesigner = useStore((state) => state.workspace === 'designer');
    // Plan tools: builder mode, 2D view only (components/builder/PlanView2D.jsx)
    const isPlanView = useStore((state) => state.workspace === 'builder' && state.builderView === '2d');
    const isBuilder = useStore((state) => state.workspace === 'builder');
    const planTool = useStore((state) => state.planTool);
    const setPlanTool = useStore((state) => state.setPlanTool);
    const wallJustify = useStore((state) => state.wallJustify);
    const setWallJustify = useStore((state) => state.setWallJustify);
    const openingType = useStore((state) => state.openingType);
    const setOpeningType = useStore((state) => state.setOpeningType);
    // assisted tracing needs the drawing's lines: a DXF underlay (later also vector PDFs, tappa 4c)
    const hasVectorUnderlay = useStore((state) => activeLevel(state.plan).underlay?.kind === 'dxf');
    const hasCeilings = useStore((state) => (activeLevel(state.plan).ceilings ?? []).length > 0);

    // svg logos
    const { settingsMenu, performance } = svg;

    return(
    <>
        <div className="left-toolbar">
            {/* top: people in the shared room (wrapper always rendered: keeps the settings at the bottom) */}
            <div><RoomUsers /></div>

            {/* bottom: the environment tools, then the settings group (last, anchored to the bottom edge) */}
            <div className="left-tools">
                {/* environment tools: designer mode only */}
                {/* plan tools (builder, 2D): draw walls; hover reveals the thickness side (Left / Center / Right) */}
                {isPlanView && <div className="scene-settings">
                    <SnapControl
                        icon={svg.wall}
                        label="Draw walls"
                        enabled={planTool === 'wall'}
                        step={wallJustify}
                        steps={JUSTIFY_STEPS}
                        labels={JUSTIFY_LABELS}
                        titles={JUSTIFY_TITLES}
                        side="right"
                        onToggle={() => setPlanTool(planTool === 'wall' ? 'select' : 'wall')}
                        onPick={(justify) => { setWallJustify(justify); setPlanTool('wall'); }}
                    />
                    {/* assisted walls: point at a wall face of the drawing (plan/traceWall.js) */}
                    {hasVectorUnderlay && <CircleButton svg={svg.trace} isActive={planTool === 'trace'} title="Trace walls on the drawing"
                        onClick={() => setPlanTool(planTool === 'trace' ? 'select' : 'trace')} />}
                    {/* doors / windows on the plan's walls (plan/placeOpening.js); hover picks door or window */}
                    <SnapControl
                        icon={svg.opening}
                        label="Doors and windows"
                        enabled={planTool === 'opening'}
                        step={openingType}
                        steps={OPENING_STEPS}
                        labels={OPENING_LABELS}
                        titles={OPENING_TITLES}
                        side="right"
                        onToggle={() => setPlanTool(planTool === 'opening' ? 'select' : 'opening')}
                        onPick={(type) => { setOpeningType(type); setPlanTool('opening'); }}
                    />
                    {/* draw floors (polygons snapped to the wall faces, PlanView2D.jsx) */}
                    <CircleButton svg={svg.floor} isActive={planTool === 'floor'} title="Draw floors"
                        onClick={() => setPlanTool(planTool === 'floor' ? 'select' : 'floor')} />
                    {/* draw ceilings (same tool as the floors, planModel level.ceilings); hover: show / hide in 3D */}
                    <CeilingControl onClick={() => setPlanTool(planTool === 'ceiling' ? 'select' : 'ceiling')} isActive={planTool === 'ceiling'} title="Draw ceilings" />
                </div>}

                {/* floor plan underlay (builder, 2D and 3D views, owner only): uploaded in a room, kept in the
                    browser in local mode (UnderlayPanel.jsx) */}
                {isBuilder && isAdmin && <div className="scene-settings">
                    <UnderlayPanel />
                </div>}

                {/* 3D views (builder 3D, designer) with drawn ceilings: the button only shows / hides them */}
                {!isPlanView && hasCeilings && <div className="scene-settings">
                    <CeilingControl />
                </div>}

                {isDesigner && <div className="scene-settings">
                    {/* not last: its panel is centered on the button and needs room below it */}
                    <SunPanel />
                    {/* room surface materials (floor, walls) */}
                    <MaterialsPanel />
                    {/* bill of quantities of the materials in use (everyone, for now) */}
                    <BillPanel />
                </div>}

                {/* settings group, in every mode: the gear expands it upwards (it sits at the bottom edge) */}
                <div className="scene-settings">
                    {isSettingsOpen && (
                        <>
                            <CircleButton svg={performance} onClick={togglePerf} isActive={isPerfVisible} title={"Performance"}/>
                            <CircleButton text="WF" onClick={toggleWireframe} isActive={isWireframe} title={"Wireframe"}/>
                            {/* render effects on / off, per device (everyone: it only changes this device's view) */}
                            <RenderPanel />
                            {/* shared rooms and sharing: owner only for now (guests must not spread new rooms) */}
                            {SYNC_HOST && isAdmin && <RoomsPanel />}
                            {SYNC_HOST && isAdmin && <SharePanel />}
                        </>
                    )}
                    <CircleButton svg={settingsMenu} onClick={toggleSettings} isActive={isSettingsOpen} title={"Settings"}/>
                </div>
            </div>
            
        </div>
    </>
    );
}
