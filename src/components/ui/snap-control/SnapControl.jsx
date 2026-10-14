import { useState } from 'react';
import CircleButton from '../circle-button/CircleButton';
import './snap-control.css';

/*
* Snap toggle with a step picker (grid cell size, rotation step...).
* - click on the main button: snap on/off (orange fill when on);
* - hover: round orange buttons with the available steps appear next to it (to the LEFT: the control
*   lives in the right toolbar); picking one sets the step and turns the snap on.
* Props: icon (svg), label (tooltip name), unit ('cm', '°'), enabled, step, steps, onToggle, onPick.
*/
export default function SnapControl({ icon, label, unit, enabled, step, steps, onToggle, onPick }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="snap-control" onMouseEnter={() => setIsOpen(true)} onMouseLeave={() => setIsOpen(false)}>
            <CircleButton
                svg={icon}
                onClick={onToggle}
                title={enabled ? `${label}: on (${step}${unit})` : `${label}: off`}
                isActive={enabled}
            />
            {isOpen && (
                <div className="snap-steps">
                    {steps.map((value) => (
                        <button
                            key={value}
                            className={`snap-step${enabled && value === step ? ' is-active' : ''}`}
                            onClick={() => onPick(value)}
                            title={`${label}: ${value}${unit}`}
                        >
                            {value}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
