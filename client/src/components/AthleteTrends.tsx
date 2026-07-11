import { Link } from "react-router-dom";

import { useApi } from "../hooks/useApi";
import { formatPace } from "../lib";

type WeeklyRow = {
  week_start: string;
  distance_meters: number;
  runs: number;
};

type AerobicPaceRow = {
  month_start: string;
  avg_speed: number;
  runs: number;
};

type DistanceRecord = {
  target_meters: number;
  seconds: number;
  workout_id: number;
  workout_name: string;
  start_date: string;
};

type TrendsData = {
  weekly: WeeklyRow[];
  aerobicPace: AerobicPaceRow[];
  aerobicHrRange: { low: number; high: number };
  records: DistanceRecord[];
};

const MONTH_LABELS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function formatWeekLabel(weekStart: string) {
  const date = new Date(`${weekStart}T00:00:00`);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthStart: string) {
  const date = new Date(`${monthStart}T00:00:00`);
  return MONTH_LABELS[date.getMonth()] ?? monthStart;
}

function formatRecordTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatRecordDistance(meters: number) {
  return meters >= 1000 ? `${meters / 1000} км` : `${meters} м`;
}

function formatKm(meters: number) {
  const km = meters / 1000;
  return km >= 100 ? String(Math.round(km)) : km.toFixed(1);
}

