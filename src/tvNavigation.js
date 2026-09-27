export function initTvNavigation() {
  window.addEventListener('keydown', (e) => {
    // Check if the key is an arrow key
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

    // Get all focusable elements
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = Array.from(document.querySelectorAll(focusableSelector))
        .filter(el => !el.disabled && el.offsetWidth > 0 && el.offsetHeight > 0);

    if (focusableElements.length === 0) return;

    let active = document.activeElement;

    // If no element is focused, focus the first one on down arrow
    if (!active || !focusableElements.includes(active)) {
      if (e.key === 'ArrowDown') {
        focusableElements[0].focus();
        e.preventDefault();
      }
      return;
    }

    const activeRect = active.getBoundingClientRect();
    let bestMatch = null;
    let minDistance = Infinity;

    focusableElements.forEach(el => {
      if (el === active) return;

      const rect = el.getBoundingClientRect();
      let isCandidate = false;
      let distance = Infinity;

      // Calculate distance based on direction
      if (e.key === 'ArrowUp' && rect.bottom <= activeRect.top) {
        isCandidate = true;
        distance = Math.hypot(rect.x - activeRect.x, rect.bottom - activeRect.top);
      } else if (e.key === 'ArrowDown' && rect.top >= activeRect.bottom) {
        isCandidate = true;
        distance = Math.hypot(rect.x - activeRect.x, rect.top - activeRect.bottom);
      } else if (e.key === 'ArrowLeft' && rect.right <= activeRect.left) {
        isCandidate = true;
        distance = Math.hypot(rect.right - activeRect.left, rect.y - activeRect.y);
      } else if (e.key === 'ArrowRight' && rect.left >= activeRect.right) {
        isCandidate = true;
        distance = Math.hypot(rect.left - activeRect.right, rect.y - activeRect.y);
      }

      if (isCandidate && distance < minDistance) {
        minDistance = distance;
        bestMatch = el;
      }
    });

    if (bestMatch) {
      bestMatch.focus();
      e.preventDefault();
    }
  });
}
