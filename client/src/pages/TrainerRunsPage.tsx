import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { UserAvatar } from "../components/UserAvatar";
import { useApi } from "../hooks/useApi";
import { formatDuration, formatKm, formatPace } from "../lib";
import { intensityPercent } from "../lib-hrzones";

// Пробежки за период — сюда ведёт тап по клетке (один спортсмен) или по шапке колонки (весь клуб)
// тепловой карты. Сверху — итог периода теми же метриками, что в карте, ниже — список.
type Run = {
  id: number;
  name: string;
  start_date: string;
  athlete_id: number;
  athlete_name: string;
  avatar_url: string | null;
  distance_meters: number;
  moving_time_seconds: number;
  elevation_gain: number;
  zone_seconds: number[] | null;
};

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

function periodLabel(from: Date, to: Date) {
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (days <= 1) return `${WEEKDAYS[from.getDay()]}, ${from.getDate()} ${MONTHS_GEN[from.getMonth()]}`;
  if (days >= 28 && from.getDate() === 1) return `${MONTH_NAMES[from.getMonth()]} ${from.getFullYear()}`;
  const last = new Date(to.getTime() - 86_400_000);
  return from.getMonth() === last.getMonth()
    ? `${from.getDate()}–${last.getDate()} ${MONTHS_GEN[last.getMonth()]}`
    : `${from.getDate()} ${MONTHS_GEN[from.getMonth()]} – ${last.getDate()} ${MONTHS_GEN[last.getMonth()]}`;
}

function dayTime(value: string) {
  const date = new Date(value);
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${date.getDate()} ${MONTHS_GEN[date.getMonth()]} · ${time}`;
}

export function TrainerRunsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const athlete = params.get("athlete");
  const url = from && to ? `/api/trainer/runs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${athlete ? `&athlete=${athlete}` : ""}` : null;
  const { data, loading, error } = useApi<{ runs: Run[] }>(url);
  const runs = data?.runs ?? [];
  const name = athlete ? runs[0]?.athlete_name.split(" ")[0] : null;

  const total = runs.reduce(
    (acc, run) => {
      acc.m += run.distance_meters;
      acc.s += run.moving_time_seconds;
      acc.e += run.elevation_gain;
      run.zone_seconds?.forEach((value, index) => (acc.z[index]! += value));
      return acc;
    },
    { m: 0, s: 0, e: 0, z: [0, 0, 0, 0, 0] }
  );
  const intensity = intensityPercent(total.z);

  return (
    <div className="page runs-period">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        Назад
      </button>
      <header className="rp-head">
        <h1>{athlete ? (name ?? "Пробежки") : "Пробежки клуба"}</h1>
        <p>{from && to ? periodLabel(new Date(from), new Date(to)) : ""}</p>
      </header>

      {loading && !data ? (
        <div className="skeleton-block" style={{ height: 220, borderRadius: 16 }} />
      ) : error ? (
        <p className="ds-sub">{error}</p>
      ) : !runs.length ? (
        <section className="ds-block ds-pad">
          <p className="ds-sub">В эти даты пробежек нет.</p>
        </section>
      ) : (
        <>
          <section className="ds-block ds-pad">
            <div className="workout-stats-row rp-sum">
              <div>
                <span>км</span>
                <b>{formatKm(total.m)}</b>
              </div>
              <div>
                <span>пробежек</span>
                <b>{runs.length}</b>
              </div>
              <div>
                <span>набор, м</span>
                <b>{Math.round(total.e)}</b>
              </div>
              <div>
                <span>интенсивность</span>
                <b>{intensity === null ? "—" : `${intensity}%`}</b>
              </div>
            </div>
          </section>
          <section className="ds-block">
            <ul className="ds-list rp-list">
              {runs.map((run) => {
                const share = run.zone_seconds ? intensityPercent(run.zone_seconds) : null;
                return (
                  <li key={run.id}>
                    <Link className="ds-li rp-row" to={`/trainer/workouts/${run.id}`}>
                      {athlete ? null : <UserAvatar fullName={run.athlete_name} avatarUrl={run.avatar_url} className="rp-av" />}
                      <div className="rp-main">
                        <b>{athlete ? run.name : run.athlete_name.split(" ")[0]}</b>
                        <span>
                          {athlete ? dayTime(run.start_date) : `${run.name} · ${dayTime(run.start_date)}`}
                        </span>
                      </div>
                      <div className="rp-num">
                        <b>{formatKm(run.distance_meters)}</b>
                        <span>
                          {run.moving_time_seconds > 0 && run.distance_meters > 0
                            ? formatPace(run.distance_meters / run.moving_time_seconds).replace("/км", "")
                            : formatDuration(Math.round(run.moving_time_seconds))}
                          {share !== null ? ` · ${share}%` : ""}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