function WeeklyDistanceChart({ weekly }: { weekly: WeeklyRow[] }) {
  const maxDistance = Math.max(...weekly.map((week) => week.distance_meters), 0);
  if (maxDistance <= 0) {
    return (
      <div className="chart-card">
        <div className="chart-title-row">
          <span className="muted trainer-dashboard-eyebrow">Километраж по неделям</span>
        </div>
        <div className="chart-empty muted">Появится после первых синхронизированных пробежек.</div>
      </div>
    );
  }

  // круглый потолок оси: 5/10/25/50 км
  const step = maxDistance > 60000 ? 25000 : maxDistance > 25000 ? 10000 : 5000;
  const ceiling = Math.max(step, Math.ceil(maxDistance / step) * step);
  const maxIndex = weekly.reduce(
    (best, week, index) => (week.distance_meters > weekly[best].distance_meters ? index : best),
    0
  );

  return (
    <div className="chart-card">
      <div className="chart-title-row">
        <span className="muted trainer-dashboard-eyebrow">Километраж по неделям</span>
        <span className="muted chart-axis-caption">км за неделю · 12 недель</span>
      </div>
      <div className="trend-bars-plot">
        <div className="trend-bars-grid" aria-hidden="true">
          {[1, 0.5, 0].map((ratio) => (
            <div key={ratio} className="trend-grid-row">
              <span className="trend-grid-label">{formatKm(ceiling * ratio)}</span>
              <span className="trend-grid-line" />
            </div>
          ))}
        </div>
        <div className="trend-bars" role="img" aria-label="Столбчатый график: километраж по неделям">
          {weekly.map((week, index) => {
            const heightRatio = Math.max(week.distance_meters / ceiling, 0);
            const isCurrent = index === weekly.length - 1;
            // подписи максимума и текущей недели; соседние сливаются — оставляем максимум
            const showValue =
              week.distance_meters > 0 &&
              (index === maxIndex || (isCurrent && Math.abs(index - maxIndex) > 1));
            return (
              <div key={week.week_start} className="trend-bar-slot">
                {showValue ? <span className="trend-bar-value">{formatKm(week.distance_meters)}</span> : null}
                <div
                  className={isCurrent ? "trend-bar trend-bar-current" : "trend-bar"}
                  style={{ height: `${Math.max(heightRatio * 100, week.distance_meters > 0 ? 2 : 0)}%` }}
                  title={`Неделя с ${formatWeekLabel(week.week_start)}: ${formatKm(week.distance_meters)} км · пробежек: ${week.runs}`}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="trend-bars-labels" aria-hidden="true">
        {weekly.map((week, index) => (
          <span key={week.week_start} className="trend-bar-label">
            {index % 2 === (weekly.length - 1) % 2 ? formatWeekLabel(week.week_start) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function AerobicPaceChart({
  rows,
  hrRange
}: {
  rows: AerobicPaceRow[];
  hrRange: { low: number; high: number };
}) {
  const caption = `пульс ${hrRange.low}–${hrRange.high} · 6 месяцев`;

  if (rows.length < 2) {
    return (
      <div className="chart-card">
        <div className="chart-title-row">
          <span className="muted trainer-dashboard-eyebrow">Аэробный темп</span>
          <span className="muted chart-axis-caption">{caption}</span>
        </div>
        <div className="chart-empty muted">
          Нужно минимум два месяца со спокойными пробежками (пульс {hrRange.low}–{hrRange.high}),
          чтобы построить тренд.
        </div>
      </div>
    );
  }

  const WIDTH = 600;
  const HEIGHT = 200;
  const PAD_X = 34;
  const PAD_Y = 30;

  const paces = rows.map((row) => 1000 / row.avg_speed); // сек/км
  const minPace = Math.min(...paces);
  const maxPace = Math.max(...paces);
  const span = Math.max(maxPace - minPace, 20);
  const mid = (minPace + maxPace) / 2;
  const top = mid - span * 0.75;
  const bottom = mid + span * 0.75;

  // быстрее (меньше сек/км) — выше
  const yFor = (pace: number) => PAD_Y + ((pace - top) / (bottom - top)) * (HEIGHT - PAD_Y * 2);
  const xFor = (index: number) =>
    rows.length === 1 ? WIDTH / 2 : PAD_X + (index / (rows.length - 1)) * (WIDTH - PAD_X * 2);

  const points = rows.map((row, index) => ({ x: xFor(index), y: yFor(paces[index]), pace: paces[index] }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const bestIndex = paces.indexOf(minPace);

  return (
    <div className="chart-card">
      <div className="chart-title-row">
        <span className="muted trainer-dashboard-eyebrow">Аэробный темп</span>
        <span className="muted chart-axis-caption">{caption}</span>
      </div>
      {/* подписи — HTML поверх svg, чтобы не масштабировались вместе с графикой */}
      <div className="trend-line-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="trend-line-svg" role="img" aria-label="Линия тренда аэробного темпа по месяцам">
          <path d={linePath} fill="none" stroke="rgba(255,255,255,0.86)" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
          <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {points.map((point, index) => {
            const row = rows[index];
            return (
              <circle key={row.month_start} cx={point.x} cy={point.y} r="5.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2">
                <title>{`${formatMonthLabel(row.month_start)}: ${formatPace(row.avg_speed)} · пробежек: ${row.runs}`}</title>
              </circle>
            );
          })}
        </svg>
        {points.map((point, index) => {
          const row = rows[index];
          if (index !== bestIndex && index !== rows.length - 1) {
            return null;
          }
          return (
            <span
              key={`label-${row.month_start}`}
              className="trend-point-label"
              style={{ left: `${(point.x / WIDTH) * 100}%`, top: `${(point.y / HEIGHT) * 100}%` }}
            >
              {formatPace(row.avg_speed)}
            </span>
          );
        })}
      </div>
      <div className="trend-months" aria-hidden="true">
        {points.map((point, index) => (
          <span
            key={`month-${rows[index].month_start}`}
            className="trend-month-label"
            style={{ left: `${(point.x / WIDTH) * 100}%` }}
          >
            {formatMonthLabel(rows[index].month_start)}
          </span>
        ))}
      </div>
      <div className="muted trend-footnote">
        Средний темп спокойных пробежек (от 3 км, пульс в аэробной зоне). Рост линии — экономичность
        улучшается.
      </div>
    </div>
  );
}

export function AthleteTrends() {
  const { data, loading, error } = useApi<TrendsData>("/api/athlete/trends");

  if (loading || error || !data) {
    return null;
  }

  const hasAnything =
    data.records.length > 0 ||
    data.weekly.some((week) => week.distance_meters > 0) ||
    data.aerobicPace.length > 0;
  if (!hasAnything) {
    return null;
  }

  return (
    <section className="card trainer-dashboard-list-section">
      <div className="trainer-dashboard-heading">
        <span className="muted trainer-dashboard-eyebrow">Тренды</span>
      </div>
      {data.records.length > 0 ? (
        <div className="trend-records">
          {data.records.map((record) => (
            <Link
              key={record.target_meters}
              className="trend-record"
              to={`/athlete/workouts/${record.workout_id}`}
              title={`${record.workout_name} · ${new Date(record.start_date).toLocaleDateString("ru-RU")}`}
            >
              <span className="muted">Лучшие {formatRecordDistance(record.target_meters)}</span>
              <strong>{formatRecordTime(record.seconds)}</strong>
              <span className="muted trend-record-date">
                {new Date(record.start_date).toLocaleDateString("ru-RU")}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
      <div className="trends-grid">
        <WeeklyDistanceChart weekly={data.weekly} />
        <AerobicPaceChart rows={data.aerobicPace} hrRange={data.aerobicHrRange} />
      </div>
    </section>
  );
}
