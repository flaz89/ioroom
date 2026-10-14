import './circle-button.css'

/*
* Round toolbar button.
* isActive: orange "on" look (same fill as the snap step buttons) for buttons whose menu/panel is open
* or whose mode is on (snap). aria-pressed tells assistive tech the same.
*/
export default function CircleButton({svg, onClick, title, style, isDisabled = false, isActive = false, text}) {

    return(
        <button 
            className={isActive ? 'circleBtn is-active' : 'circleBtn'}
            aria-pressed={isActive}
            onClick={onClick} 
            title={title}
            disabled = {isDisabled}
            style={style}
        >{svg}{text}</button>
    );
}
