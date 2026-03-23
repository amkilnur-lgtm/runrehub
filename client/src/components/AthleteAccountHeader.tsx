import { useEffect, useRef, useState } from "react";

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
  onConnectStrava?: () => void;
  onDisconnectStrava?: () => Promise<void> | void;
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
      title: "Strava не подключена",
      subtitle: "Подключите Strava для автоматической синхронизации"
    };
  }

  return {
    title: "Strava подключена",
    subtitle: lastSyncedAt
      ? `Последняя синхронизация: ${formatDate(lastSyncedAt)}`
      : "Последняя синхронизация: еще не выполнялась"
  };
}

export function AthleteAccountHeader(props: AthleteAccountHeaderProps) {
  const { athlete, stats, selectedPeriod, onPeriodChange, onConnectStrava, onDisconnectStrava } = props;
  const [isStravaMenuOpen, setIsStravaMenuOpen] = useState(false);
  const stravaMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isStravaMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (stravaMenuRef.current && !stravaMenuRef.current.contains(event.target as Node)) {
        setIsStravaMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsStravaMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isStravaMenuOpen]);

  const selectedStats = stats[selectedPeriod];
  const syncStatus = formatSyncStatus(athlete.connected_at, athlete.last_synced_at);
  const canManageStrava = typeof onDisconnectStrava === "function" || typeof onConnectStrava === "function";

  return (
    <section className="athlete-account-header">
      <div className="athlete-account-header-grid">
        <div className="athlete-account-identity-wrap">
          <div className="athlete-account-identity">
            <UserAvatar
              fullName={athlete.full_name}
              avatarUrl={athlete.avatar_url}
              className="athlete-account-avatar"
              ariaHidden
            />
            <div className="athlete-account-title">
              <h1>{athlete.full_name}</h1>
              <p className="muted">@{athlete.username}</p>
            </div>
          </div>
          <div className="athlete-account-status athlete-account-status-inline">
            {athlete.connected_at ? (
              <div className="athlete-strava-control" ref={stravaMenuRef}>
                {typeof onDisconnectStrava === "function" ? (
                  <button
                    type="button"
                    className="athlete-account-status-trigger"
                    aria-expanded={isStravaMenuOpen}
                    onClick={() => setIsStravaMenuOpen((open) => !open)}
                  >
                    {syncStatus.title}
                  </button>
                ) : (
                  <div>{syncStatus.title}</div>
                )}
                {syncStatus.subtitle ? <div className="muted">{syncStatus.subtitle}</div> : null}
                {isStravaMenuOpen && typeof onDisconnectStrava === "function" ? (
                  <div className="athlete-strava-popover">
                    <button
                      type="button"
                      className="athlete-strava-item athlete-strava-item-danger"
                      onClick={async () => {
                        await onDisconnectStrava();
                        setIsStravaMenuOpen(false);
                      }}
                    >
                      Отключить
                    </button>
                  </div>
                ) : null}
              </div>
            ) : canManageStrava && typeof onConnectStrava === "function" ? (
              <>
                <button type="button" className="primary-button athlete-strava-button" onClick={onConnectStrava}>
                  Подключить Strava
                </button>
                <div className="muted">{syncStatus.subtitle}</div>
              </>
            ) : (
              <>
                <div>{syncStatus.title}</div>
                {syncStatus.subtitle ? <div className="muted">{syncStatus.subtitle}</div> : null}
              </>
            )}
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
