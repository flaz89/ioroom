import { useLayoutEffect } from 'react';

const MARGIN = 8; // px kept from the top of the window

/*
* Toolbar panels that float next to their button, vertically centered on it (css: top 50% +
* translateY(-50%)): slid up when they would reach below the toolbar's bottom (the bottom of the settings
* button, the last of `.left-tools`; the window bottom when outside it), and down when they would leave
* the top of the window (the top limit wins on a panel taller than the space).
* Re-fitted whenever the panel changes size (it grows when it opens a section: tool hints, DXF layers...)
* and when the window is resized. Desktop only: on phones the panels are centered cards (ui.css), so the
* transform is left to the css there.
*/
export function usePanelInViewport(panelRef, isOpen) {
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel || window.matchMedia('(max-width: 767px)').matches) return;
        const fit = () => {
            panel.style.transform = '';
            const { top, bottom } = panel.getBoundingClientRect();
            const floor = panel.closest('.left-tools')?.getBoundingClientRect().bottom ?? window.innerHeight - MARGIN;
            let shift = Math.min(0, floor - bottom);
            if (top + shift < MARGIN) shift = MARGIN - top;
            if (shift !== 0) panel.style.transform = `translateY(calc(-50% + ${shift}px))`;
        };
        fit();
        // a transform does not change the panel's size: no resize loop
        const observer = new ResizeObserver(fit);
        observer.observe(panel);
        window.addEventListener('resize', fit);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', fit);
        };
    }, [panelRef, isOpen]);
}
