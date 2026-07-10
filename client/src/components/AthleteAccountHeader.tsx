import { type ReactNode } from "react";

import { UserAvatar } from "./UserAvatar";
import { formatDate, formatDistance } from "../lib";

export type StatsPeriodKey = "week" | "month" | "year" | "allTime";

export type PeriodStats = {
  distance_meters: number;
  moving_time_seconds: number;
  elevation_gain: number;
  workout_count: number;
};

type AthleteIdentity = {
  full_name: string;
  username: string;
  avatar_url: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
  provider?: "intervals" | null;
};

type AthleteAccountHeaderProps = {
  athlete: AthleteIdentity;
  stats: {
    week: PeriodStats;
    month: PeriodStats;
    year: PeriodStats;
    allTime: PeriodStats;
  };
  selectedPeriod: StatsPeriodKey;
  onPeriodChange: (period: StatsPeriodKey) => void;
  avatarControl?: ReactNode;
};

const statsPeriods: Array<{ key: StatsPeriodKey; label: string }> = [
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "year", label: "Год" },
  { key: "allTime", label: "Все время" }
];

function formatStatsHours(seconds: number) {
  if (seconds <= 0) {
    return "0ч 0м";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}ч ${minutes}м`;
}

function formatStatsElevation(value: number) {
  return `${Math.round(value)} м`;
}

function formatSyncStatus(connectedAt: string | null, lastSyncedAt: string | null) {
  if (!connectedAt) {
    return {
      title: "Синхронизация не подключена",
      subtitle: "Попросите администратора подключить intervals.icu"
    };
  }

  return {
    title: "intervals.icu подключён",
    subtitle: lastSyncedAt
      ? `Последняя синхронизация: ${formatDate(lastSyncedAt)}`
      : "Последняя синхронизация: еще не выполнялась"
  };
}

export function AthleteAccountHeader(props: AthleteAccountHeaderProps) {
  const { athlete, stats, selectedPeriod, onPeriodChange, avatarControl } = props;

  const selectedStats = stats[selectedPeriod];
  const syncStatus = formatSyncStatus(athlete.connected_at, athlete.last_synced_at);

  return (
    <section className="athlete-account-header">
      <div className="athlete-account-header-grid">
        <div className="athlete-account-identity-wrap">
          <div className="athlete-account-identity">
            {avatarControl ?? (
              <UserAvatar
                fullName={athlete.full_name}
                avatarUrl={athlete.avatar_url}
                className="athlete-account-avatar"
                ariaHidden
              />
            )}
            <div className="athlete-account-title">
              <h1>{athlete.full_name}</h1>
              <p className="muted">@{athlete.username}</p>
            </div>
          </div>
          <div className="athlete-account-status athlete-account-status-inline">
            <div>{syncStatus.title}</div>
            {syncStatus.subtitle ? <div className="muted">{syncStatus.subtitle}</div> : null}
          </div>
        </div>
        <div className="athlete-account-main">
          <div className="athlete-account-topbar">
            <div className="athlete-account-heading">
              <span className="muted athlete-account-eyebrow">Сводка</span>
              <h2>Статистика спортсмена</h2>
            </div>
            <div className="athlete-stats-periods" role="tablist" aria-label="Период статистики">
              {statsPeriods.map((period) => (
                <button
                  key={period.key}
                  type="button"
                  className={
                    period.key === selectedPeriod ? "athlete-stats-period is-active" : "athlete-stats-period"
                  }
                  onClick={() => onPeriodChange(period.key)}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>
          <div className="athlete-account-stats">
            <div className="athlete-account-stat">
              <span className="muted">Километраж</span>
              <strong>{formatDistance(selectedStats.distance_meters)}</strong>
            </div>
            <div className="athlete-account-stat">
              <span className="muted">Время</span>
              <strong>{formatStatsHours(selectedStats.moving_time_seconds)}</strong>
            </div>
            <div className="athlete-account-stat">
              <span className="muted">Набор высоты</span>
              <strong>{formatStatsElevation(selectedStats.elevation_gain)}</strong>
            </div>
            <div className="athlete-account-stat">
              <span className="muted">Тренировки</span>
              <strong>{selectedStats.workout_count}</strong>
            </div>
          </div>
          <p className="muted athlete-account-caption">
            Периодическая сводка считается по завершенным тренировкам спортсмена.
          </p>
        </div>
      </div>
    </section>
  );
}
