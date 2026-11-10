import { medianFilter, quantile, smoothSeries } from "../chart/chart-utils";
import type { WorkoutData } from "../types/workout";

// «Разбор»: один главный график по типу пробежки (отчёт «Страница тренера и клуба»):
// интервалы — столбики темпа по рабочим отрезкам, пульс в конце каждого;
// ровный бег от 25 минут — две низкие линии темпа и пульса по дистанции + дрейф пульса;
// короткий лёгкий бег — графика нет, хватает зон. Сверху — вывод одной фразой.

function pace(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// пульс в конце отрезка: максимум за последнюю треть отрезка по потоку
function endHeartRate(
  lap: WorkoutData["laps"][number],
  streams: WorkoutData["streams"],
) {
  const hr = streams?.heartrate ?? [];
  if (
    lap.start_index != null &&
    lap.end_index != null &&
    hr.length > lap.end_index
  ) {
    const from = Math.round(
      lap.start_index + (lap.end_index - lap.start_index) * 0.66,
    );
    const slice = hr
      .slice(from, lap.end_index + 1)
      .filter((value) => value > 40);
    if (slice.length) return Math.round(Math.max(...slice));
  }
  return lap.average_heartrate ? Math.round(lap.average_heartrate) : null;
}

function RepBars({
  laps,
  streams,
  structure,
}: {
  laps: WorkoutData["laps"];
  streams: WorkoutData["streams"];
  structure: WorkoutData["structure"];
}) {
  // серия отрезка (6×400 и 1000 м — разные серии): разброс и цвет считаем внутри серии
  const setOf = new Map<number, number>();
  structure?.segments.forEach((segment) =>
    segment.lap_ids.forEach((id) => setOf.set(id, segment.set_index)),
  );
  const reps = laps
    .map((lap) => ({
      pace: lap.average_speed ? 1000 / lap.average_speed : null,
      hr: endHeartRate(lap, streams),
      set: setOf.get(lap.id) ?? 0,
      seconds: lap.average_speed
        ? Math.min(
            lap.distance_meters / lap.average_speed,
            lap.elapsed_time_seconds,
          )
        : lap.elapsed_time_seconds,
    }))
    .filter(
      (
        rep,
      ): rep is {
        pace: number;
        hr: number | null;
        set: number;
        seconds: number;
      } => rep.pace !== null && rep.pace > 120 && rep.pace < 900,
    );
  const byTime = (setIndex: number) =>
    Boolean(structure?.sets[setIndex]?.by_time);
  const dur = (seconds: number) => {
    const t = Math.round(seconds);
    return t < 60
      ? `${t} с`
      : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  };
  if (reps.length < 2) return null;
  const fast = Math.min(...reps.map((rep) => rep.pace));
  const slow = Math.max(...reps.map((rep) => rep.pace));
  const spread = slow - fast;
  const hrs = reps
    .map((rep) => rep.hr)
    .filter((value): value is number => value !== null);
  const setIds = [...new Set(reps.map((rep) => rep.set))];
  const sets = setIds.map((id) => {
    const items = reps.filter((rep) => rep.set === id);
    const label =
      structure?.sets[id]?.label ||
      (items.length > 1 ? `${items.length} отрезков` : "отрезок");
    const lo = Math.min(...items.map((rep) => rep.pace));
    const hi = Math.max(...items.map((rep) => rep.pace));
    return { id, items, label, lo, hi };
  });
  const main = sets.slice().sort((a, b) => b.items.length - a.items.length)[0]!;
  const setText = (set: (typeof sets)[number]) => {
    if (byTime(set.id)) {
      const lo = Math.min(...set.items.map((rep) => rep.seconds));
      const hi = Math.max(...set.items.map((rep) => rep.seconds));
      return set.items.length < 2
        ? `${set.label}`
        : `${set.label}: ${dur(lo)}–${dur(hi)}`;
    }
    return setTextPace(set);
  };
  const setTextPace = (set: (typeof sets)[number]) =>
    set.items.length < 2
      ? `${set.label} — ${pace(set.lo)} /км`
      : `${set.label}: ${pace(set.lo)}–${pace(set.hi)} /км${set.hi - set.lo <= 8 ? ", ровно" : `, разброс ${Math.round(set.hi - set.lo)} с`}`;
  const mainHr = main.items
    .map((rep) => rep.hr)
    .filter((value): value is number => value !== null);
  const conclusion =
    (sets.length > 1 ? sets.map(setText).join(". ") : setText(main)) +
    "." +
    (mainHr.length >= 2
      ? ` Пульс в конце${sets.length > 1 ? ` (${main.label})` : ""}: ${mainHr[0]} → ${mainHr[mainHr.length - 1]}.`
      : "");
  void hrs;

  const W = 320;
  const base = 104;
  const top = 22;
  // быстрее — выше; шкала от «медленнее самого медленного на 10 с» до самого быстрого
  const lo = slow + Math.max(10, spread * 0.6);
  const height = (value: number) => ((lo - value) / (lo - fast)) * (base - top);
  const gap = reps.length > 10 ? 3 : 6;
  const bw = (W - 8 - gap * (reps.length - 1)) / reps.length;
  const showLabels = bw >= 22;
  return (
    <>
      <p className="rv-concl">{conclusion}</p>
      <svg
        className="rv-chart"
        viewBox={`0 0 ${W} ${base + 18}`}
        role="img"
        aria-label={`Темп по отрезкам: ${reps.map((rep) => pace(rep.pace)).join(", ")} /км`}
      >
        {reps.map((rep, index) => {
          const x = 4 + index * (bw + gap);
          const h = Math.max(height(rep.pace), 6);
          return (
            <g key={index}>
              <rect
                x={x}
                y={base - h}
                width={bw}
                height={h}
                rx={4}
                className={`rv-bar s${setIds.indexOf(rep.set) % 3}`}
              />
              {showLabels ? (
                <text
                  x={x + bw / 2}
                  y={base - h - 5}
                  textAnchor="middle"
                  className="rv-lbl"
                >
                  {byTime(rep.set) ? dur(rep.seconds) : pace(rep.pace)}
                </text>
              ) : null}
              {showLabels && rep.hr && h > 20 ? (
                <text
                  x={x + bw / 2}
                  y={base - 7}
                  textAnchor="middle"
                  className="rv-hr"
                >
                  {rep.hr}
                </text>
              ) : null}
              <text
                x={x + bw / 2}
                y={base + 14}
                textAnchor="middle"
                className="rv-cap"
              >
                {index + 1}
              </text>
            </g>
          );
        })}
        <line x1={2} x2={W - 2} y1={base} y2={base} className="rv-axis" />
      </svg>
      <p className="rv-note">
        {setIds.some((id) => byTime(id)) ? "Над столбиком — время отрезка (без GPS), " : "Столбик — темп отрезка, "}цифра внутри — пульс в конце.
      </p>
    </>
  );
}

// поток → по 100 м: темп и средний пульс
function byDistance(streams: WorkoutData["streams"]) {
  const d = streams?.distance ?? [];
  const t = streams?.time ?? [];
  const hr = streams?.heartrate ?? [];
  const out: { km: number; pace: number; hr: number | null }[] = [];
  let start = 0;
  for (let i = 1; i < d.length; i += 1) {
    if (d[i]! - d[start]! >= 100) {
      const dt = t[i]! - t[start]!;
      const dd = d[i]! - d[start]!;
      const slice = hr.slice(start, i + 1).filter((value) => value > 40);
      out.push({
        km: d[i]! / 1000,
        pace: (dt / dd) * 1000,
        hr: slice.length
          ? slice.reduce((a, b) => a + b, 0) / slice.length
          : null,
      });
      start = i;
    }
  }
  return out;
}

function SteadyLines({ streams }: { streams: WorkoutData["streams"] }) {
  const points = byDistance(streams).filter(
    (point) => point.pace > 150 && point.pace < 720,
  );
  if (points.length < 20) return null;
  const paces = smoothSeries(
    medianFilter(
      points.map((point) => point.pace),
      5,
    ),
    5,
  );
  const hrsRaw = points.map((point) => point.hr);
  const hasHr =
    hrsRaw.filter((value) => value !== null).length > points.length * 0.8;
  const hrs = hasHr
    ? smoothSeries(
        medianFilter(
          hrsRaw.map((value) => value ?? 0),
          5,
        ),
        5,
      )
    : [];
  // дрейф: отношение пульса к скорости во второй половине против первой (Pa:HR)
  let drift: number | null = null;
  if (hasHr) {
    const half = Math.floor(points.length / 2);
    const eff = (from: number, to: number) => {
      const slice = points.slice(from, to).filter((point) => point.hr);
      const speed =
        slice.reduce((sum, point) => sum + 1000 / point.pace, 0) / slice.length;
      const hr =
        slice.reduce((sum, point) => sum + point.hr!, 0) / slice.length;
      return speed / hr;
    };
    drift = Math.round(
      ((eff(0, half) - eff(half, points.length)) / eff(0, half)) * 100,
    );
  }
  const pLo = quantile(paces, 0.05);
  const pHi = quantile(paces, 0.95);
  const W = 320;
  const H = 46;
  const n = paces.length;
  const x = (i: number) => 4 + (i * (W - 8)) / (n - 1);
  const pathOf = (
    values: number[],
    lo: number,
    hi: number,
    y0: number,
    invert: boolean,
  ) =>
    values
      .map((value, i) => {
        const clamped = Math.min(Math.max(value, lo), hi);
        const t = (clamped - lo) / (hi - lo || 1);
        return `${i ? "L" : "M"}${x(i).toFixed(1)},${(y0 + (invert ? t : 1 - t) * H).toFixed(1)}`;
      })
      .join(" ");
  const hLo = hasHr ? quantile(hrs, 0.05) - 2 : 0;
  const hHi = hasHr ? quantile(hrs, 0.95) + 2 : 1;
  const spread = pHi - pLo;
  const conclusion =
    (spread <= 20
      ? "Темп ровный"
      : spread <= 45
        ? "Темп немного гулял"
        : "Темп неровный") +
    ` (${pace(pLo)}–${pace(pHi)} /км)` +
    (drift !== null
      ? `. Дрейф пульса ${Math.max(drift, 0)}%${drift <= 5 ? " — в норме" : " — пульс заметно рос"}.`
      : ".");
  const total = points[points.length - 1]!.km;
  return (
    <>
      <p className="rv-concl">{conclusion}</p>
      <svg
        className="rv-chart"
        viewBox={`0 0 ${W} ${hasHr ? 150 : 82}`}
        role="img"
        aria-label={conclusion}
      >
        <text x={4} y={10} className="rv-cap">
          темп /км
        </text>
        <path d={pathOf(paces, pLo, pHi, 16, true)} className="rv-pace" />
        {hasHr ? (
          <>
            <text x={4} y={82} className="rv-cap">
              пульс
            </text>
            <path d={pathOf(hrs, hLo, hHi, 88, false)} className="rv-hrl" />
          </>
        ) : null}
        <text x={4} y={hasHr ? 148 : 80} className="rv-cap">
          0 км
        </text>
        <text
          x={W - 4}
          y={hasHr ? 148 : 80}
          className="rv-cap"
          textAnchor="end"
        >
          {total.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км
        </text>
      </svg>
    </>
  );
}

export function ReviewChart({
  workout,
  workLaps,
}: {
  workout: WorkoutData;
  workLaps: WorkoutData["laps"];
}) {
  if (workLaps.length >= 2) {
    return (
      <section className="ds-block ds-pad rv" aria-label="Отрезки">
        <RepBars
          laps={workLaps}
          streams={workout.streams}
          structure={workout.structure}
        />
      </section>
    );
  }
  if (workout.workout.moving_time_seconds >= 25 * 60) {
    const lines = <SteadyLines streams={workout.streams} />;
    return (
      <section className="ds-block ds-pad rv" aria-label="Темп и пульс">
        {lines}
      </section>
    );
  }
  return null;
}
