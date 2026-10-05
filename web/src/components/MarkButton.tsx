import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { switchHaptics, vibrate } from '../lib/haptics';
import { XMark } from './Icons';

/** Must match the erase transition in styles.css (100 ms delay + 2 × 225 ms). */
export const HOLD_MS = 550;
const MOVE_TOLERANCE_PX = 10;

export type HintKind = 'touch' | 'keyboard';

interface MarkButtonProps {
  checked: boolean;
  disabled: boolean;
  label: string;
  /** Position in the grid, for arrow key navigation. */
  row: number;
  col: number;
  hintId: string;
  onChange: (checked: boolean) => void;
  onHint: (kind: HintKind) => void;
}

/**
 * A tap sets the X. Removing it takes a long press: the X erases itself
 * while the finger (or mouse button) is held and comes back if released early.
 * Keyboard: Space or Enter sets it, Delete or Backspace removes it.
 */
export const MarkButton = memo(function MarkButton({
  checked,
  disabled,
  label,
  row,
  col,
  hintId,
  onChange,
  onHint,
}: MarkButtonProps) {
  const [erasing, setErasing] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  // After a completed hold, the click that follows the release must not set the X again.
  const swallowClick = useRef(false);

  const cancelHold = () => {
    if (!hold.current) return;
    clearTimeout(hold.current.timer);
    hold.current = null;
    setErasing(false);
  };

  useEffect(() => () => clearTimeout(hold.current?.timer), []);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    swallowClick.current = false;
    if (!checked || disabled || event.button !== 0) return;
    const timer = window.setTimeout(() => {
      hold.current = null;
      swallowClick.current = true;
      setErasing(false);
      setDrawing(false);
      vibrate();
      onChange(false);
    }, HOLD_MS);
    hold.current = { timer, x: event.clientX, y: event.clientY };
    setErasing(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = hold.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancelHold();
  };

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (swallowClick.current) {
      // The release after a completed hold (on iPhone, its tap ticks the haptic switch).
      swallowClick.current = false;
      return;
    }
    if (!checked) {
      setDrawing(true);
      vibrate();
      onChange(true);
      return;
    }
    // Nothing changes, so no haptic tick either: the label must not toggle its switch.
    event.preventDefault();
    // A keyboard-triggered click has no pointer details.
    onHint(event.detail === 0 ? 'keyboard' : 'touch');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    swallowClick.current = false;
    if (checked && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      setDrawing(false);
      onChange(false);
    }
  };

  const className = ['mark', erasing && 'is-erasing', drawing && 'is-drawing'].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={checked ? hintId : undefined}
      className={className}
      disabled={disabled}
      data-row={row}
      data-col={col}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {checked && <XMark />}
      {switchHaptics && !disabled && <HapticSwitch />}
    </button>
  );
});

/**
 * A transparent label over the cell with a hidden switch, so the finger's tap toggles
 * the switch and iOS plays its haptic tick. The switch stays 1 px small and never under
 * the finger: a touch that starts on a switch can't scroll the page.
 */
function HapticSwitch() {
  return (
    <label className="haptic-switch" aria-hidden="true">
      <input
        type="checkbox"
        tabIndex={-1}
        ref={markAsSwitch}
        // The label forwards the tap as a second click; the cell already handled the first.
        onClick={(event) => event.stopPropagation()}
      />
    </label>
  );
}

// React doesn't know the `switch` attribute.
function markAsSwitch(input: HTMLInputElement | null) {
  input?.setAttribute('switch', '');
}
