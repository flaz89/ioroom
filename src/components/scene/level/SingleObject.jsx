import { PivotControls, Outlines } from "@react-three/drei";
import * as THREE from 'three'
import { useRef } from "react";
import { useStore } from "../../../store/appStore";

function renderGeometry(type) {
  switch(type) {
    case 'boxGeometry':
      return <boxGeometry />;
    case 'planeGeometry':
      return <planeGeometry />;
    case 'sphereGeometry':
      return <sphereGeometry />;
    case 'capsuleGeometry':
      return <capsuleGeometry />;
    case 'cylinderGeometry':
      return <cylinderGeometry />;
    case 'circleGeometry':
      return <circleGeometry />;
    case 'donutGeometry':
      return <torusGeometry />;
    case 'knotGeometry':
      return <torusKnotGeometry />;
    default:
      console.warn(`"${type}" geometry doesn't exist, boxGeometry used`);
      return <boxGeometry />;
  }
}

export default function SingleObject({data, showPivot}) {

    // ref for manage pivot transform, possibility to use with THREE matrix for nested objects in future
    const pivotRef = useRef();

    const selectObject = useStore((state) => state.selectObject);
    const selectedId = useStore((state) => state.objects.selectedId);
    const updateObject = useStore((state) => state.updateObject);
    const isSelected = data.id === selectedId;

    // CLICK on mesh
    const handleClick = (event) => {
        event.stopPropagation();
        selectObject(data.id);
    }

    // DRAG on pivot controls and save mesh transform to appStore
    const handleDragEnd = () => {
        if(!pivotRef.current) return;
        pivotRef.current.updateMatrixWorld();
        
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        pivotRef.current.matrixWorld.decompose(position, quaternion, scale);
        const euler = new THREE.Euler().setFromQuaternion(quaternion);

        const newTransform = {
            position: position.toArray(),
            rotation: [euler.x, euler.y, euler.z],
            scale: scale.toArray()
        };

        /* console.log('🔵 Valori estratti:', newTransform); */
        updateObject(data.id, newTransform);
    }

    // MESH COMPONENT
    const meshContent = (
        <mesh 
            castShadow
            receiveShadow
            onClick={ handleClick }
        >
            {renderGeometry(data.geometryType)}
            <meshStandardMaterial color={data.color} />
            {isSelected && (<Outlines thickness={2} color={"orange"} screenspace={false} opacity={1} transparent={false} angle={0}/>)}
        </mesh>
    );
    
    // PIVOT CONTROLS wrap mesh component
    if (showPivot && isSelected) {
        const matrix = new THREE.Matrix4();
        matrix.compose(
            new THREE.Vector3(...data.position),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(...data.rotation)),
            new THREE.Vector3(...data.scale)
        );
        return (
            <PivotControls
                ref={pivotRef}
                matrix={matrix}
                depthTest={false}
                anchor={[0, 0, 0]}
                onDragEnd={handleDragEnd}
            >
                {meshContent}
            </PivotControls>
        );
    }

    return (
        <group 
            position={data.position}
            rotation={data.rotation}
            scale={data.scale}
        >
            {meshContent}
        </group>
    );
}