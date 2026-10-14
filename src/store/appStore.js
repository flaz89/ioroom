import { create } from "zustand";
import { createGridSlice } from "./slices/gridSlice";
import { createSettingsSlice } from "./slices/settingSlice";
import { createObjectsSlice } from "./slices/objectsSlice";
import { createRendererSlice } from "./slices/rendererSlice";
import { createPerfSlice } from "./slices/perfSlice";
import { createViewSlice } from "./slices/viewSlice";
import { createSunSlice } from "./slices/sunSlice";

// main store
export const useStore = create((set, get) => ({
    ...createGridSlice(set, get),
    ...createSettingsSlice(set, get),
    ...createObjectsSlice(set, get),
    ...createRendererSlice(set, get),
    ...createPerfSlice(set, get),
    ...createViewSlice(set, get),
    ...createSunSlice(set, get)
}))
