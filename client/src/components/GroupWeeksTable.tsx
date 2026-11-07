import { Link } from "react-router-dom";

import { formatKm, pluralRu } from "../lib";
import { UserAvatar } from "./UserAvatar";

export type GroupWeeksAthlete = {
  id: number;
  fullName: string;
  avatarUrl: string | null;
  lastWorkoutAt: string | null;
  distances: number[];
};

// Шкала километража за неделю: пустая неделя отдельно, дальше 5 ступеней одного тона
const LEVELS_KM = [10, 20, 35, 50];
const STALE_DAYS = 5;

function levelClass(meters: number) {
  if (meters <= 0) return "is-zero";
  const km = meters / 1000;
  const level = LEVELS_KM.findIndex((limit) => km < limit);
  return `is-l${level === -1 ? 5 : level + 1}`;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

// Текущая неделя ещё идёт — сравниваем только законченные:
// последние 4 законченные недели против 4 предыдущих
function summarize(distances: number[]) {
  const finished = distances.slice(0, -1);
  const recent = finished.slice(-4);
  const prior = finished.slice(-8, -4);
  const recentAvg = average(recent);
  const priorAvg = average(prior);
  const trend = priorAvg > 0 ? Math.round((recentAvg / priorAvg - 1) * 100) : null;
  return { recentAvg, trend };
}

function daysSince(value: string | null) {
  if (!value) return null;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

function lastRunLabel(days: number | null) {
  if (days === null) return "ещё не бегал(а)";
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${days} ${pluralRu(days, "день", "дня", "дней")} назад`;
}

function weekLabel(iso: string) {
  const date = new Date(iso);
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function TrendValue({ trend }: { trend: number | null }) {
  if (trend === null) return <span className="muted">—</span>;
  const className = trend > 5 ? "trend is-up" : trend < -5 ? "trend is-down" : "trend";
  const arrow = trend > 0 ? "↑ +" : trend < 0 ? "↓ " : "";
  return <span className={className}>{`${arrow}${trend}%`}</span>;
}

function LastRun({ days }: { days: number | null }) {
  const label = lastRunLabel(days);
  return days === null || days >= STALE_DAYS ? <span className="pill-warn">{label}</span> : <>{label}</>;
}

export function GroupWeeksTable({ weekStarts, athletes }: { weekStarts: string[]; athletes: GroupWeeksAthlete[] }) {
  const lastIndex = weekStarts.length - 1;

  return (
    <section className="panel group-weeks">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Группа по неделям</h2>
          <p className="panel-hint">
            Километраж за {weekStarts.length} {pluralRu(weekStarts.length, "неделю", "недели", "недель")}. Красная рамка —
            текущая неделя, она ещё идёт
          </p>
        </div>
        <div className="heat-legend" aria-hidden="true">
          0 <i className="heat-swatch is-zero" />
          <i className="heat-swatch is-l1" />
          <i className="heat-swatch is-l2" />
          <i className="heat-swatch is-l3" />
          <i className="heat-swatch is-l4" />
          <i className="heat-swatch is-l5" /> 50+ км
        </div>
      </div>

      {athletes.length === 0 ? (
        <p className="empty">Спортсменов пока нет — их назначает тренеру администратор.</p>
      ) : (
        <>
          <div className="group-weeks-scroll">
            <table className="group-weeks-table">
              <thead>
                <tr>
                  <th scope="col" className="is-left">Спортсмен</th>
                  {weekStarts.map((week, index) => (
                    <th scope="col" key={week} className={index === lastIndex ? "is-current" : undefined}>
                      {index === lastIndex ? "эта" : weekLabel(week)}
                    </th>
                  ))}
                  <th scope="col">Ср. 4 нед</th>
                  <th scope="col">Тренд</th>
                  <th scope="col" className="is-left">Последняя</th>
                </tr>
              </thead>
              <tbody>
                {athletes.map((athlete) => {
                  const { recentAvg, trend } = summarize(athlete.distances);
                  const total = athlete.distances.reduce((sum, value) => sum + value, 0);
                  return (
                    <tr key={athlete.id}>
                      <th scope="row" className="is-left">
                        <Link to={`/trainer/athletes/${athlete.id}`} className="group-athlete">
                          <UserAvatar fullName={athlete.fullName} avatarUrl={athlete.avatarUrl} className="avatar-sm" ariaHidden />
                          <span>
                            <strong>{athlete.fullName}</strong>
                            <small>{formatKm(total, 0)} км за {athlete.distances.length} нед</small>
                          </span>
                        </Link>
                      </th>
                      {athlete.distances.map((meters, index) => (
                        <td key={weekStarts[index] ?? index}>
                          <span
                            className={`heat-cell num ${levelClass(meters)}${index === lastIndex ? " is-current" : ""}`}
                            title={`${index === lastIndex ? "Эта неделя" : `Неделя с ${weekLabel(weekStarts[index])}`}: ${formatKm(meters)} км`}
                          >
                            {meters > 0 ? formatKm(meters) : "—"}
                          </span>
                        </td>
                      ))}
                      <td className="group-stat num">{formatKm(recentAvg)}</td>
                      <td className="group-stat num">
                        <TrendValue trend={trend} />
                      </td>
                      <td className="group-last is-left">
                        <LastRun days={daysSince(athlete.lastWorkoutAt)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="group-weeks-list">
            {athletes.map((athlete) => {
              const { recentAvg, trend } = summarize(athlete.distances);
              return (
                <li key={athlete.id}>
                  <Link to={`/trainer/athletes/${athlete.id}`} className="group-card">
                    <div className="group-card-top">
                      <UserAvatar fullName={athlete.fullName} avatarUrl={athlete.avatarUrl} className="avatar-sm" ariaHidden />
                      <span className="group-card-name">
                        <strong>{athlete.fullName}</strong>
                        <small>
                          <LastRun days={daysSince(athlete.lastWorkoutAt)} />
                        </small>
                      </span>
                      <span className="group-card-stat num">
                        {formatKm(recentAvg)} км
                        <small>
                          <TrendValue trend={trend} />
                        </small>
                      </span>
                    </div>
                    <div className="group-card-strip">
                      {athlete.distances.map((meters, index) => (
                        <span
                          key={weekStarts[index] ?? index}
                          className={`heat-cell num ${levelClass(meters)}${index === lastIndex ? " is-current" : ""}`}
                        >
                          {meters > 0 ? Math.round(meters / 1000) : "—"}
                        </span>
                      ))}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
