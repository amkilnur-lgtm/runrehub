import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useApi } from "../hooks/useApi";
import { formatKm } from "../lib";

// Тепловая карта группы — по исследованию «Страница тренера и клуба»:
// сплошная таблица без плиток и штриховки; текущий период помечен один раз в шапке,
// его числа серые без заливки (период ещё идёт — это не падение); единица в заголовке;
// легенда одной строкой; имя со стрелкой ведёт к спортсмену, клетка — к спортсмену на этом уровне.
type Level = "weeks" | "blocks" | "months";
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
    freshness: { tsb: number; zone: "fresh" | "neutral" | "productive" | "overload" } | null;
  }[];
};

const METRICS: { value: Metric; label: string }[] = [
  { value: "km", label: "Км" },
  { value: "ele", label: "Набор" },
  { value: "int", label: "Пульс 150+" }
];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const FRESH_LABEL = { fresh: "свежий", neutral: "норма", productive: "↗ рост", overload: "перегруз" } as const;
const FRESH_CLASS = { fresh: "ds-pill-good", neutral: "ds-pill-soft", productive: "ds-pill-soft", overload: "ds-pill-danger" } as const;

function intensityShare(cell: Cell) {
  const total = cell.zone_seconds.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.round(((cell.zone_seconds[2]! + cell.zone_seconds[3]!) / total) * 100) : null;
}

function step(value: number, edges: number[]) {
  const index = edges.findIndex((edge) => value < edge);
  return index === -1 ? edges.length + 1 : index + 1;
}

const EDGES = { km: [15, 30, 45, 60], ele: [100, 250, 450, 700], int: [15, 25, 35, 50] } as const;
const UNIT = { km: "км", ele: "м", int: "%" } as const;

function cellValue(cell: Cell, metric: Metric, level: Level) {
  if (cell.workout_count === 0) return null;
  if (metric === "km") {
    const meters = level === "weeks" ? cell.distance_meters : cell.weekly_distance_meters ?? cell.distance_meters;
    const km = meters / 1000;
    return { text: km >= 10 ? String(Math.round(km)) : formatKm(meters), tone: step(km, [...EDGES.km]) };
  }
  if (metric === "ele") return { text: String(Math.round(cell.elevation_gain)), tone: step(cell.elevation_gain, [...EDGES.ele]) };
  const share = intensityShare(cell);
  if (share === null) return { text: "?", tone: 0 };
  return { text: String(share), tone: step(share, [...EDGES.int]) };
}

function title(metric: Metric, level: Level) {
  const what = metric === "km" ? "Объём" : metric === "ele" ? "Набор" : "Время с пульсом 150+";
  if (level === "weeks") return `${what} по неделям, ${UNIT[metric]}`;
  if (level === "blocks") return `${what} по 4 недели, ${metric === "km" ? "км в неделю" : UNIT[metric]}`;
  return `${what} по месяцам, ${metric === "km" ? "км в неделю" : UNIT[metric]}`;
}

function headerLabel(period: { start: string }, level: Level) {
  const start = new Date(period.start);
  if (level === "months") return MONTHS[start.getMonth()]!;
  return `${start.getDate()} ${MONTHS[start.getMonth()]}`;
}

