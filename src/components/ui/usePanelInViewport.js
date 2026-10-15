import { useLayoutEffect } from 'react';

/*
* Toolbar panels that float next to their button, vertically centered on it (css: top 50% +
* translateY(-50%)): if that pushes the panel off screen, slide it back inside. Desktop only: on phones
* the panels are centered cards (ui.css), so the transform is left to the css there.
* Runs when `isOpen` changes (the panel just mounted).
*/
export function usePanelInViewport(panelRef, isOpen) {
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel || window.matchMedia('(max-width: 767px)').matches) return;
        panel.style.transform = '';
        const { top, bottom } = panel.getBoundingClientRect();
        const margin = 8;
        const shift = bottom > window.innerHeight - margin
            ? window.innerHeight - margin - bottom
            : Math.max(0, margin - top);
        if (shift !== 0) panel.style.transform = `translateY(calc(-50% + ${shift}px))`;
    }, [panelRef, isOpen]);
}
