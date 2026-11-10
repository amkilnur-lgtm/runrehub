import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

// Личные рекорды — сплошная сетка 3×2 (утверждённый макет): в клетке дистанция, время крупно, дата.
// Пустые — «—». Свежий рекорд — тёплый фон и «новый». Нажатие — лист снизу с подробностями.

export type PbResult = {
  id: number;
  race_date: string;
  name: string;
  official_time_seconds: number | null;
  place_overall?: number | null;
  participants?: number | null;
  workout_id?: number | null;
};
export type PbItem = { distanceMeters: number; label: string; result: PbResult | null; improvementSeconds: number | null };

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function time(seconds: number | null | undefined) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function parts(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return { y: y!, m: m! - 1, d: d! };
}

function shortDate(value: string) {
  const { y, m, d } = parts(value);
  return `${d} ${MONTHS[m]}${y === new Date().getFullYear() ? "" : ` ${y}`}`;
}

export function PbGrid({
  bests,
  freshDistance,
  workoutHref,
  onEdit,
  onAdd,
  caption = "по протоколу"
}: {
  bests: PbItem[];
  freshDistance?: number | null;
  workoutHref?: (id: number) => string;
  onEdit?: (best: PbItem) => void;
  onAdd?: (distanceMeters: number) => void;
  caption?: string;
}) {
  const [open, setOpen] = useState<PbItem | null>(null);
  const filled = bests.filter((best) => best.result).length;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <section className="ds-block ds-pad pbg" aria-label="Личные рекорды">
      <div className="pbg-head">
        <b>Личные рекорды</b>
        <span>
          {filled} из {bests.length} · {caption}
        </span>
      </div>
      <div className="pbg-grid">
        {bests.map((best) => {
          const fresh = Boolean(best.result) && best.distanceMeters === freshDistance;
          if (!best.result) {
            return onAdd ? (
              <button key={best.distanceMeters} type="button" className="pbg-c is-none" onClick={() => onAdd(best.distanceMeters)} aria-label={`Добавить результат на ${best.label}`}>
                <span className="pbg-d">{best.label}</span>
                <span className="pbg-t">—</span>
                <span className="pbg-w pbg-add">+ добавить</span>
              </button>
            ) : (
              <div key={best.distanceMeters} className="pbg-c is-none">
                <span className="pbg-d">{best.label}</span>
                <span className="pbg-t">—</span>
              </div>
            );
          }
          return (
            <button
              key={best.distanceMeters}
              type="button"
              className={fresh ? "pbg-c is-fresh" : "pbg-c"}
              onClick={() => setOpen(best)}
              aria-label={`${best.label}: ${time(best.result.official_time_seconds)}, ${best.result.name}`}
            >
              <span className="pbg-d">{best.label}</span>
              <span className="pbg-t">{time(best.result.official_time_seconds)}</span>
              <span className="pbg-w">
                {shortDate(best.result.race_date)}
                {fresh ? " · новый" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {open?.result ? (
        <div className="pbg-back" role="dialog" aria-modal="true" aria-label={`Рекорд на ${open.label}`} onClick={() => setOpen(null)}>
          <div className="pbg-sheet" onClick={(event) => event.stopPropagation()}>
            <span className="pbg-grab" aria-hidden="true" />
            <span className="pbg-cap">{open.label} · личный рекорд</span>
            <span className="pbg-big">{time(open.result.official_time_seconds)}</span>
            <div className="pbg-kv">
              <span>Старт</span>
              <b>{open.result.name}</b>
            </div>
            <div className="pbg-kv">
              <span>Дата</span>
              <b>
                {parts(open.result.race_date).d} {MONTHS_FULL[parts(open.result.race_date).m]} {parts(open.result.race_date).y}
              </b>
            </div>
            {open.result.place_overall ? (
              <div className="pbg-kv">
                <span>Место</span>
                <b>
                  {open.result.place_overall}
                  {open.result.participants ? ` из ${open.result.participants.toLocaleString("ru-RU")}` : ""}
                </b>
              </div>
            ) : null}
            {open.improvementSeconds ? (
              <div className="pbg-kv">
                <span>Быстрее прежнего</span>
                <b>на {time(open.improvementSeconds)}</b>
              </div>
            ) : null}
            <div className="pbg-acts">
              {open.result.workout_id && workoutHref ? (
                <Link className="ds-btn ds-btn-2" to={workoutHref(open.result.workout_id)}>
                  Открыть пробежку
                </Link>
              ) : null}
              {onEdit ? (
                <button
                  type="button"
                  className="ds-btn ds-btn-3"
                  onClick={() => {
                    const best = open;
                    setOpen(null);
                    onEdit(best);
                  }}
                >
                  Изменить
                </button>
              ) : null}
              <button type="button" className="ds-btn ds-btn-3" onClick={() => setOpen(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
