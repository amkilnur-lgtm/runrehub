import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { prefetchApi, useApi } from "../hooks/useApi";
import { formatKm } from "../lib";
import { intensityPercent } from "../lib-hrzones";

// Тепловая карта группы — по исследованию «Страница тренера и клуба»:
// сплошная таблица без плиток и штриховки; текущий период помечен один раз в шапке,
// его числа серые без заливки (период ещё идёт — это не падение); единица в заголовке;
// легенда одной строкой; имя со стрелкой ведёт к спортсмену, клетка — к спортсмену на этом уровне.
type Level = "days" | "weeks" | "months";
type Metric = "km" | "ele" | "int";

type Cell = {
  distance_meters: number;
  elevation_gain: number;
  moving_time_seconds: number;
  workout_count: number;
  zone_seconds: number[];
  weekly_distance_meters: number | null;
};

type HeatmapData = {
  level: Level;
  periods: { start: string; finish: string }[];
  athletes: {
    id: number;
    full_name: string;
    member_since: string;
    cells: Cell[];
    freshness: {
      tsb: number;
      zone: "fresh" | "neutral" | "productive" | "overload";
    } | null;
  }[];
};

const METRICS: { value: Metric; label: string }[] = [
  { value: "km", label: "Км" },
  { value: "ele", label: "Набор" },
  { value: "int", label: "Интенсивность" },
];
const MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];
const MONTH_NAMES = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
const FRESH_LABEL = {
  fresh: "свежий",
  neutral: "норма",
  productive: "↗ рост",
  overload: "перегруз",
} as const;
const FRESH_CLASS = {
  fresh: "ds-pill-good",
  neutral: "ds-pill-soft",
  productive: "ds-pill-soft",
  overload: "ds-pill-danger",
} as const;

// Интенсивность — доля времени бега в 3–5 зоне по личным зонам спортсмена (lib-hrzones.ts).
// У любителей обычно 0–10%; неделя с интервалами — 15–35%. Доля времени в 3–5 зоне · ориентир — не больше 20%.
function intensityShare(cell: Cell) {
  return intensityPercent(cell.zone_seconds);
}

function step(value: number, edges: number[]) {
  const index = edges.findIndex((edge) => value < edge);
  return index === -1 ? edges.length + 1 : index + 1;
}

const EDGES = {
  km: [15, 30, 45, 60],
  ele: [100, 250, 450, 700],
  int: [5, 10, 20, 30],
} as const;
const DAY_EDGES = {
  km: [5, 10, 15, 20],
  ele: [30, 80, 150, 250],
  int: [5, 10, 20, 30],
} as const;
// по месяцам — сумма за месяц (не среднее в неделю: тренеру понятнее «сколько набегал за октябрь»)
const MONTH_EDGES = {
  km: [60, 120, 180, 240],
  ele: [400, 1000, 1800, 2800],
  int: [5, 10, 20, 30],
} as const;
const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const UNIT = { km: "км", ele: "м", int: "%" } as const;

function edgesFor(metric: Metric, level: Level) {
  return level === "days" ? DAY_EDGES[metric] : level === "months" ? MONTH_EDGES[metric] : EDGES[metric];
}

function cellValue(cell: Cell, metric: Metric, level: Level) {
  if (cell.workout_count === 0) return null;
  const edges = [...edgesFor(metric, level)];
  if (metric === "km") {
    const meters = cell.distance_meters;
    const km = meters / 1000;
    return {
      text: km >= 10 ? String(Math.round(km)) : formatKm(meters),
      tone: step(km, edges),
    };
  }
  if (metric === "ele")
    return {
      // 4 цифры не влезают в клетку телефона: 1250 → «1,3к»
      text:
        cell.elevation_gain >= 1000
          ? `${(cell.elevation_gain / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}к`
          : String(Math.round(cell.elevation_gain)),
      tone: step(cell.elevation_gain, edges),
    };
  const share = intensityShare(cell);
  if (share === null) return { text: "?", tone: 0 };
  return { text: String(share), tone: step(share, edges) };
}

function title(metric: Metric, level: Level) {
  const what =
    metric === "km" ? "Объём" : metric === "ele" ? "Набор" : "Интенсивность";
  const unit =
    UNIT[metric];
  const by =
    level === "days"
      ? "по дням"
      : level === "weeks"
        ? "по неделям"
        : "по месяцам";
  return `${what} ${by}, ${unit}`;
}

