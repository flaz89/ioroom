import './circle-button.css'

export default function CircleButton({svg, onClick, title, isDisabled = false, text}) {

    return(
        <button 
            className='circleBtn' 
            onClick={onClick} 
            title={title}
            disabled = {isDisabled}
        >{svg}{text}</button>
    );
}
