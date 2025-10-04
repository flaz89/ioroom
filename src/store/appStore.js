import { create } from "zustand";
import { createGridSlice } from "./slices/gridSlice";
import { createSettings } from "./slices/settingSlice";

// main store
export const useStore = create((set, get) => ({
    ...createGridSlice(set, get),
    ...createSettings(set, get)
}))