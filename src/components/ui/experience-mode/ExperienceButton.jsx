import './experienceButton.css'

export default function ExperienceButton({svg, onClick, title}) {

    return(
        <button 
            className='expBtn' 
            onClick={onClick} 
            title={title}
        >{svg}</button>
    );
}
