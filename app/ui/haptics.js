// Vibration on a paired phone or tablet. The Edge and other PC screens have no motor.
// Android (Chrome, Samsung Internet): navigator.vibrate, with a pattern per kind of press.
// iPhone: Safari has no vibrate. Tapping the label of an <input switch> (iOS 17.4+) plays the
// system tick. From iOS 26.5 only a real finger on the label counts, so each control gets an
// invisible label over it, added on its first press. One light tick per press, no patterns.

const touch = matchMedia('(pointer: coarse)').matches;
const iphone = /iPhone/.test(navigator.userAgent) && 'switch' in HTMLInputElement.prototype;
/** 'buzz' (vibrate API), 'tick' (iPhone switch) or null when this device can't vibrate. */
export const can = touch && typeof navigator.vibrate === 'function' ? 'buzz' : iphone ? 'tick' : null;

let on = false;
/** Turn vibration on or off (only ever on for a paired device). */
export function enable(v) {
  on = !!v && !!can;
  document.body.classList.toggle('hx-on', on && can === 'tick');
}

const PATTERN = { critical: [30, 40, 30], error: 60, detent: 5 };
/** Android: buzz for a press of this kind. */
export function buzz(kind) {
  if (on && can === 'buzz') navigator.vibrate(PATTERN[kind] ?? 12);
}

/** iPhone: give a control its invisible switch label, so the lift of the finger ticks. */
export function host(node) {
  if (!on || can !== 'tick' || node.querySelector(':scope > label.hx')) return;
  // A control with buttons inside reads which one was hit; a label over it would hide them.
  if (node.querySelector('button')) return;
  const label = document.createElement('label');
  label.className = 'hx';
  label.setAttribute('aria-hidden', 'true');
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.addEventListener('click', e => e.stopPropagation());
  label.append(sw);
  if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
  node.append(label);
}
