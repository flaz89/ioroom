import './objects-menu.css'
import { useStore } from "../../../store/appStore";
import { objectsList } from "../../../store/slices/objectsSlice";

export default function ObjectsMenu({ onClose }) {
  const addObject = useStore((state) => state.addObject);
  
  const handleAddObject = (type) => {
    addObject(type);
    onClose();  // Chiude il menu dopo aver aggiunto
  };
  
  return (
    <div className="objects-menu">
     
      <div className="objects-menu-header">
        <button className="tab active">Primitives</button>
        <button className="tab disabled">Furnitures</button>
      </div>
      
   
      <div className="objects-menu-list">
        {objectsList.map((item) => (
          <button
            key={item.type}
            className="object-item"
            onClick={() => handleAddObject(item.type)}
          >
            <span className="object-icon">📦</span>
            <span className="object-name">{item.name}</span>
          </button>
        ))}
      </div>

    </div>
  );
}