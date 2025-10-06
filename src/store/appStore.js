import { create } from "zustand";
import { createGridSlice } from "./slices/gridSlice";
import { createSettingsSlice } from "./slices/settingSlice";
import { createObjectsSlice } from "./slices/objectsSlice";

// main store
export const useStore = create((set, get) => ({
    ...createGridSlice(set, get),
    ...createSettingsSlice(set, get),
    ...createObjectsSlice(set, get)
}))