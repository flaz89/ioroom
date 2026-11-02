import { useStore } from '../store/appStore';

/*
* Furniture catalog in React. Scenes store only model ids (objects' `modelId`): an unknown id (deleted, or
* the list not loaded yet) gives null and the scene shows a placeholder box.
*/
export const useModel = (id) => useStore((state) => state.libraryModels.find((model) => model.id === id) ?? null);

export const useModelList = () => useStore((state) => state.libraryModels);