function useIsPhone() {
  const query = "(max-width: 720px)";
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
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
  const { data, loading, error } = useApi<HeatmapData>(`/api/trainer/group-heatmap?level=${level}`);

  const allPeriods = data?.periods ?? [];
  // на телефоне — последние 5 недель (4 полные + текущая), на компьютере — все
  const firstVisible = data && isPhone && level === "weeks" ? Math.max(allPeriods.length - 5, 0) : 0;
  const periods = allPeriods.slice(firstVisible);
  const current = periods.length - 1;
  const cycle = level === "weeks" ? "week" : level === "blocks" ? "blocks" : "season";

  const athletes = (data?.athletes ?? []).slice().sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
  const visibleCells = (athlete: HeatmapData["athletes"][number]) => athlete.cells.slice(firstVisible);
  const active = athletes.filter((athlete) => visibleCells(athlete).some((cell) => cell.workout_count > 0));
  const idle = athletes.filter((athlete) => !visibleCells(athlete).some((cell) => cell.workout_count > 0));
  const rows = showIdle ? [...active, ...idle] : active;
  const ramp = metric === "km" ? "vol" : metric === "ele" ? "ele" : "int";
  const edges = EDGES[metric];
  const legendTop = `${edges[edges.length - 1]}+ ${metric === "int" ? "%" : UNIT[metric]}`;

  return (
    <section className="ds-block ds-pad gh" aria-label="Группа по периодам">
      <b className="gh-title">{title(metric, level)}</b>
      <div className="ds-seg gh-metric" role="group" aria-label="Что в клетке">
        {METRICS.map((item) => (
          <button key={item.value} type="button" aria-pressed={metric === item.value} onClick={() => setMetric(item.value)}>
            {item.label}
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
        <label className="gh-period">
          <span className="sr-only">Период</span>
          <select value={level} onChange={(event) => setLevel(event.target.value as Level)}>
            <option value="weeks">{isPhone ? "5 недель" : "10 недель"}</option>
            <option value="blocks">по 4 недели</option>
            <option value="months">сезон</option>
          </select>
        </label>
      </div>
      {metric === "int" ? <p className="gh-note">Доля времени бега с пульсом 150 и выше: чем темнее, тем больше тяжёлой работы.</p> : null}

      {loading && !data ? (
        <div className="skeleton-block" style={{ height: 240, borderRadius: 12 }} />
      ) : error || !data ? (
        <p className="ds-sub">{error || "Не удалось загрузить"}</p>
      ) : !athletes.length ? (
        <p className="ds-sub">В группе пока нет спортсменов.</p>
      ) : (
        <div className="gh-scroll">
          <table className="gh-table">
            <thead>
              <tr>
                <th className="gh-name" />
                {periods.map((period, index) => (
                  <th key={period.start} className={index === current ? "is-now" : undefined}>
                    {headerLabel(period, level)}
                    {index === current ? <small>идёт</small> : null}
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
                        <span>{isPhone ? athlete.full_name.split(" ")[0] : athlete.full_name}</span>
                        <i className="gh-chev" aria-hidden="true" />
                      </Link>
                    </th>
                    {periods.map((period, index) => {
                      const cell = athlete.cells[index + firstVisible]!;
                      const beforeJoin = new Date(period.finish).getTime() <= joined;
                      const value = cellValue(cell, metric, level);
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
                            onClick={() => navigate(`/trainer/athletes/${athlete.id}?cycle=${cycle}`)}
                            aria-label={`${athlete.full_name}, ${headerLabel(period, level)}${isNow ? " (идёт)" : ""}: ${
                              beforeJoin ? "ещё не в клубе" : value ? `${value.text} ${UNIT[metric]}` : "нет пробежек"
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
                          <span className={`ds-pill ${FRESH_CLASS[athlete.freshness.zone]}`}>
                            {athlete.freshness.tsb > 0 ? "+" : athlete.freshness.tsb < 0 ? "−" : ""}
                            {Math.abs(athlete.freshness.tsb)} · {FRESH_LABEL[athlete.freshness.zone]}
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
        <button type="button" className="gh-idle" onClick={() => setShowIdle(true)}>
          <b>Без пробежек · {idle.length}</b>
          <span>{idle.map((athlete) => athlete.full_name.split(" ")[0]).join(", ")} ›</span>
        </button>
      ) : null}
      <p className="gh-note">
        {level === "months" ? MONTH_NAMES[new Date().getMonth()] : "Текущая неделя"} серым — период ещё идёт. Нажмите на имя или клетку —
        откроется спортсмен.
      </p>
    </section>
  );
}
