import { create } from "zustand";
import { createGridSlice } from "./slices/gridSlice";
import { createSettingsSlice } from "./slices/settingSlice";
import { createObjectsSlice } from "./slices/objectsSlice";
import { createRendererSlice } from "./slices/rendererSlice";
import { createPerfSlice } from "./slices/perfSlice";
import { createViewSlice } from "./slices/viewSlice";
import { createSunSlice } from "./slices/sunSlice";
import { createPanelSlice } from "./slices/panelSlice";
import { createNotesSlice } from "./slices/notesSlice";
import { createMeasuresSlice } from "./slices/measuresSlice";
import { createPlanSlice } from "./slices/planSlice";
import { createSurfacesSlice } from "./slices/surfacesSlice";
import { createMaterialLibrarySlice } from "./slices/materialLibrarySlice";
import { createWorkspaceSlice } from "./slices/workspaceSlice";
import { createLookSlice } from "./slices/lookSlice";

// main store
export const useStore = create((set, get) => ({
    ...createGridSlice(set, get),
    ...createSettingsSlice(set, get),
    ...createObjectsSlice(set, get),
    ...createRendererSlice(set, get),
    ...createPerfSlice(set, get),
    ...createViewSlice(set, get),
    ...createSunSlice(set, get),
    ...createPanelSlice(set, get),
    ...createNotesSlice(set, get),
    ...createMeasuresSlice(set, get),
    ...createPlanSlice(set, get),
    ...createSurfacesSlice(set, get),
    ...createMaterialLibrarySlice(set, get),
    ...createWorkspaceSlice(set, get),
    ...createLookSlice(set, get)
}))
