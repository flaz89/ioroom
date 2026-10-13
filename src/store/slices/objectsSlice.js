
export const objectsList = [
  { type: 'box', name: 'Cube', geometryType: 'boxGeometry', defaultScale: [1, 1, 1], color: '#ffffff' },
  { type: 'plane', name: 'Plane', geometryType: 'planeGeometry', defaultScale: [1, 1, 1], color: '#ffffff'},
  { type: 'capsule', name: 'Capsule', geometryType: 'capsuleGeometry', defaultScale: [.34, .34, .34], color: '#ffffff' },
  { type: 'sphere', name: 'Sphere', geometryType: 'sphereGeometry', defaultScale: [.5, .5, .5], color: '#ffffff' },
  { type: 'cylinder', name: 'Cylinder', geometryType: 'cylinderGeometry', defaultScale: [.5, 1, .5], color: '#ffffff' },
  { type: 'circle', name: 'Circle', geometryType: 'circleGeometry', defaultScale: [.5, .5, .5], color: '#ffffff' },
  { type: 'donut', name: 'Donut', geometryType: 'donutGeometry', defaultScale: [.36, .36, .36], color: '#ffffff' },
  { type: 'knot', name: 'Knot', geometryType: 'knotGeometry', defaultScale: [.28, .28, .28], color: '#ffffff' }
];


export const createObjectsSlice = (set) => ({
    objects: {
        instances: [],
        selectedId: null,
        grabbedId: null, // object currently held by a pointer (mouse drag, grab, pinch); null when free
        deleteArmed: false // true while the VR "open hand -> fist" delete gesture is armed (red outline)
    },

    // DELETE GESTURE ----------------- armed state of the VR delete gesture (see FistDeleteGesture.jsx)
    setDeleteArmed: (armed) => {
        set((state) => ({
            objects: {
                ...state.objects,
                deleteArmed: armed
            }
        }))
    },

    // GRAB -------------------------- tracks which object is being held (blocks world gestures meanwhile)
    setGrabbedObject: (id) => {
        set((state) => ({
            objects: {
                ...state.objects,
                grabbedId: id
            }
        }))
    },


    // ADD --------------------- create object and add to main array tracking all abject in the scene
    // position: room (board-local) coordinates in meters; default = room center, resting on the floor
    addObject: (type, position = [0, .5, 0]) => {
        const object = objectsList.find(item => item.type === type)
        if (!object) { console.warn(`"${type}" type doesen't exist in objects list`); return; };

        const newObject = {
            id: crypto.randomUUID(),
            type: object.type,
            geometryType: object.geometryType,
            color: object.color,
            position,
            rotation: [0, 0, 0],
            scale: object.defaultScale
        }

        set((state) => ({
            objects: {
                ...state.objects,
                instances: [...state.objects.instances, newObject]
            }
        }));
    },

    // SELECT ----------------------- tracks the selected object
    selectObject: (id) => {
        set((state) => ({
            objects: {
                ...state.objects,
                selectedId: id
            }
        }))
    },

    // DESELECT ----------------------- set to null selectedId property
    deselectObject: () => {
        set((state) => ({
            objects: {
                ...state.objects,
                selectedId: null
            }
        }))
    },

    // UPDATE ----------------------- update object transform
    updateObject: (id, updates) => {
        set((state) => ({
            objects: {
                ...state.objects,
                instances: state.objects.instances.map((obj) => obj.id === id ? {...obj, ...updates} : obj)
            }
        }))
    },

    // REMOVE --------------------------- delete object with specific id from main array
    removeObject: (id) => {
        set((state) => ({
            objects: {
                ...state.objects,
                instances: state.objects.instances.filter(obj => obj.id !== id),
                selectedId: state.objects.selectedId === id ? null : state.objects.selectedId,
                deleteArmed: false
            }
        }))
    }

})