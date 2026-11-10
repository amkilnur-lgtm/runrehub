import { useEffect, useState } from "react";

import { api } from "../api";
import type { WorkoutFeeling as Feeling } from "../types/workout";
import { useToast } from "./ToastProvider";

const EFFORT: { value: NonNullable<Feeling["effort"]>; label: string }[] = [
  { value: "easy", label: "Легко" },
  { value: "normal", label: "Нормально" },
  { value: "hard", label: "Тяжело" }
];
const PAIN: { value: NonNullable<Feeling["pain"]>; label: string }[] = [
  { value: "none", label: "Ничего не болит" },
  { value: "light", label: "Лёгкая боль" }
];

// «Как ощущалось?» — личная отметка спортсмена, отдельно от переписки.
// Спортсмен отмечает у своей пробежки, тренер видит ответ.
export function WorkoutFeeling({
  workoutId,
  feeling,
  editable
}: {
  workoutId: number;
  feeling: Feeling | null | undefined;
  editable: boolean;
}) {
  const showToast = useToast();
  const [value, setValue] = useState<Feeling>(feeling ?? { effort: null, pain: null });

  useEffect(() => {
    setValue(feeling ?? { effort: null, pain: null });
  }, [feeling, workoutId]);

  async function save(patch: Partial<Feeling>) {
    const previous = value;
    const next = { ...value, ...patch };
    setValue(next);
    try {
      const res = await api<{ feeling: Feeling }>(`/api/athlete/workouts/${workoutId}/feeling`, {
        method: "PUT",
        body: JSON.stringify(patch)
      });
      setValue(res.feeling);
    } catch (err) {
      setValue(previous);
      showToast("error", err instanceof Error ? err.message : "Не удалось сохранить");
    }
  }

  if (!editable) {
    const effort = EFFORT.find((item) => item.value === value.effort)?.label;
    const pain = PAIN.find((item) => item.value === value.pain)?.label;
    return (
      <section className="ds-block ds-pad" aria-label="Самочувствие">
        <b style={{ fontSize: 16 }}>Как ощущалось</b>
        {effort || pain ? (
          <div className="feel-row">
            {/* «легко / нормально / ничего не болит» — нейтрально, но заметной синей плашкой; тревожные — оранжевым */}
            {effort ? <span className={`ds-pill ${value.effort === "hard" ? "ds-pill-warn" : "ds-pill-accent"}`}>{effort}</span> : null}
            {pain ? <span className={`ds-pill ${value.pain === "light" ? "ds-pill-warn" : "ds-pill-accent"}`}>{pain}</span> : null}
          </div>
        ) : (
          <p className="ds-sub">Спортсмен ещё не отметил</p>
        )}
      </section>
    );
  }

  return (
    <section className="ds-block ds-pad" aria-label="Самочувствие">
      <b style={{ fontSize: 16 }}>
        Как ощущалось?<span className="feel-new">новое</span>
      </b>
      <div className="feel-row" role="radiogroup" aria-label="Самочувствие">
        {EFFORT.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={value.effort === item.value}
            className={value.effort === item.value ? "feel-chip is-on" : "feel-chip"}
            onClick={() => void save({ effort: value.effort === item.value ? null : item.value })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="feel-row" style={{ marginTop: 8 }} role="radiogroup" aria-label="Боль">
        {PAIN.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={value.pain === item.value}
            className={value.pain === item.value ? "feel-chip is-on" : "feel-chip"}
            onClick={() => void save({ pain: value.pain === item.value ? null : item.value })}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
