// Отклик на нажатие «как в приложении» (Apple HIG: подсветка ячейки; Material: state layer):
// — подсветка появляется через ~60 мс после касания, чтобы прокрутка её не включала;
// — палец сдвинулся больше чем на 8 px (это прокрутка) — подсветка снимается;
// — короткий тап держит отклик ещё ~120 мс, чтобы его успели увидеть.
// Класс .is-pressed ставится на ближайший нажимаемый элемент; вид — в styles.css.

const PRESSABLE = "a, button, [role='button'], label.ds-li, summary";
const DELAY_MS = 60;
const HOLD_MS = 120;
const MOVE_PX = 8;

export function installPressFeedback() {
  if (typeof window === "undefined") return;
  let target: HTMLElement | null = null;
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let shown = false;

  const clear = (keep = false) => {
    window.clearTimeout(timer);
    const el = target;
    target = null;
    if (!el) return;
    if (keep) {
      // тап короче задержки — всё равно мелькнём, чтобы было видно нажатие
      el.classList.add("is-pressed");
      window.setTimeout(() => el.classList.remove("is-pressed"), HOLD_MS);
    } else {
      el.classList.remove("is-pressed");
    }
    shown = false;
  };

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse") return; // мышь — обычные :hover/:active
      const el = (event.target as Element | null)?.closest<HTMLElement>(PRESSABLE);
      if (!el || (el as HTMLButtonElement).disabled) return;
      clear();
      target = el;
      startX = event.clientX;
      startY = event.clientY;
      timer = window.setTimeout(() => {
        el.classList.add("is-pressed");
        shown = true;
      }, DELAY_MS);
    },
    { passive: true }
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!target) return;
      if (Math.abs(event.clientX - startX) > MOVE_PX || Math.abs(event.clientY - startY) > MOVE_PX) clear();
    },
    { passive: true }
  );
  document.addEventListener("pointerup", () => clear(!shown && Boolean(target)), { passive: true });
  document.addEventListener("pointercancel", () => clear(), { passive: true });
  window.addEventListener("scroll", () => clear(), { passive: true, capture: true });
}
