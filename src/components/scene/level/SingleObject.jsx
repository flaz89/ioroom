import { PivotControls, Outlines } from "@react-three/drei";
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

    const selectObject = useStore((state) => state.selectObject);
    const selectedId = useStore((state) => state.objects.selectedId);
    const isSelected = data.id === selectedId;

    const handleClick = (event) => {
        event.stopPropagation();
        selectObject(data.id);
    }

    const meshContent = (
        <mesh 
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
            >
                {meshContent}
            </PivotControls>
        );
    }

    return meshContent;
}