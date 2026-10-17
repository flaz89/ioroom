import { useState } from 'react';
import CircleButton from '../circle-button/CircleButton';
import './snap-control.css';

/*
* Snap toggle with a step picker (grid cell size, rotation step...).
* - click on the main button: snap on/off (orange fill when on);
* - hover: round orange buttons with the available steps appear next to it, to the LEFT by default (right
*   toolbar) or to the RIGHT with side="right" (left toolbar); picking one sets the step and turns it on.
* Also used for tools with options (wall tool + thickness side, LeftToolBar.jsx): `labels` maps a step to
* its button text and `titles` to its tooltip (default: the value + unit).
* Props: icon (svg), label (tooltip name), unit ('cm', '°'), enabled, step, steps, onToggle, onPick,
* side?, labels?, titles?.
*/
export default function SnapControl({ icon, label, unit = '', enabled, step, steps, onToggle, onPick, side = 'left', labels, titles }) {
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
                <div className={side === 'right' ? 'snap-steps is-right' : 'snap-steps'}>
                    {steps.map((value) => (
                        <button
                            key={value}
                            className={`snap-step${enabled && value === step ? ' is-active' : ''}`}
                            onClick={() => onPick(value)}
                            title={titles?.[value] ?? `${label}: ${value}${unit}`}
                        >
                            {labels?.[value] ?? value}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