function headerLabel(period: { start: string }, level: Level) {
  const start = new Date(period.start);
  if (level === "months") return MONTHS[start.getMonth()]!;
  if (level === "days")
    return `${DAYS[(start.getDay() + 6) % 7]} ${start.getDate()}`;
  return `${start.getDate()} ${MONTHS[start.getMonth()]}`;
}

function useIsPhone() {
  const query = "(max-width: 720px)";
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setPhone(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return phone;
}

export function GroupHeatmap() {
  const [level, setLevel] = useState<Level>("weeks");
  const [metric, setMetric] = useState<Metric>("km");
  const [showIdle, setShowIdle] = useState(false);
  const isPhone = useIsPhone();
  const navigate = useNavigate();
  const { data: fresh, loading, error } = useApi<HeatmapData>(`/api/trainer/group-heatmap?level=${level}`);
  const monthData = useApi<HeatmapData>("/api/trainer/group-heatmap?level=weeks").data;
  // пока новый период грузится — держим прежнюю таблицу, чтобы страница не прыгала
  const [kept, setKept] = useState<HeatmapData | null>(null);
  useEffect(() => {
    if (fresh) setKept(fresh);
  }, [fresh]);
  const data = fresh ?? kept;
  const switching = !fresh && Boolean(kept);
  // остальные периоды — заранее, чтобы переключение было мгновенным
  useEffect(() => {
    (["days", "weeks", "months"] as const).forEach((value) => prefetchApi(`/api/trainer/group-heatmap?level=${value}`));
  }, []);

  const allPeriods = data?.periods ?? [];
  // на телефоне — последние 5 недель (4 полные + текущая), на компьютере — все
  // «Месяц» — последние 5 недель (4 полные + текущая) и на телефоне, и на компьютере
  const firstVisible =
    data && level === "weeks" ? Math.max(allPeriods.length - 5, 0) : 0;
  const periods = allPeriods.slice(firstVisible);
  // текущая колонка: сегодня в «Неделе», последняя — в «Месяце» и «Сезоне»
  const todayIndex = (new Date().getDay() + 6) % 7;
  const viewLevel = data?.level ?? level;
  const current = viewLevel === "days" ? todayIndex : periods.length - 1;

  const athletes = (data?.athletes ?? [])
    .slice()
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
  // «без пробежек» — по последним 5 неделям, одинаково во всех периодах: таблица не меняет высоту
  const activeIds = new Set(
    (monthData?.athletes ?? data?.athletes ?? [])
      .filter((athlete) => athlete.cells.slice(-5).some((cell) => cell.workout_count > 0))
      .map((athlete) => athlete.id),
  );
  const active = athletes.filter((athlete) => activeIds.has(athlete.id));
  const idle = athletes.filter((athlete) => !activeIds.has(athlete.id));
  const rows = showIdle ? [...active, ...idle] : active;
  const ramp = metric === "km" ? "vol" : metric === "ele" ? "ele" : "int";
  const edges = edgesFor(metric, viewLevel);
  const legendTop = `${edges[edges.length - 1]}+ ${metric === "int" ? "%" : UNIT[metric]}`;

  return (
    <section className="ds-block ds-pad gh" aria-label="Группа по периодам">
      <b className="gh-title">{title(metric, viewLevel)}</b>
      <div className="ds-seg gh-metric" role="group" aria-label="Что в клетке">
        {METRICS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={metric === item.value}
            onClick={() => setMetric(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="ds-seg gh-metric" role="group" aria-label="Период">
        {(
          [
            ["days", "Неделя"],
            ["weeks", "Месяц"],
            ["months", "Сезон"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={level === value}
            onClick={() => setLevel(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="gh-ctl">
        <div className="gh-legend" aria-label={`Шкала: от 0 до ${legendTop}`}>
          <span>0</span>
          {[1, 2, 3, 4, 5].map((index) => (
            <i key={index} className={`t-${ramp}-${index}`} />
          ))}
          <span>{legendTop}</span>
        </div>
      </div>
      {metric === "int" ? (
        <p className="gh-note">
          Время в 3–5 зоне · норма до 20%
        </p>
      ) : null}

      {loading && !data ? (
        <div
          className="skeleton-block"
          style={{ height: 240, borderRadius: 12 }}
        />
      ) : error || !data ? (
        <p className="ds-sub">{error || "Не удалось загрузить"}</p>
      ) : !athletes.length ? (
        <p className="ds-sub">В группе пока нет спортсменов.</p>
      ) : (
        <div className={switching ? "gh-scroll is-switching" : "gh-scroll"}>
          <table className="gh-table">
            <thead>
              <tr>
                <th className="gh-name" />
                {periods.map((period, index) => (
                  <th
                    key={period.start}
                    className={index === current ? "is-now" : undefined}
                  >
                    <Link
                      className="gh-colhead"
                      to={`/trainer/runs?from=${encodeURIComponent(period.start)}&to=${encodeURIComponent(period.finish)}`}
                      aria-label={`Пробежки клуба: ${headerLabel(period, viewLevel)}`}
                    >
                    {viewLevel === "days" ? (
                      <>
                        <span className="gh-wd">
                          {headerLabel(period, viewLevel).split(" ")[0]}
                        </span>
                        {headerLabel(period, viewLevel).split(" ")[1]}
                      </>
                    ) : (
                      headerLabel(period, viewLevel)
                    )}
                    {index === current ? (
                      viewLevel === "days" ? null : (
                        <small>идёт</small>
                      )
                    ) : null}
                    </Link>
                  </th>
                ))}
                {isPhone ? null : <th className="gh-side">Свежесть</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((athlete) => {
                const joined = new Date(athlete.member_since).getTime();
                return (
                  <tr key={athlete.id}>
                    <th className="gh-name" scope="row">
                      <Link to={`/trainer/athletes/${athlete.id}`}>
                        <span>
                          {isPhone
                            ? athlete.full_name.split(" ")[0]
                            : athlete.full_name}
                        </span>
                        <i className="gh-chev" aria-hidden="true" />
                      </Link>
                    </th>
                    {periods.map((period, index) => {
                      const cell = athlete.cells[index + firstVisible]!;
                      // будущие дни недели и недели до прихода в клуб — пустые
                      const beforeJoin =
                        new Date(period.finish).getTime() <= joined ||
                        (viewLevel === "days" && index > todayIndex);
                      const value = cellValue(cell, metric, viewLevel);
                      const isNow = index === current;
                      const cls = beforeJoin
                        ? "gh-c is-na"
                        : !value
                          ? "gh-c is-zero"
                          : isNow
                            ? "gh-c is-now"
                            : value.tone
                              ? `gh-c t-${ramp}-${value.tone}`
                              : "gh-c is-zero";
                      return (
                        <td key={period.start}>
                          <button
                            type="button"
                            className={cls}
                            onClick={() =>
                              navigate(
                                `/trainer/runs?athlete=${athlete.id}&from=${encodeURIComponent(period.start)}&to=${encodeURIComponent(period.finish)}`,
                              )
                            }
                            aria-label={`${athlete.full_name}, ${headerLabel(period, viewLevel)}${isNow ? " (идёт)" : ""}: ${
                              beforeJoin
                                ? "ещё не в клубе"
                                : value
                                  ? `${value.text} ${UNIT[metric]}`
                                  : "нет пробежек"
                            }`}
                          >
                            {beforeJoin ? "" : value ? value.text : "—"}
                          </button>
                        </td>
                      );
                    })}
                    {isPhone ? null : (
                      <td className="gh-side">
                        {athlete.freshness ? (
                          <span
                            className={`ds-pill ${FRESH_CLASS[athlete.freshness.zone]}`}
                          >
                            {athlete.freshness.tsb > 0
                              ? "+"
                              : athlete.freshness.tsb < 0
                                ? "−"
                                : ""}
                            {Math.abs(athlete.freshness.tsb)} ·{" "}
                            {FRESH_LABEL[athlete.freshness.zone]}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {idle.length && !showIdle ? (
        <button
          type="button"
          className="gh-idle"
          onClick={() => setShowIdle(true)}
        >
          <b>Без пробежек · {idle.length}</b>
          <span>
            {idle.map((athlete) => athlete.full_name.split(" ")[0]).join(", ")}{" "}
            ›
          </span>
        </button>
      ) : null}
      <p className="gh-note">
        {level === "days"
          ? "Сегодня"
          : level === "months"
            ? MONTH_NAMES[new Date().getMonth()]![0]!.toUpperCase() +
              MONTH_NAMES[new Date().getMonth()]!.slice(1)
            : "Текущая неделя"}{" "}
        серым — ещё идёт. Клетка — пробежки за эти дни, дата сверху — весь клуб.
      </p>
    </section>
  );
}
