import { create } from "zustand";
import { createGridSlice } from "./slices/gridSlice";

// main store
export const useStore = create((set, get) => ({
    ...createGridSlice(set, get)
}))