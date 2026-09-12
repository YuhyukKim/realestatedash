"use client";
import { useEffect, useRef, type RefObject } from "react";
/** Docked panels never lock or trap the results list; overlays restore trigger focus. */
export function usePanelFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, modal = true) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    if (modal) { document.body.style.overflow = "hidden"; panel.focus(); }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (!modal || event.key !== "Tab") return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(node => !node.hidden && node.getClientRects().length > 0);
      if (!nodes.length) { event.preventDefault(); panel.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!panel.contains(document.activeElement) || document.activeElement === panel ||
          (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const target = modal ? window : panel;
    target.addEventListener("keydown", onKeyDown as EventListener);
    return () => {
      target.removeEventListener("keydown", onKeyDown as EventListener);
      if (modal) {
        document.body.style.overflow = overflow;
        if (previous?.isConnected) previous.focus();
      }
    };
  }, [ref, modal]);
}
