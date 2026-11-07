/** The keyboard fix: no page relayout while a board text field is focused (pure gate), and the owed re-measure. */
import { describe, expect, it, vi } from 'vitest';
import { layoutGate, onTextFocusEnd, REMEASURE_MS, textFieldFocused, textFocusEnded } from '../src/web/textFocus';

describe('layout gate', () => {
  it('runs when no field is focused; never under a focused field (a re-measure is owed); a rotation always runs', () => {
    expect(layoutGate(false, false, false)).toEqual({ run: true, pending: false });
    expect(layoutGate(true, false, false)).toEqual({ run: false, pending: true });
    expect(layoutGate(true, false, true)).toEqual({ run: false, pending: true });
    expect(layoutGate(true, true, true)).toEqual({ run: true, pending: false });
    expect(layoutGate(false, false, true)).toEqual({ run: true, pending: false });
  });
  it('the focus leaving schedules exactly one re-measure after the keyboard animation', () => {
    vi.useFakeTimers();
    const f = vi.fn();
    const off = onTextFocusEnd(f);
    textFocusEnded();
    textFocusEnded(); // blur + removal in the same moment: still one call
    vi.advanceTimersByTime(REMEASURE_MS - 1);
    expect(f).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(f).toHaveBeenCalledTimes(1);
    off();
    vi.useRealTimers();
  });
  it('without a DOM nothing counts as focused', () => {
    expect(textFieldFocused()).toBe(false);
  });
});
