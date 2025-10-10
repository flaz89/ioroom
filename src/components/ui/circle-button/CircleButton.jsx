import './circle-button.css'

export default function CircleButton({svg, onClick, title, style, isDisabled = false, text}) {

    return(
        <button 
            className='circleBtn' 
            onClick={onClick} 
            title={title}
            disabled = {isDisabled}
            style={style}
        >{svg}{text}</button>
    );
}
