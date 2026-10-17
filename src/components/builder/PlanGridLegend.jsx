import { useStore } from '../../store/appStore';
import './plan-view.css';

// 0.1 -> "10 cm", 1 -> "1 m"
const formatMeters = (meters) => (meters < 1 ? `${Math.round(meters * 100)} cm` : `${meters} m`);

/*
* Grid scale of the 2D plan view (minor / major cell size), shown in the bottom bar (App.jsx) while the
* plan view is open. The steps are published by PlanView2D.jsx in the store (planGrid, workspaceSlice.js).
*/
export default function PlanGridLegend() {
    const grid = useStore((state) => state.planGrid);
    if (grid == null) return null;
    return <div className="plan-legend">{`grid ${formatMeters(grid.minor)} / ${formatMeters(grid.major)}`}</div>;
}
