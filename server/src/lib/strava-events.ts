export type StravaEventLevel = "info" | "warn" | "error";

export type StravaEventEntry = {
  id: string;
  timestamp: string;
  source: "webhook" | "cron" | "system";
  level: StravaEventLevel;
  message: string;
  details?: Record<string, unknown>;
};

const MAX_EVENTS = 200;
const events: StravaEventEntry[] = [];

export function addStravaEvent(entry: Omit<StravaEventEntry, "id" | "timestamp">) {
  events.unshift({
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString()
  });

  if (events.length > MAX_EVENTS) {
    events.length = MAX_EVENTS;
  }
}

export function getStravaEvents(limit = 100) {
  return events.slice(0, Math.max(0, Math.min(limit, MAX_EVENTS)));
}
