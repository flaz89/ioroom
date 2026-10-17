import { useState } from "react";
import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";
import SharePanel from "./share-panel/SharePanel";
import RoomsPanel from "./rooms-panel/RoomsPanel";
import SunPanel from "./sun-panel/SunPanel";
import MaterialsPanel from "./materials-panel/MaterialsPanel";
import BillPanel from "./bill-panel/BillPanel";
import RoomUsers from "./room-users/RoomUsers";
import SnapControl from "./snap-control/SnapControl";
import { SYNC_HOST, isAdmin } from "../../sync/roomSync";

// Wall tool thickness side (store wallJustify), seen along the drawing direction
const JUSTIFY_STEPS = ['left', 'center', 'right'];
const JUSTIFY_LABELS = { left: 'L', center: 'C', right: 'R' };
const JUSTIFY_TITLES = {
    left: 'Draw walls: thickness on the left of the drawing direction',
    center: 'Draw walls: the line is the wall axis (half thickness each side)',
    right: 'Draw walls: thickness on the right of the drawing direction'
};

export default function LeftToolBar() {

    // Performance stats: stays open alongside the other panels (closes them only on phones, panelSlice.js)
    const isPerfVisible = useStore((state) => state.perfOpen);
    const togglePerf = useStore((state) => state.togglePerf);

    // Settings group (performance, environments, share): expanded/collapsed, per device and per page view
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const openPanel = useStore((state) => state.openPanel);
    const closePanel = useStore((state) => state.closePanel);
    // Collapsing the group unmounts its buttons: a panel opened from it (environments, share) is closed too,
    // otherwise openPanel would keep pointing at a panel that is no longer rendered
    const toggleSettings = () => {
        if (isSettingsOpen && (openPanel === 'rooms' || openPanel === 'share')) closePanel();
        setSettingsOpen(!isSettingsOpen);
    };

    // Environment tools (sun, materials, bill) belong to the designer mode (store/slices/workspaceSlice.js)
    const isDesigner = useStore((state) => state.workspace === 'designer');
    // Plan tools: builder mode, 2D view only (components/builder/PlanView2D.jsx)
    const isPlanView = useStore((state) => state.workspace === 'builder' && state.builderView === '2d');
    const planTool = useStore((state) => state.planTool);
    const setPlanTool = useStore((state) => state.setPlanTool);
    const wallJustify = useStore((state) => state.wallJustify);
    const setWallJustify = useStore((state) => state.setWallJustify);

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
