import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api } from "../api";
import { formatRaceTime, formatTimeDigits, parseRaceTime, ResultsPanel } from "../components/Results";
import { useToast } from "../components/ToastProvider";
import { UserAvatar } from "../components/UserAvatar";
import { forgetApiCache, useApi } from "../hooks/useApi";
import { formatAgo, formatDuration, formatKm, formatPace, pluralRu } from "../lib";
import { isTelegramMiniApp } from "../telegram";

// Карточка спортсмена у тренера (client/DESIGN.md): единственное место аналитики —
// циклы (неделя · 4 недели · сезон), состояние (форма, усталость, свежесть),
// заметки тренера, последние пробежки, старты и рекорды.

type CycleLevel = "week" | "blocks" | "season";
type Totals = { distance_meters: number; elevation_gain: number; moving_time_seconds: number; workout_count: number };
type Threshold = {
  pace_seconds_per_km: number;
  source: "manual" | "race";
  race?: { name: string; race_date: string; distance_meters: number; official_time_seconds: number };
} | null;
type Cycles = {
  level: CycleLevel;
  bars: { start: string; distance_meters: number }[];
  totals: Totals;
  previous: Totals;
  zone_seconds: number[];
  threshold: Threshold;
  pace_zone_bounds: number[] | null;
  pace_zone_seconds: number[] | null;
};
type State = {
  fitness: { ctl: number; atl: number; tsb: number; ramp7: number; zone: "fresh" | "neutral" | "productive" | "overload" } | null;
  feelings: { hard: number; pain: number; marked: number };
  note: string;
  next_start_days: number | null;
};
type Profile = {
  athlete: { id: number; full_name: string; avatar_url: string | null };
  workouts: { id: number; name: string; start_date: string; distance_meters: number; average_speed: number | null; has_feedback?: boolean }[];
};

const LEVELS: { value: CycleLevel; label: string }[] = [
  { value: "week", label: "Неделя" },
  { value: "blocks", label: "4 недели" },
  { value: "season", label: "Сезон" }
];
const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const ZONE_LABELS = ["до 130", "130–150", "150–162", "162+"];
const PACE_ZONE_NAMES = ["Лёгкий", "Марафонский", "Пороговый", "Интервальный", "Повторный"];

