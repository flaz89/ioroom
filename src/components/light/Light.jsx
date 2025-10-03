export default function Light() {

    return(
        <>  
            <ambientLight intensity={ 0.4 }/>

            <directionalLight 
                castShadow
                position={ [10, 10, 5] }
                intensity={ .4 }
                shadow-camera-far={50}
                shadow-camera-left={-10}
                shadow-camera-right={10}
                shadow-camera-top={10}
                shadow-camera-bottom={-10}
                shadow-mapSize={[2048, 2048]}
            />
        </>
    ); 
}