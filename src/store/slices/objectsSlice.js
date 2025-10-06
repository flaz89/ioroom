export const objectsList = [
  { type: 'box', name: 'Cube', geometryType: 'boxGeometry', defaultScale: [1, 1, 1], color: '#ffffff' },
  { type: 'sphere', name: 'Sphere', geometryType: 'sphereGeometry', defaultScale: [1, 1, 1], color: '#ffffff' },
  { type: 'cylinder', name: 'Cylinder', geometryType: 'cylinderGeometry', defaultScale: [1, 1, 1], color: '#ffffff' }
];


export const createObjectsSlice = (set, get) => ({
    objects: {
        instances: []
    },

    addObject: (type) => {
        const object = objectsList.find(item => item.type === type)
        if (!object) { console.warn(`Tipo "${type}" non trovato nel catalogo`); return; };

        const id = crypto.randomUUID();

        const newObject = {
            id: id,
            type: object.type,
            geometryType: object.geometryType,
            color: object.color,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: object.defaultScale
        }

        set((state) => ({
            objects: {
                ...state.objects,
                instances: [...state.objects.instances, newObject]
            }
        }));
    }

})