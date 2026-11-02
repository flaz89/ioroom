/*
* "Fixed" proposed when a model is uploaded (plan R9): fixed pieces cannot be moved in first-person VR.
* Kitchens and bathroom fixtures are fixed; storage with a side over FIXED_STORAGE_SIDE (wardrobes, big
* sideboards) too; everything else is movable. Only a proposal: the owner can change it in the modal.
* size: [w, h, d] meters.
*/
const FIXED_CATEGORIES = ['kitchens', 'bathroom'];
const FIXED_STORAGE_SIDE = 1.5;

export function fixedProposal(category, size) {
    if (FIXED_CATEGORIES.includes(category)) return true;
    return category === 'storage' && Math.max(...size) > FIXED_STORAGE_SIDE;
}
