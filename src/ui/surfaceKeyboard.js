/**
 * Own capture-phase Escape and Tab handling while a surface is active.
 * The caller owns visibility, content, initial focus and dismissal policy.
 * This does not make the surface modal or make the rest of the page inert.
 *
 * @param {object} options
 * @param {HTMLElement} options.root Surface containing the keyboard controls.
 * @param {Document} [options.documentRef] Document that dispatches keyboard input.
 * @param {() => boolean} options.isActive Whether this surface may handle input now.
 * @param {() => void} options.onEscape Caller-owned dismissal action.
 * @param {() => HTMLElement} [options.fallbackFocus] Return target if the opener is gone.
 * @param {boolean} [options.arrowKeys] Let Up/Down step through the controls,
 *   for TV remotes whose D-pad cannot leave a text field on its own. A text
 *   field reached this way is read-only until OK/Enter, because Android TV
 *   raises its keyboard on focus and the keyboard then swallows the D-pad.
 * @returns {{activate: Function, deactivate: Function, destroy: Function}}
 */
export function createSurfaceKeyboard({
  root,
  documentRef = root.ownerDocument,
  isActive,
  onEscape,
  fallbackFocus,
  arrowKeys = false,
}) {
  let active = false;
  let destroyed = false;
  let previouslyFocused = null;

  const focusOrder = () =>
    [
      ...root.querySelectorAll(
        'button, input, [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (node) =>
        !node.hasAttribute('disabled') && node.getClientRects().length > 0,
    );

  const passedThrough = new Set();
  const passThrough = (node) => {
    const editable =
      node.matches?.('input:not([type="button"]):not([type="checkbox"])') &&
      !node.readOnly;
    if (editable) {
      passedThrough.add(node);
      node.readOnly = true;
      node.addEventListener(
        'blur',
        () => {
          if (passedThrough.delete(node)) node.readOnly = false;
        },
        { once: true },
      );
    }
    node.focus();
  };

  const onKeyDown = (event) => {
    // Visibility/arbitration belongs to the screen, including overlays that
    // cover a measurable box. Respect another handler's claim on the same key.
    if (!active || destroyed || !isActive() || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (
      arrowKeys &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      const order = focusOrder();
      if (!order.length) return;
      const index = order.indexOf(documentRef.activeElement);
      const next =
        index === -1
          ? order[0]
          : order[index + (event.key === 'ArrowDown' ? 1 : -1)];
      event.preventDefault();
      if (next) passThrough(next);
      return;
    }
    if (
      arrowKeys &&
      event.key === 'Enter' &&
      passedThrough.has(documentRef.activeElement)
    ) {
      // OK on a field the D-pad landed on: make it editable and focus it
      // again so the on-screen keyboard comes up for typing.
      const field = documentRef.activeElement;
      event.preventDefault();
      passedThrough.delete(field);
      field.readOnly = false;
      field.blur?.();
      field.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    const order = focusOrder();
    if (!order.length) return;
    const first = order[0];
    const last = order[order.length - 1];
    const focused = documentRef.activeElement;
    // Allow native scrolling when cycling to an off-screen control in a short
    // surface. Initial focus and return focus use the caller's separate policy.
    if (!root.contains(focused)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && focused === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && focused === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const activate = () => {
    if (destroyed || active) return;
    active = true;
    previouslyFocused = documentRef.activeElement;
    documentRef.addEventListener('keydown', onKeyDown, true);
  };

  const deactivate = ({ restoreFocus = false } = {}) => {
    if (!active) return;
    active = false;
    documentRef.removeEventListener('keydown', onKeyDown, true);
    const target = previouslyFocused;
    previouslyFocused = null;
    if (!restoreFocus) return;
    if (typeof target?.focus === 'function' && target.isConnected) {
      target.focus({ preventScroll: true });
    } else {
      fallbackFocus?.()?.focus?.({ preventScroll: true });
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    deactivate();
  };

  return { activate, deactivate, destroy };
}