function paceText(seconds: number) {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

// «5:35–4:50» для каждой зоны по границам
function paceRanges(bounds: number[]) {
  return [
    `медленнее ${paceText(bounds[0]!)}`,
    `${paceText(bounds[0]!)}–${paceText(bounds[1]!)}`,
    `${paceText(bounds[1]!)}–${paceText(bounds[2]!)}`,
    `${paceText(bounds[2]!)}–${paceText(bounds[3]!)}`,
    `быстрее ${paceText(bounds[3]!)}`
  ];
}

function ThresholdLine({ athleteId, threshold, onSaved }: { athleteId: number; threshold: Threshold; onSaved: () => void }) {
  const showToast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(pace: number | null) {
    setSaving(true);
    try {
      await api(`/api/trainer/athletes/${athleteId}/threshold`, { method: "PUT", body: JSON.stringify({ pace }) });
      forgetApiCache(`/api/trainer/athletes/${athleteId}`);
      setEditing(false);
      onSaved();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const seconds = parseRaceTime(value);
    return (
      <div className="cy-thr-edit">
        <label>
          Пороговый темп, мин:сек на км
          <input
            inputMode="numeric"
            value={value}
            placeholder="4:01"
            autoFocus
            onChange={(event) => setValue(formatTimeDigits(event.target.value))}
          />
        </label>
        <div className="workout-coach-actions">
          <button type="button" className="ds-btn ds-btn-1 ds-btn-sm" disabled={saving || !seconds} onClick={() => void save(seconds)}>
            Сохранить
          </button>
          {threshold?.source === "manual" ? (
            <button type="button" className="ds-btn ds-btn-3" disabled={saving} onClick={() => void save(null)}>
              Считать по старту
            </button>
          ) : null}
          <button type="button" className="ds-btn ds-btn-3" onClick={() => setEditing(false)}>
            Отмена
          </button>
        </div>
      </div>
    );
  }

  const open = () => {
    setValue(threshold ? paceText(threshold.pace_seconds_per_km) : "");
    setEditing(true);
  };
  if (!threshold) {
    return (
      <p className="ds-sub cy-thr">
        Для зон темпа нужен пороговый темп — с часов или по тесту.{" "}
        <button type="button" className="cy-link" onClick={open}>
          Указать
        </button>
      </p>
    );
  }
  return (
    <p className="ds-sub cy-thr">
      Порог {paceText(threshold.pace_seconds_per_km)} /км —{" "}
      {threshold.source === "manual"
        ? "указан тренером"
        : `оценка по старту ${threshold.race ? `«${threshold.race.name}» за ${formatRaceTime(threshold.race.official_time_seconds)}` : ""}`}
      .{" "}
      <button type="button" className="cy-link" onClick={open}>
        {threshold.source === "manual" ? "Изменить" : "Указать точно"}
      </button>
    </p>
  );
}
const FRESH = {
  fresh: { text: "свежий — можно нагружаться и стартовать", tone: "var(--good-ink)" },
  neutral: { text: "обычный режим", tone: "var(--ink-muted)" },
  productive: { text: "продуктивная нагрузка, идёт рост формы", tone: "var(--ink-2)" },
  overload: { text: "перегруз — стоит разгрузиться", tone: "var(--danger-ink)" }
} as const;

function signed(value: number, digits = 0) {
  const text = Math.abs(value).toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${text}`;
}

function hoursMinutes(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}` : formatDuration(Math.round(seconds));
}

function compareSentence(level: CycleLevel, current: number, previous: number) {
  const what = level === "week" ? "к этому дню прошлой недели" : level === "blocks" ? "за 4 недели до этого" : "за полгода до этого";
  if (!previous && !current) return null;
  if (!previous) return `${what[0]!.toUpperCase()}${what.slice(1)} пробежек не было`;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (Math.abs(percent) < 3) return `Столько же, сколько ${what} (${formatKm(previous)} км)`;
  return `${percent > 0 ? "На" : "На"} ${Math.abs(percent)}% ${percent > 0 ? "больше" : "меньше"}, чем ${what} (${formatKm(previous)} км)`;
}

function CyclesBlock({ athleteId, nextStartDays, initialLevel }: { athleteId: number; nextStartDays: number | null; initialLevel: CycleLevel }) {
  const [level, setLevel] = useState<CycleLevel>(initialLevel);
  const { data, refresh } = useApi<Cycles>(`/api/trainer/athletes/${athleteId}/cycles?level=${level}`);
  const cycles = data && data.level === level ? data : null;
  const today = (new Date().getDay() + 6) % 7;
  const max = cycles ? Math.max(...cycles.bars.map((bar) => bar.distance_meters), 1) : 1;
  const zoneTotal = cycles ? cycles.zone_seconds.reduce((sum, value) => sum + value, 0) : 0;

  const title = (() => {
    if (!cycles) return "";
    const first = new Date(cycles.bars[0]!.start);
    const lastStart = new Date(cycles.bars[cycles.bars.length - 1]!.start);
    const end = new Date(lastStart.getTime() + (level === "week" ? 0 : 6) * 86_400_000);
    const range =
      first.getMonth() === end.getMonth()
        ? `${first.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]}`
        : `${first.getDate()} ${MONTHS[first.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
    return level === "week" ? `Эта неделя · ${range}` : level === "blocks" ? `4 недели · ${range}` : "Сезон · 6 месяцев";
  })();

  return (
    <section className="ds-block ds-pad" aria-label="Циклы">
      <div className="cy-head">
        <b>Циклы</b>
        {nextStartDays !== null ? (
          <span>
            {nextStartDays === 0 ? "старт сегодня" : `до старта ${nextStartDays} ${pluralRu(nextStartDays, "день", "дня", "дней")}`}
          </span>
        ) : null}
      </div>
      <div className="ds-seg" role="group" aria-label="Период">
        {LEVELS.map((item) => (
          <button key={item.value} type="button" aria-pressed={level === item.value} onClick={() => setLevel(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
      {!cycles ? (
        <div className="skeleton-block" style={{ height: 220, borderRadius: 12, marginTop: 14 }} />
      ) : (
        <>
          <div className="cy-title">
            <b>{title}</b>
            <span>{level === "week" ? "пн–вс" : level === "blocks" ? "по неделям" : "по неделям, 26 недель"}</span>
          </div>
          <div className="cy-m3">
            <div>
              <b>
                {formatKm(cycles.totals.distance_meters)}
                <small>км</small>
              </b>
              <span>
                {level === "season"
                  ? `ср. ${formatKm(cycles.totals.distance_meters / cycles.bars.length)} км/нед`
                  : `${cycles.totals.workout_count} ${pluralRu(cycles.totals.workout_count, "пробежка", "пробежки", "пробежек")}`}
              </span>
            </div>
            <div>
              <b>
                {Math.round(cycles.totals.elevation_gain).toLocaleString("ru-RU")}
                <small>м</small>
              </b>
              <span>набор</span>
            </div>
            <div>
              <b>{hoursMinutes(cycles.totals.moving_time_seconds)}</b>
              <span>время</span>
            </div>
          </div>
          {compareSentence(level, cycles.totals.distance_meters, cycles.previous.distance_meters) ? (
            <p className="cy-msg">{compareSentence(level, cycles.totals.distance_meters, cycles.previous.distance_meters)}</p>
          ) : null}
          <div
            className={`cy-bars is-${level}`}
            role="img"
            aria-label={`Км: ${cycles.bars.map((bar) => formatKm(bar.distance_meters)).join(", ")}`}
          >
            {cycles.bars.map((bar, index) => {
              const future = level === "week" && index > today;
              const current = level === "week" ? index === today : index === cycles.bars.length - 1;
              const height = bar.distance_meters ? Math.max((bar.distance_meters / max) * 100, 6) : 0;
              return (
                <div key={bar.start} className="cy-col">
                  {level !== "season" && bar.distance_meters ? <span className="cy-val">{formatKm(bar.distance_meters)}</span> : null}
                  <i
                    className={future ? "is-future" : current ? "is-now" : bar.distance_meters ? undefined : "is-zero"}
                    style={height ? { height: `${height}%` } : undefined}
                  />
                </div>
              );
            })}
          </div>
          <div className={`cy-axis is-${level}`} aria-hidden="true">
            {cycles.bars.map((bar, index) => {
              const start = new Date(bar.start);
              let label = "";
              if (level === "week") label = DAYS[index]!;
              else if (level === "blocks") label = index === cycles.bars.length - 1 ? "эта" : `${String(start.getDate()).padStart(2, "0")}.${String(start.getMonth() + 1).padStart(2, "0")}`;
              else if (index === cycles.bars.length - 1) label = "эта";
              else if (start.getDate() <= 7) label = MONTHS[start.getMonth()]!;
              const isNow = level === "week" ? index === today : index === cycles.bars.length - 1;
              return (
                <span key={bar.start} className={isNow ? "is-now" : undefined}>
                  {label}
                </span>
              );
            })}
          </div>
          <div className="cy-zones">
            <div className="cy-title" style={{ marginTop: 0 }}>
              <b>Зоны темпа</b>
              <span>доля времени бега</span>
            </div>
            {cycles.pace_zone_seconds && cycles.pace_zone_bounds ? (
              (() => {
                const total = cycles.pace_zone_seconds.reduce((sum, value) => sum + value, 0);
                const ranges = paceRanges(cycles.pace_zone_bounds);
                return total > 0 ? (
                  <>
                    <div className="ds-zbar" role="img" aria-label={PACE_ZONE_NAMES.map((name, i) => `${name} ${Math.round((cycles.pace_zone_seconds![i]! / total) * 100)}%`).join(", ")}>
                      {cycles.pace_zone_seconds.map((value, index) =>
                        value > 0 ? <i key={index} style={{ flex: value, background: `var(--pz-${index + 1})` }} /> : null
                      )}
                    </div>
                    <ul className="cy-pz">
                      {PACE_ZONE_NAMES.map((name, index) => (
                        <li key={name}>
                          <i style={{ background: `var(--pz-${index + 1})` }} />
                          <div>
                            <b>{name}</b>
                            <em>{ranges[index]}</em>
                          </div>
                          <span>{hoursMinutes(cycles.pace_zone_seconds![index]!)}</span>
                          <strong>{Math.round((cycles.pace_zone_seconds![index]! / total) * 100)}%</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="ds-sub">Нет пробежек с записью темпа за этот период.</p>
                );
              })()
            ) : null}
            <ThresholdLine athleteId={athleteId} threshold={cycles.threshold} onSaved={refresh} />
          </div>
          {zoneTotal > 0 ? (
            <div className="cy-zones">
              <div className="cy-title" style={{ marginTop: 0 }}>
                <b>Зоны пульса</b>
                <span>доля времени бега</span>
              </div>
              <div className="ds-zbar">
                {cycles.zone_seconds.map((value, index) =>
                  value > 0 ? <i key={index} style={{ flex: value, background: `var(--hrz-${index + 1})` }} /> : null
                )}
              </div>
              <div className="ds-zleg">
                {cycles.zone_seconds.map((value, index) => (
                  <span key={index}>
                    <i style={{ background: `var(--hrz-${index + 1})` }} />
                    {ZONE_LABELS[index]} · {Math.round((value / zoneTotal) * 100)}%
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function NotesBlock({ athleteId, initial }: { athleteId: number; initial: string }) {
  const showToast = useToast();
  const [note, setNote] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setNote(initial);
    setDraft(initial);
  }, [initial]);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ note: string }>(`/api/trainer/athletes/${athleteId}/note`, { method: "PUT", body: JSON.stringify({ body: draft }) });
      setNote(res.note);
      setEditing(false);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ds-block ds-pad" aria-label="Заметки тренера">
      <div className="cy-title" style={{ marginTop: 0 }}>
        <b>Заметки</b>
        <span>видите только вы</span>
      </div>
      {editing ? (
        <div className="workout-coach-edit" style={{ marginTop: 8 }}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} placeholder="Травмы, ограничения, цели сезона" autoFocus />
          <div className="workout-coach-actions">
            <button type="button" className="ds-btn ds-btn-1 ds-btn-sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
            <button
              type="button"
              className="ds-btn ds-btn-3"
              onClick={() => {
                setDraft(note);
                setEditing(false);
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="cy-note">{note || "Пока пусто. Запишите травмы, ограничения, цели сезона."}</p>
          <button type="button" className="ds-btn ds-btn-3" onClick={() => setEditing(true)}>
            {note ? "Изменить" : "Добавить заметку"}
          </button>
        </>
      )}
    </section>
  );
}

export function TrainerAthletePage() {
  const params = useParams();
  const navigate = useNavigate();
  const athleteId = Number(params.id);
  // из тепловой карты приходят с ?cycle=blocks — открываем циклы на этом уровне
  const [search] = useSearchParams();
  const cycleParam = search.get("cycle");
  const initialCycle: CycleLevel = cycleParam === "blocks" || cycleParam === "season" ? cycleParam : "week";
  const { data: profile, error } = useApi<Profile>(`/api/trainer/athletes/${athleteId}`);
  const { data: state } = useApi<State>(`/api/trainer/athletes/${athleteId}/state`);
  const [showAll, setShowAll] = useState(false);

  if (error) {
    return (
      <section className="ds-block ds-pad">
        <b style={{ fontSize: 17 }}>Спортсмен не найден</b>
        <p className="ds-sub">{error}</p>
        <Link className="ds-link" to="/trainer">
          ‹ Группа
        </Link>
      </section>
    );
  }
  if (!profile) {
    return (
      <div className="ds-screen">
        <div className="skeleton-block" style={{ height: 56, width: 240 }} />
        <div className="skeleton-block" style={{ height: 320, borderRadius: 16 }} />
      </div>
    );
  }

  const latest = profile.workouts[0];
  const fitness = state?.fitness ?? null;
  const feelings = state?.feelings;
  const runs = showAll ? profile.workouts : profile.workouts.slice(0, 5);

  return (
    <div className="ds-screen" style={{ gap: 20 }}>
      {isTelegramMiniApp ? null : (
        <Link
          to="/trainer"
          className="ds-link"
          onClick={(event) => {
            if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) {
              event.preventDefault();
              navigate(-1);
            }
          }}
        >
          ‹ Группа
        </Link>
      )}
      <div className="athlete-head">
        <UserAvatar fullName={profile.athlete.full_name} avatarUrl={profile.athlete.avatar_url} className="athlete-head-avatar" />
        <div style={{ minWidth: 0 }}>
          <h1 className="ds-title">{profile.athlete.full_name}</h1>
          <p className="ds-sub" style={{ marginTop: 2 }}>
            {latest ? `последняя пробежка ${formatAgo(latest.start_date)}` : "пробежек пока нет"}
          </p>
        </div>
      </div>

      <CyclesBlock athleteId={athleteId} nextStartDays={state?.next_start_days ?? null} initialLevel={initialCycle} />

      <div>
        <div className="ds-grp">
          <span>Состояние</span>
          <span>видите только вы</span>
        </div>
        <div className="ds-list">
          <div className="ds-li">
            <div className="ds-m">
              <b>Свежесть</b>
              <span style={{ color: fitness ? FRESH[fitness.zone].tone : undefined, fontWeight: fitness ? 700 : undefined }}>
                {fitness ? FRESH[fitness.zone].text : "нет данных о нагрузке"}
              </span>
            </div>
            <div className="ds-v">{fitness ? signed(fitness.tsb) : "—"}</div>
          </div>
          <div className="ds-li">
            <div className="ds-m">
              <b>Форма · Усталость</b>
              <span>
                42 дня · 7 дней{fitness ? ` · рост формы за неделю ${signed(fitness.ramp7, 1)}` : ""}
                {fitness && fitness.ramp7 > 6 ? " — быстро" : ""}
              </span>
            </div>
            <div className="ds-v">{fitness ? `${fitness.ctl} · ${fitness.atl}` : "—"}</div>
          </div>
          <div className="ds-li">
            <div className="ds-m">
              <b>Самочувствие</b>
              <span>
                {!feelings || feelings.marked === 0
                  ? "за 2 недели отметок нет"
                  : [
                      feelings.hard ? `«тяжело» — ${feelings.hard}` : null,
                      feelings.pain ? `боль — ${feelings.pain}` : null
                    ]
                      .filter(Boolean)
                      .join(" · ") || "за 2 недели без жалоб"}
              </span>
            </div>
            {feelings && (feelings.hard || feelings.pain) ? <span className="ds-pill ds-pill-warn">внимание</span> : null}
          </div>
        </div>
      </div>

      {state ? <NotesBlock athleteId={athleteId} initial={state.note} /> : null}

      {profile.workouts.length ? (
        <div>
          <div className="ds-grp">
            <span>Последние пробежки</span>
            {profile.workouts.length > 5 ? (
              <button type="button" className="ds-link cy-more" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Свернуть" : "Все"}
              </button>
            ) : null}
          </div>
          <div className="ds-list">
            {runs.map((workout) => (
              <Link key={workout.id} className="ds-li" to={`/trainer/workouts/${workout.id}`}>
                <div className="ds-m">
                  <b>{workout.name}</b>
                  <span>
                    {formatAgo(workout.start_date)} · {formatPace(workout.average_speed).replace("/км", " /км")}
                  </span>
                </div>
                <div className="ds-v">
                  {formatKm(workout.distance_meters)}
                  <small>км</small>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <section className="athlete-starts" aria-label="Старты и рекорды">
        <h2 className="athlete-section-title">Старты и рекорды</h2>
        <ResultsPanel athleteId={athleteId} viewer="trainer" />
      </section>
    </div>
  );
}
