import './experiencebutton.css'

export default function ExperienceButton({svg, onClick, title, isDisabled = false, text}) {

    return(
        <button 
            className='expBtn' 
            onClick={onClick} 
            title={title}
            disabled = {isDisabled}
        >{svg}{text}</button>
    );
}
