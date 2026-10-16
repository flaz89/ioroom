/*
* Registry of the mounted object meshes: object id -> its mesh (SingleObject.jsx registers / unregisters).
* For whatever must follow an object's LIVE position (drags included) without being its child, e.g. the
* ends of a ruler measure taken on an object (scene/measure/Measures.jsx).
*/
export const objectMeshes = new Map();
