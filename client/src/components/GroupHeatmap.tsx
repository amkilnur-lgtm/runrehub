import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useApi } from "../hooks/useApi";
import { formatDuration, formatKm } from "../lib";

// Тепловая карта группы (client/DESIGN.md): в ячейке одна метрика — цифра и цвет,
// подробности — по нажатию. Уровни: эта неделя по дням · недели · 4 недели · сезон.
type Level = "days" | "weeks" | "blocks" | "months";
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
    cells: Cell[];
    freshness: { tsb: number; zone: "fresh" | "neutral" | "productive" | "overload" } | null;
  }[];
};

const LEVELS: { value: Level; label: string; short: string }[] = [
  { value: "days", label: "Эта неделя", short: "Дни" },
  { value: "weeks", label: "Недели", short: "Недели" },
  { value: "blocks", label: "4 недели", short: "4 нед" },
  { value: "months", label: "Сезон", short: "Сезон" }
];
const METRICS: { value: Metric; label: string; dot: string }[] = [
  { value: "km", label: "Объём", dot: "var(--vol-3)" },
  { value: "ele", label: "Набор", dot: "var(--ele-4)" },
  { value: "int", label: "Интенсивность", dot: "var(--int-3)" }
];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const ZONE_LABELS = ["до 130", "130–150", "150–162", "162+"];
const FRESH_LABEL = { fresh: "свежий", neutral: "норма", productive: "↗ рост", overload: "перегруз" } as const;
const FRESH_CLASS = { fresh: "ds-pill-good", neutral: "ds-pill-soft", productive: "ds-pill-soft", overload: "ds-pill-danger" } as const;

function intensityShare(cell: Cell) {
  const total = cell.zone_seconds.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.round(((cell.zone_seconds[2]! + cell.zone_seconds[3]!) / total) * 100) : null;
}

// шаг шкалы по метрике и уровню: день — до 20 км, неделя — до 60, набор — до 700 м
function step(value: number, edges: number[]) {
  const index = edges.findIndex((edge) => value < edge);
  return index === -1 ? edges.length + 1 : index + 1;
}

function cellView(cell: Cell, metric: Metric, level: Level) {
  if (cell.workout_count === 0) return null;
  if (metric === "km") {
    const meters = level === "blocks" || level === "months" ? cell.weekly_distance_meters ?? cell.distance_meters : cell.distance_meters;
    const km = meters / 1000;
    const edges = level === "days" ? [5, 10, 15, 20] : [15, 30, 45, 60];
    return { text: km >= 10 ? String(Math.round(km)) : formatKm(meters), tone: `vol-${step(km, edges)}` };
  }
  if (metric === "ele") {
    const edges = level === "days" ? [30, 80, 150, 250] : [100, 250, 450, 700];
    return { text: String(Math.round(cell.elevation_gain)), tone: `ele-${step(cell.elevation_gain, edges)}` };
  }
  const share = intensityShare(cell);
  if (share === null) return { text: "—", tone: "int-none" };
  return { text: `${share}%`, tone: `int-${step(share, [15, 25, 35, 50])}` };
}

