import { useState } from "react";
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

type WeeklyLoadRow = {
  week_start: string;
  load: number;
  acwr: number | null;
};

type TrendsData = {
  weekly: WeeklyRow[];
  aerobicPace: AerobicPaceRow[];
  aerobicHrRange: { low: number; high: number };
  records: DistanceRecord[];
  loadWeekly: WeeklyLoadRow[];
};

const ACWR_SAFE_LOW = 0.8;
const ACWR_SAFE_HIGH = 1.3;
const ACWR_DANGER = 1.5;

function acwrStatus(acwr: number | null) {
  if (acwr === null) {
    return null;
  }
  if (acwr > ACWR_DANGER) {
    return { label: "резкий скачок нагрузки — высокий риск", kind: "danger" as const };
  }
  if (acwr > ACWR_SAFE_HIGH) {
    return { label: "нагрузка растёт быстровато", kind: "warning" as const };
  }
  if (acwr < ACWR_SAFE_LOW) {
    return { label: "нагрузка ниже привычной", kind: "info" as const };
  }
  return { label: "нагрузка растёт безопасно", kind: "ok" as const };
}

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
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
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
        <div className="trend-bars">
          {weekly.map((week, index) => {
            const heightRatio = Math.max(week.distance_meters / ceiling, 0);
            const isCurrent = index === weekly.length - 1;
            // по умолчанию подписаны максимум и текущая неделя (если не соседи);
            // тап по столбику показывает его значение
            const showValue =
              selectedWeek !== null
                ? index === selectedWeek
                : week.distance_meters > 0 &&
                  (index === maxIndex || (isCurrent && Math.abs(index - maxIndex) > 1));
            return (
              <button
                type="button"
                key={week.week_start}
                className="trend-bar-slot"
                aria-label={`Неделя с ${formatWeekLabel(week.week_start)}: ${formatKm(week.distance_meters)} км, пробежек: ${week.runs}`}
                aria-pressed={selectedWeek === index}
                onClick={() => setSelectedWeek(selectedWeek === index ? null : index)}
              >
                {showValue ? <span className="trend-bar-value">{formatKm(week.distance_meters)}</span> : null}
                <span
                  className={isCurrent ? "trend-bar trend-bar-current" : "trend-bar"}
                  style={{ height: `${Math.max(heightRatio * 100, week.distance_meters > 0 ? 2 : 0)}%` }}
                />
              </button>
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
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
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
              <g
                key={row.month_start}
                className="trend-point-hit"
                role="button"
                aria-label={`${formatMonthLabel(row.month_start)}: ${formatPace(row.avg_speed)}, пробежек: ${row.runs}`}
                onClick={() => setSelectedMonth(selectedMonth === index ? null : index)}
              >
                {/* невидимая зона нажатия побольше самой точки */}
                <circle cx={point.x} cy={point.y} r="20" fill="transparent" />
                <circle cx={point.x} cy={point.y} r="5.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
              </g>
            );
          })}
        </svg>
        {points.map((point, index) => {
          const row = rows[index];
          // по умолчанию подписаны лучший и последний месяц; тап по точке — её значение
          const visible =
            selectedMonth !== null
              ? index === selectedMonth
              : index === bestIndex || index === rows.length - 1;
          if (!visible) {
            return null;
          }
          return (
            <span
              key={`label-${row.month_start}`}
              className="trend-point-label"
              style={{ left: `${(point.x / WIDTH) * 100}%`, top: `${(point.y / HEIGHT) * 100}%` }}
            >
              {formatPace(row.avg_speed)}
              {selectedMonth === index ? <em className="trend-point-runs"> · {row.runs} пробеж.</em> : null}
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

function TrainingLoadChart({ rows }: { rows: WeeklyLoadRow[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const maxLoad = Math.max(...rows.map((row) => row.load), 0);
  if (maxLoad <= 0) {
    return null;
  }

  const currentAcwr = rows[rows.length - 1]?.acwr ?? null;
  const status = acwrStatus(currentAcwr);

  const WIDTH = 600;
  const HEIGHT = 110;
  const acwrCeiling = Math.max(2, ...rows.map((row) => row.acwr ?? 0)) * 1.1;
  const yForAcwr = (value: number) => HEIGHT - (value / acwrCeiling) * (HEIGHT - 18);
  const xFor = (index: number) =>
    rows.length === 1 ? WIDTH / 2 : (index / (rows.length - 1)) * (WIDTH - 24) + 12;

  const acwrPoints = rows
    .map((row, index) => (row.acwr !== null ? { x: xFor(index), y: yForAcwr(row.acwr), index } : null))
    .filter((point): point is { x: number; y: number; index: number } => point !== null);
  const acwrPath = acwrPoints
    .map((point, i) => `${i === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");

  const selected = selectedIndex !== null ? rows[selectedIndex] : null;

  return (
    <div className="chart-card trend-load-card">
      <div className="chart-title-row">
        <span className="muted trainer-dashboard-eyebrow">Нагрузка и ACWR</span>
        <span className="muted chart-axis-caption">12 недель</span>
      </div>
      {status ? (
        <div className={`trend-acwr-status trend-acwr-${status.kind}`}>
          <strong>ACWR {currentAcwr?.toFixed(2)}</strong> · {status.label}
        </div>
      ) : (
        <div className="muted trend-acwr-status">ACWR появится, когда накопится месяц истории</div>
      )}
      <div className="trend-bars-plot trend-load-bars-plot">
        <div className="trend-bars trend-load-bars">
          {rows.map((row, index) => {
            const showValue =
              selectedIndex !== null
                ? index === selectedIndex
                : index === rows.length - 1 && row.load > 0;
            return (
              <button
                type="button"
                key={row.week_start}
                className="trend-bar-slot"
                aria-label={`Неделя с ${formatWeekLabel(row.week_start)}: нагрузка ${row.load}${row.acwr !== null ? `, ACWR ${row.acwr.toFixed(2)}` : ""}`}
                aria-pressed={selectedIndex === index}
                onClick={() => setSelectedIndex(selectedIndex === index ? null : index)}
              >
                {showValue ? (
                  <span className="trend-bar-value">
                    {row.load}
                    {selectedIndex === index && row.acwr !== null ? ` · ${row.acwr.toFixed(2)}` : ""}
                  </span>
                ) : null}
                <span
                  className="trend-bar trend-load-bar"
                  style={{ height: `${Math.max((row.load / maxLoad) * 100, row.load > 0 ? 2 : 0)}%` }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="trend-acwr-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="trend-line-svg" role="img" aria-label="Линия ACWR по неделям с безопасным коридором">
          <rect
            x="0"
            y={yForAcwr(ACWR_SAFE_HIGH)}
            width={WIDTH}
            height={Math.max(yForAcwr(ACWR_SAFE_LOW) - yForAcwr(ACWR_SAFE_HIGH), 0)}
            className="trend-acwr-corridor"
          />
          {acwrPath ? (
            <>
              <path d={acwrPath} fill="none" stroke="rgba(255,255,255,0.86)" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
              <path d={acwrPath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </>
          ) : null}
          {acwrPoints.map((point) => {
            const row = rows[point.index];
            const overLimit = (row.acwr ?? 0) > ACWR_DANGER;
            return (
              <circle
                key={row.week_start}
                cx={point.x}
                cy={point.y}
                r={overLimit ? 5 : 3.5}
                fill={overLimit ? "var(--danger)" : "var(--accent)"}
                stroke="var(--surface)"
                strokeWidth="1.5"
              />
            );
          })}
        </svg>
        {selected && selected.acwr !== null && selectedIndex !== null ? (
          <span
            className="trend-point-label"
            style={{
              left: `${(xFor(selectedIndex) / WIDTH) * 100}%`,
              top: `${(yForAcwr(selected.acwr) / HEIGHT) * 100}%`
            }}
          >
            {selected.acwr.toFixed(2)}
          </span>
        ) : null}
      </div>
      <div className="trend-bars-labels" aria-hidden="true">
        {rows.map((row, index) => (
          <span key={row.week_start} className="trend-bar-label">
            {index % 2 === (rows.length - 1) % 2 ? formatWeekLabel(row.week_start) : ""}
          </span>
        ))}
      </div>
      <div className="muted trend-footnote">
        Столбцы — недельная нагрузка (минуты в пульсовых зонах × вес зоны). Линия — отношение
        нагрузки недели к средней за 4 недели: коридор 0.8–1.3 безопасен, выше 1.5 — риск травмы.
      </div>
    </div>
  );
}

type AthleteTrendsProps = {
  // без athleteId — собственный кабинет атлета; с athleteId — взгляд тренера
  athleteId?: number;
};

export function AthleteTrends({ athleteId }: AthleteTrendsProps) {
  const endpoint = athleteId != null ? `/api/trainer/athletes/${athleteId}/trends` : "/api/athlete/trends";
  const workoutBase = athleteId != null ? "/trainer/workouts" : "/athlete/workouts";
  const { data, loading, error } = useApi<TrendsData>(endpoint);

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
        <>
        <div className="trend-records">
          {data.records.map((record) => (
            <Link
              key={record.target_meters}
              className="trend-record"
              to={`${workoutBase}/${record.workout_id}`}
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
        <div className="muted trend-records-note">
          Лучший непрерывный отрезок ровно этой длины внутри тренировки — может быть на секунды
          быстрее официального времени забега.
        </div>
        </>
      ) : null}
      <div className="trends-grid">
        <WeeklyDistanceChart weekly={data.weekly} />
        <AerobicPaceChart rows={data.aerobicPace} hrRange={data.aerobicHrRange} />
      </div>
      <TrainingLoadChart rows={data.loadWeekly ?? []} />
    </section>
  );
}
