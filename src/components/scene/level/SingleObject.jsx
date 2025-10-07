import { PivotControls, Outlines } from "@react-three/drei";
import * as THREE from 'three'
import { useRef } from "react";
import { useStore } from "../../../store/appStore";

function renderGeometry(type) {
  switch(type) {
    case 'boxGeometry':
      return <boxGeometry />;
    case 'sphereGeometry':
      return <sphereGeometry />;
    case 'cylinderGeometry':
      return <cylinderGeometry />;
    default:
      console.warn(`"${type}" geometry doesn't exist, boxGeometry used`);
      return <boxGeometry />;
  }
}

export default function SingleObject({data, showPivot}) {

    // ref for manage mesh transform, possibility to use with THREE matrix for nested objects in future
    const meshRef = useRef();

    const selectObject = useStore((state) => state.selectObject);
    const selectedId = useStore((state) => state.objects.selectedId);
    const updateObject = useStore((state) => state.updateObject);
    const isSelected = data.id === selectedId;

    // CLICK on mesh
    const handleClick = (event) => {
        event.stopPropagation();
        selectObject(data.id);
    }

    // DRAG on pivot controls and savte transform to appStore
    const handleDragEnd = () => {
        meshRef.current.updateMatrixWorld();
        
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        meshRef.current.matrixWorld.decompose(position, quaternion, scale);
        const euler = new THREE.Euler().setFromQuaternion(quaternion);

        const newTransform = {
            position: position.toArray(),
            rotation: [euler.x, euler.y, euler.z],
            scale: scale.toArray()
        };

        console.log('🔵 Valori estratti:', newTransform);
        updateObject(data.id, newTransform);

        
    }

    // mesh component
    const meshContent = (
        <mesh 
            ref={ meshRef }
            position={data.position}
            rotation={data.rotation}
            scale={data.scale}
            castShadow
            onClick={ handleClick }
        >
            {renderGeometry(data.geometryType)}
            <meshStandardMaterial color={data.color} />

            {isSelected && (<Outlines thickness={2} color={"orange"} screenspace={false} opacity={1} transparent={false} angle={0}/>)}
        </mesh>
    );

    if (showPivot && isSelected) {
        return (
            <PivotControls
                depthTest={false}
                anchor={[0, 0, 0]}
                onDragEnd={handleDragEnd}
            >
                {meshContent}
            </PivotControls>
        );
    }

    return meshContent;
}