function periodHeader(period: { start: string; finish: string }, level: Level, index: number, count: number, short: boolean) {
  const start = new Date(period.start);
  if (level === "days") return short ? DAYS[index]! : `${DAYS[index]} ${start.getDate()}`;
  if (level === "months") return short ? MONTHS[start.getMonth()]! : MONTH_NAMES[start.getMonth()]!;
  if (index === count - 1) return level === "weeks" ? "эта" : "сейчас";
  const end = new Date(new Date(period.finish).getTime() - 86_400_000);
  const dm = (date: Date) => `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  return level === "weeks" || short ? dm(start) : `${dm(start)}–${dm(end)}`;
}

function periodTitle(period: { start: string; finish: string }, level: Level) {
  const start = new Date(period.start);
  const end = new Date(new Date(period.finish).getTime() - 86_400_000);
  if (level === "days") return `${DAYS[(start.getDay() + 6) % 7]}, ${start.getDate()} ${MONTHS[start.getMonth()]}`;
  if (level === "months") return `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
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
  const [selected, setSelected] = useState<{ athleteId: number; index: number } | null>(null);
  const [metricMenu, setMetricMenu] = useState(false);
  const isPhone = useIsPhone();
  const { data, loading, error } = useApi<HeatmapData>(`/api/trainer/group-heatmap?level=${level}`);

  useEffect(() => setSelected(null), [level]);

  const allPeriods = data?.periods ?? [];
  // на телефоне в «Неделях» — последние 5, на компьютере — 10
  const firstVisible = data && isPhone && level === "weeks" ? Math.max(allPeriods.length - 5, 0) : 0;
  const periods = allPeriods.slice(firstVisible);
  const currentIndex = periods.length - 1;
  const today = (new Date().getDay() + 6) % 7;
  const highlight = level === "days" ? today : currentIndex;
  const metricLabel = METRICS.find((item) => item.value === metric)!.label;

  const selectedAthlete = selected ? data?.athletes.find((athlete) => athlete.id === selected.athleteId) : null;
  const selectedCell = selectedAthlete && selected ? selectedAthlete.cells[selected.index + firstVisible] : null;
  const selectedPeriod = selected ? periods[selected.index] : null;

  const legendEdges =
    metric === "km"
      ? level === "days"
        ? "5 · 10 · 15 · 20+ км"
        : level === "weeks"
          ? "15 · 30 · 45 · 60+ км"
          : "15 · 30 · 45 · 60+ км в неделю"
      : metric === "ele"
        ? level === "days"
          ? "30 · 80 · 150 · 250+ м"
          : "100 · 250 · 450 · 700+ м"
        : "15 · 25 · 35 · 50%+ времени в зонах 150+";
  const rampPrefix = metric === "km" ? "vol" : metric === "ele" ? "ele" : "int";

  return (
    <section className="ds-block ds-pad heatmap" aria-label="Группа по периодам">
      <div className="hm-ctl">
        <div className="ds-seg hm-levels" role="group" aria-label="Период">
          {LEVELS.map((item) => (
            <button key={item.value} type="button" aria-pressed={level === item.value} onClick={() => setLevel(item.value)}>
              {isPhone ? item.short : item.label}
            </button>
          ))}
        </div>
        {isPhone ? (
          <div className="hm-metric-menu">
            <button type="button" className="hm-mbtn" aria-haspopup="menu" aria-expanded={metricMenu} onClick={() => setMetricMenu((open) => !open)}>
              {metricLabel}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {metricMenu ? (
              <div className="hm-menu" role="menu">
                {METRICS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={metric === item.value}
                    onClick={() => {
                      setMetric(item.value);
                      setMetricMenu(false);
                    }}
                  >
                    <i style={{ background: item.dot }} />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="hm-chips" role="group" aria-label="Что в ячейке">
            {METRICS.map((item) => (
              <button key={item.value} type="button" aria-pressed={metric === item.value} onClick={() => setMetric(item.value)}>
                <i style={{ background: item.dot }} />
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="skeleton-block" style={{ height: 240, borderRadius: 12 }} />
      ) : error || !data ? (
        <p className="ds-sub">{error || "Не удалось загрузить"}</p>
      ) : !data.athletes.length ? (
        <p className="ds-sub">В группе пока нет спортсменов.</p>
      ) : (
        <div className="hm-scroll">
          <table className="hm-table">
            <thead>
              <tr>
                <th style={{ width: isPhone ? (level === "days" ? 88 : 76) : 150 }} />
                {periods.map((period, index) => (
                  <th key={period.start} className={index === highlight ? "is-now" : undefined}>
                    {level === "days" && index === today && !isPhone ? "сегодня" : periodHeader(period, level, index + firstVisible, allPeriods.length, isPhone)}
                  </th>
                ))}
                {isPhone || level !== "weeks" ? null : <th className="hm-side hm-avg">ср. 4 нед</th>}
                {isPhone ? null : <th className="hm-side">Свежесть</th>}
              </tr>
            </thead>
            <tbody>
              {data.athletes.map((athlete) => {
                const weekMeters =
                  level === "days" ? athlete.cells.reduce((sum, cell) => sum + cell.distance_meters, 0) : null;
                return (
                  <tr key={athlete.id}>
                    <td className="hm-name">
                      <Link to={`/trainer/athletes/${athlete.id}`}>
                        <b>{athlete.full_name.split(" ")[0]}</b>
                        {weekMeters !== null && isPhone ? <span>{formatKm(weekMeters)} км</span> : null}
                      </Link>
                    </td>
                    {periods.map((period, index) => {
                      const cell = athlete.cells[index + firstVisible]!;
                      const future = level === "days" && index > today;
                      const view = future ? null : cellView(cell, metric, level);
                      const isSel = selected?.athleteId === athlete.id && selected.index === index;
                      const classes = [
                        "hm-c",
                        future ? "is-future" : view ? `t-${view.tone}` : level === "days" ? "is-rest" : "is-empty",
                        index === highlight ? "is-now" : "",
                        isSel ? "is-sel" : ""
                      ].join(" ");
                      return (
                        <td key={period.start}>
                          <button
                            type="button"
                            className={classes}
                            disabled={future}
                            onClick={() => setSelected(isSel ? null : { athleteId: athlete.id, index })}
                            aria-label={`${athlete.full_name}, ${periodTitle(period, level)}: ${view ? view.text : "нет пробежек"}`}
                          >
                            {future ? "" : view ? view.text : level === "days" ? (isPhone ? "—" : "отдых") : "—"}
                          </button>
                        </td>
                      );
                    })}
                    {isPhone || level !== "weeks" ? null : (
                      <td className="hm-side hm-avg">
                        {/* средний км за 4 последние полные недели — текущая ещё идёт */}
                        {(() => {
                          const average = athlete.cells.slice(-5, -1).reduce((sum, cell) => sum + cell.distance_meters, 0) / 4;
                          return average > 0 ? `${formatKm(average)} км` : "—";
                        })()}
                      </td>
                    )}
                    {isPhone ? null : (
                      <td className="hm-side">
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

      {selectedAthlete && selectedCell && selectedPeriod ? (
        <div className="hm-detail" role="status">
          <div className="hm-detail-head">
            <b>
              {selectedAthlete.full_name.split(" ")[0]} · {periodTitle(selectedPeriod, level)}
            </b>
            <button type="button" className="hm-close" onClick={() => setSelected(null)} aria-label="Закрыть">
              ×
            </button>
          </div>
          {selectedCell.workout_count ? (
            <>
              <div className="hm-detail-grid">
                <span>Объём</span>
                <b>
                  {formatKm(selectedCell.distance_meters)} км · {selectedCell.workout_count}{" "}
                  {selectedCell.workout_count === 1 ? "пробежка" : selectedCell.workout_count < 5 ? "пробежки" : "пробежек"}
                </b>
                <span>Набор</span>
                <b>{Math.round(selectedCell.elevation_gain)} м</b>
                <span>Время</span>
                <b>{formatDuration(Math.round(selectedCell.moving_time_seconds))}</b>
              </div>
              {selectedCell.zone_seconds.some((value) => value > 0) ? (
                <ZoneBar seconds={selectedCell.zone_seconds} />
              ) : null}
            </>
          ) : (
            <p className="ds-sub">Пробежек не было.</p>
          )}
          <Link
            className="ds-link"
            style={{ fontSize: 14 }}
            to={`/trainer/athletes/${selectedAthlete.id}?cycle=${level === "days" ? "week" : level === "months" ? "season" : level === "blocks" ? "blocks" : "week"}`}
          >
            Циклы спортсмена ›
          </Link>
        </div>
      ) : null}

      <div className="hm-legend">
        <span>
          Цвет
          <span className="hm-ramp" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((index) => (
              <i key={index} className={`t-${rampPrefix}-${index}`} />
            ))}
          </span>
          {legendEdges}
        </span>
        <span>Рамка — {level === "days" ? "сегодня" : "текущий период"} · нажмите на ячейку — подробности</span>
      </div>
    </section>
  );
}

function ZoneBar({ seconds }: { seconds: number[] }) {
  const total = seconds.reduce((sum, value) => sum + value, 0) || 1;
  const percents = seconds.map((value) => Math.round((value / total) * 100));
  return (
    <>
      <div className="ds-zbar" role="img" aria-label={percents.map((p, i) => `${ZONE_LABELS[i]} — ${p}%`).join(", ")}>
        {percents.map((p, i) => (p > 0 ? <i key={i} style={{ flex: p, background: `var(--hrz-${i + 1})` }} /> : null))}
      </div>
      <div className="ds-zleg">
        {percents.map((p, i) => (
          <span key={i}>
            <i style={{ background: `var(--hrz-${i + 1})` }} />
            {ZONE_LABELS[i]} · {p}%
          </span>
        ))}
      </div>
    </>
  );
}
