// Reliable activation for controls inside a transformed/scrolling bottom sheet.
// WKWebView can cancel or reorder Pointer Events while its native scroll gesture
// recognizer is active, so native finger taps use Touch Events directly. Web/PWA
// keeps the existing pointerup fast path. Every control owns its suppression
// state, preventing one item's touch from swallowing another item's click.

export function isNativeCapacitorRuntime(capacitor = globalThis.window?.Capacitor) {
  try {
    if (!capacitor) return false;
    if (typeof capacitor.isNativePlatform === 'function') return !!capacitor.isNativePlatform();
    return !!capacitor.isNative;
  } catch { return false; }
}

function touchById(list, id) {
  return Array.from(list || []).find((touch) => touch.identifier === id) || null;
}

export function reliableActivation(activate, { native = isNativeCapacitorRuntime(), moveTolerance = 12 } = {}) {
  let touch = null;
  let suppressClick = false;
  let suppressTimer = 0;

  const armClickSuppression = () => {
    suppressClick = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => { suppressClick = false; suppressTimer = 0; }, 750);
    if (suppressTimer && suppressTimer.unref) suppressTimer.unref();
  };

  const click = (event) => {
    if (suppressClick) {
      suppressClick = false;
      clearTimeout(suppressTimer);
      suppressTimer = 0;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }
    activate(event);
  };

  if (!native) {
    return {
      onpointerup: (event) => {
        if (event?.pointerType === 'mouse' || event?.isPrimary === false) return;
        event?.preventDefault?.();
        armClickSuppression();
        activate(event);
      },
      onclick: click,
    };
  }

  return {
    ontouchstart: (event) => {
      if (!event?.touches || event.touches.length !== 1) { touch = null; return; }
      const point = event.touches[0];
      touch = { id: point.identifier, x: point.clientX, y: point.clientY, moved: false };
    },
    ontouchmove: (event) => {
      if (!touch) return;
      const point = touchById(event?.touches, touch.id);
      if (!point) { touch.moved = true; return; }
      if (Math.abs(point.clientX - touch.x) > moveTolerance || Math.abs(point.clientY - touch.y) > moveTolerance) {
        touch.moved = true;
      }
    },
    ontouchend: (event) => {
      if (!touch) return;
      const start = touch;
      touch = null;
      const point = touchById(event?.changedTouches, start.id);
      const moved = !point || start.moved
        || Math.abs(point.clientX - start.x) > moveTolerance
        || Math.abs(point.clientY - start.y) > moveTolerance;
      // Suppress any compatibility click for this completed touch sequence,
      // including a scroll that WebKit later misclassifies as a tap.
      armClickSuppression();
      if (moved) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      activate(event);
    },
    ontouchcancel: () => { touch = null; armClickSuppression(); },
    // Keyboard activation and accessibility-generated clicks have no preceding
    // touch sequence and therefore continue through this standard click path.
    onclick: click,
  };
}
