import { useStore } from '../store/appStore';

/*
* Furniture catalog in React. Scenes store only model ids (objects' `modelId`): an unknown id (deleted, or
* the list not loaded yet) gives null and the scene shows a placeholder box.
*/
export const useModel = (id) => useStore((state) => state.libraryModels.find((model) => model.id === id) ?? null);

export const useModelList = () => useStore((state) => state.libraryModels);

/*
* Fixed pieces (plan R11, R12, KTD9): in first-person VR a piece whose model is `fixed` (kitchens, wardrobes)
* is selected, changes variant and is deleted, but never grabbed, moved or rotated; on desktop, phones and in
* tabletop it moves like any other. This says whether the object is such a piece; callers add the mode check.
*/
export function isFixedPiece(state, objectId) {
    const object = state.objects.instances.find((item) => item.id === objectId);
    return object?.type === 'model' && state.libraryModels.some((model) => model.id === object.modelId && model.fixed);
}
