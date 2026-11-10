import { useState } from "react";

import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { useToast } from "./ToastProvider";

// «Здоровье» в «Моём профиле»: анализы (каждая сдача — дата и значения, история по показателю)
// и витамины/добавки. Видят спортсмен и тренер (можно закрыть). Оценок «норма / не норма» нет.

export type LabSession = {
  taken_on: string;
  values: { id: number; marker: string; value: number; unit: string | null }[];
};
export type Supplement = {
  id: number;
  name: string;
  dose: string | null;
  started_on: string;
  stopped_on: string | null;
};
export type Cycle = {
  enabled: boolean;
  share_coach: boolean;
  hormonal: boolean;
  periods: { id: number; started_on: string; ended_on: string | null }[];
  day: number | null;
  avg_length: number | null;
  next_in_days: number | null;
  alert: boolean;
};
type Health = {
  consent_at: string | null;
  share_coach: boolean;
  labs: LabSession[];
  supplements: Supplement[];
  cycle: Cycle;
};

// основные показатели для бегуна (Pedlar et al., 2019): железо, кровь, витамины, щитовидка
export const LAB_PRESETS: { marker: string; unit: string }[] = [
  { marker: "Ферритин", unit: "нг/мл" },
  { marker: "Гемоглобин", unit: "г/л" },
  { marker: "Витамин D (25-OH)", unit: "нг/мл" },
  { marker: "Витамин B12", unit: "пг/мл" },
  { marker: "ТТГ", unit: "мкМЕ/мл" },
  { marker: "Железо", unit: "мкмоль/л" },
];
const MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

export function labDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}

function monthsAgo(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return (Date.now() - new Date(y!, m! - 1, d).getTime()) / (30.4 * 86_400_000);
}

function fmt(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

// история одного показателя по всем сдачам: старые слева
export function markerHistory(labs: LabSession[], marker: string) {
  return labs
    .flatMap((session) =>
      session.values
        .filter((item) => item.marker === marker)
        .map((item) => ({ taken_on: session.taken_on, ...item })),
    )
    .reverse();
}

export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const W = 120;
  const H = 32;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const xy = points.map(
    (v, i) =>
      [
        4 + (i * (W - 8)) / (points.length - 1),
        4 + (1 - (v - lo) / span) * (H - 8),
      ] as const,
  );
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="hl-spark"
      aria-hidden="true"
    >
      <path
        d={xy
          .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
          .join(" ")}
      />
      {xy.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === xy.length - 1 ? 3.2 : 2.2} />
      ))}
    </svg>
  );
}

export function LabHistory({ labs }: { labs: LabSession[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const markers = [
    ...new Set(
      labs.flatMap((session) => session.values.map((item) => item.marker)),
    ),
  ];
  return (
    <>
      {markers.map((marker) => {
        const history = markerHistory(labs, marker);
        const last = history[history.length - 1]!;
        const isOpen = open === marker;
        return (
          <div key={marker}>
            <button
              type="button"
              className="ds-li hl-row"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : marker)}
            >
              <div className="ds-m">
                <b>{marker}</b>
                <span>
                  {labDate(last.taken_on)}
                  {history.length > 1
                    ? ` · ${history.length} ${history.length < 5 ? "сдачи" : "сдач"}`
                    : ""}
                </span>
              </div>
              <Sparkline points={history.map((item) => item.value)} />
              <span className="hl-val">
                {fmt(last.value)}
                {last.unit ? <small> {last.unit}</small> : null}
              </span>
            </button>
            {isOpen ? (
              <div className="hl-hist">
                {history
                  .slice()
                  .reverse()
                  .map((item) => (
                    <div key={item.id}>
                      <span>{labDate(item.taken_on)}</span>
                      <b>
                        {fmt(item.value)}
                        {item.unit ? <small> {item.unit}</small> : null}
                      </b>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function HealthSection() {
  const showToast = useToast();
  const { data, refresh } = useApi<Health>("/api/auth/health");
  const [health, setHealth] = useState<Health | null>(null);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState({ marker: "", value: "", unit: "" });
  const [supp, setSupp] = useState({ name: "", dose: "" });
  const current = health ?? data;

  async function call(url: string, method: string, body?: unknown) {
    try {
      const next = await api<Health>(url, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      setHealth(next);
      return true;
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Не удалось сохранить",
      );
      return false;
    }
  }

  if (!current) return null;

  if (!current.consent_at) {
    return (
      <div>
        <div className="ds-grp">
          <span>Здоровье</span>
          <span>вы и тренер</span>
        </div>
        <section className="ds-block ds-pad hl-consent">
          <b>Анализы и витамины</b>
          <p>
            Записывайте результаты анализов и что принимаете — тренеру проще
            планировать нагрузку, а вам видно, как меняются показатели.
            Одногруппники этот раздел не видят никогда.
          </p>
          <button
            type="button"
            className="ds-btn ds-btn-1"
            onClick={() =>
              void call("/api/auth/health/settings", "PUT", { consent: true })
            }
          >
            Согласен, включить раздел
          </button>
          <span className="hl-small">
            Нажимая, вы соглашаетесь, что эти данные хранятся в RunRehab и их
            видит ваш тренер. Отозвать можно здесь же — всё удалится.
          </span>
        </section>
      </div>
    );
  }

  const last = current.labs[0];
  const stale = last && monthsAgo(last.taken_on) >= 6;
  const filled = LAB_PRESETS.filter((preset) => values[preset.marker]?.trim());

  async function saveLabs() {
    const list = filled.map((preset) => ({
      marker: preset.marker,
      value: Number(values[preset.marker]!.replace(",", ".")),
      unit: preset.unit,
    }));
    if (custom.marker.trim() && custom.value.trim()) {
      list.push({
        marker: custom.marker.trim(),
        value: Number(custom.value.replace(",", ".")),
        unit: custom.unit.trim() || "",
      });
    }
    if (!list.length || list.some((item) => !Number.isFinite(item.value))) {
      showToast("error", "Введите хотя бы одно число");
      return;
    }
    const ok = await call("/api/auth/health/labs", "POST", {
      taken_on: date,
      values: list.map((item) => ({ ...item, unit: item.unit || null })),
    });
    if (ok) {
      setAdding(false);
      setValues({});
      setCustom({ marker: "", value: "", unit: "" });
    }
  }

  const active = current.supplements.filter((item) => !item.stopped_on);
  const stopped = current.supplements.filter((item) => item.stopped_on);

  return (
    <div className="hl">
      <div className="ds-grp">
        <span>Здоровье</span>
        <span>{current.share_coach ? "вы и тренер" : "только вы"}</span>
      </div>

      <div className="ds-list">
        <b className="mate-lh">
          Анализы
          <span>
            {last ? `последние — ${labDate(last.taken_on)}` : "пока нет"}
          </span>
        </b>
        {stale ? (
          <p className="hl-stale">
            Последним анализам больше полугода — самое время пересдать.
          </p>
        ) : null}
        <LabHistory labs={current.labs} />
        {adding ? (
          <div className="hl-form">
            <label className="hl-date">
              <span>дата сдачи</span>
              <input
                type="date"
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            {LAB_PRESETS.map((preset) => (
              <label key={preset.marker} className="hl-in">
                <span>{preset.marker}</span>
                <input
                  inputMode="decimal"
                  value={values[preset.marker] ?? ""}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [preset.marker]: event.target.value.replace(
                        /[^\d.,]/g,
                        "",
                      ),
                    }))
                  }
                  placeholder="—"
                />
                <small>{preset.unit}</small>
              </label>
            ))}
            <div className="hl-custom">
              <input
                value={custom.marker}
                onChange={(event) =>
                  setCustom({ ...custom, marker: event.target.value })
                }
                placeholder="другой показатель"
                maxLength={60}
              />
              <input
                inputMode="decimal"
                value={custom.value}
                onChange={(event) =>
                  setCustom({
                    ...custom,
                    value: event.target.value.replace(/[^\d.,]/g, ""),
                  })
                }
                placeholder="значение"
              />
              <input
                value={custom.unit}
                onChange={(event) =>
                  setCustom({ ...custom, unit: event.target.value })
                }
                placeholder="ед."
                maxLength={20}
              />
            </div>
            <div className="bd-actions">
              <button
                type="button"
                className="ds-btn ds-btn-1"
                onClick={() => void saveLabs()}
              >
                Сохранить
              </button>
              <button
                type="button"
                className="ds-btn ds-btn-3"
                onClick={() => setAdding(false)}
              >
                Отмена
              </button>
            </div>
            <span className="hl-small">
              Пишите числа как в бланке лаборатории. Мы не оцениваем «норма / не
              норма» — обсудите с врачом.
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="ds-li mate-more hl-add"
            onClick={() => setAdding(true)}
          >
            + Новые анализы
          </button>
        )}
      </div>

      <div className="ds-list">
        <b className="mate-lh">
          Витамины и добавки
          <span>{active.length ? `принимаю ${active.length}` : "ничего"}</span>
        </b>
        {active.map((item) => (
          <div key={item.id} className="ds-li">
            <div className="ds-m">
              <b>{item.name}</b>
              <span>
                {item.dose ? `${item.dose} · ` : ""}с {labDate(item.started_on)}
              </span>
            </div>
            <button
              type="button"
              className="ds-btn ds-btn-3 hl-stop"
              onClick={() =>
                void call(`/api/auth/health/supplements/${item.id}/stop`, "PUT")
              }
            >
              Закончил
            </button>
          </div>
        ))}
        {stopped.slice(0, 5).map((item) => (
          <div key={item.id} className="ds-li hl-old">
            <div className="ds-m">
              <b>{item.name}</b>
              <span>
                {labDate(item.started_on)} — {labDate(item.stopped_on!)}
              </span>
            </div>
            <button
              type="button"
              className="hl-x"
              aria-label={`Удалить «${item.name}»`}
              onClick={() =>
                void call(`/api/auth/health/supplements/${item.id}`, "DELETE")
              }
            >
              ×
            </button>
          </div>
        ))}
        <div className="hl-supp-add">
          <input
            value={supp.name}
            onChange={(event) => setSupp({ ...supp, name: event.target.value })}
            placeholder="Железо, витамин D…"
            maxLength={80}
          />
          <input
            value={supp.dose}
            onChange={(event) => setSupp({ ...supp, dose: event.target.value })}
            placeholder="доза: 2000 МЕ в день"
            maxLength={80}
          />
          <button
            type="button"
            className="ds-btn ds-btn-3"
            disabled={supp.name.trim().length < 2}
            onClick={async () => {
              if (
                await call("/api/auth/health/supplements", "POST", {
                  name: supp.name.trim(),
                  dose: supp.dose.trim() || null,
                })
              )
                setSupp({ name: "", dose: "" });
            }}
          >
            Добавить
          </button>
        </div>
      </div>

      {/* Цикл: по умолчанию выключен; тренеру — отдельным тумблером, тоже выключенным */}
      <div className="ds-list">
        <label className="ds-li me-row">
          <div className="ds-m">
            <b>Отмечать цикл</b>
            <span>
              {current.cycle.enabled
                ? "даты месячных — без симптомов и диагнозов"
                : "выключено"}
            </span>
          </div>
          <input
            type="checkbox"
            className="me-switch"
            checked={current.cycle.enabled}
            onChange={(event) =>
              void call("/api/auth/health/cycle/settings", "PUT", {
                enabled: event.target.checked,
              })
            }
          />
        </label>
        {current.cycle.enabled ? (
          <CycleBody cycle={current.cycle} call={call} />
        ) : null}
      </div>

      <div className="ds-list">
        <label className="ds-li me-row">
          <div className="ds-m">
            <b>Анализы и добавки — тренеру</b>
            <span>одногруппники не видят никогда</span>
          </div>
          <input
            type="checkbox"
            className="me-switch"
            checked={current.share_coach}
            onChange={(event) =>
              void call("/api/auth/health/settings", "PUT", {
                share_coach: event.target.checked,
              })
            }
          />
        </label>
        <button
          type="button"
          className="ds-li mate-more hl-revoke"
          onClick={() => {
            if (
              window.confirm(
                "Отозвать согласие и удалить все анализы и добавки?",
              )
            )
              void call("/api/auth/health/settings", "PUT", {
                consent: false,
              }).then(() => refresh());
          }}
        >
          Отозвать согласие и удалить данные
        </button>
      </div>
    </div>
  );
}

function CycleBody({
  cycle,
  call,
}: {
  cycle: Cycle;
  call: (url: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [picking, setPicking] = useState(false);
  const last = cycle.periods[0];
  const startedToday = last?.started_on === today;
  return (
    <>
      <div className="ds-li cy2-now">
        <div className="ds-m">
          <b>
            {cycle.day
              ? `День цикла ${cycle.day}`
              : "Отметьте первый день месячных"}
          </b>
          <span>
            {cycle.avg_length
              ? `в среднем ${cycle.avg_length} дней`
              : cycle.periods.length
                ? "средняя длина появится после двух отметок"
                : "приложение посчитает длину цикла само"}
            {cycle.next_in_days !== null && cycle.next_in_days > 0
              ? ` · следующие примерно через ${cycle.next_in_days} дн.`
              : ""}
          </span>
        </div>
      </div>
      {cycle.alert ? (
        <p className="hl-stale">
          Месячных нет больше 3 месяцев. Это стоит обсудить с врачом — так
          бывает при нехватке энергии на нагрузку (RED-S). Мы ничего не
          диагностируем.
        </p>
      ) : null}
      {picking ? (
        <div className="hl-form">
          <label className="hl-date">
            <span>первый день</span>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <div className="bd-actions">
            <button
              type="button"
              className="ds-btn ds-btn-1"
              onClick={async () => {
                if (
                  await call("/api/auth/health/cycle", "POST", {
                    started_on: date,
                  })
                )
                  setPicking(false);
              }}
            >
              Отметить
            </button>
            <button
              type="button"
              className="ds-btn ds-btn-3"
              onClick={() => setPicking(false)}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="cy2-acts">
          {!startedToday ? (
            <button
              type="button"
              className="ds-btn ds-btn-2"
              onClick={() =>
                void call("/api/auth/health/cycle", "POST", {
                  started_on: today,
                })
              }
            >
              Начались сегодня
            </button>
          ) : null}
          <button
            type="button"
            className="ds-btn ds-btn-3"
            onClick={() => setPicking(true)}
          >
            Другая дата
          </button>
        </div>
      )}
      {cycle.periods.slice(0, 6).map((period, index) => {
        const next = cycle.periods[index - 1];
        const length = next
          ? Math.round(
              (Date.parse(next.started_on) - Date.parse(period.started_on)) /
                86_400_000,
            )
          : null;
        return (
          <div key={period.id} className="ds-li hl-old">
            <div className="ds-m">
              <b>{labDate(period.started_on)}</b>
              <span>{length ? `цикл ${length} дней` : "текущий цикл"}</span>
            </div>
            <button
              type="button"
              className="hl-x"
              aria-label={`Удалить отметку ${labDate(period.started_on)}`}
              onClick={() =>
                void call(`/api/auth/health/cycle/${period.id}`, "DELETE")
              }
            >
              ×
            </button>
          </div>
        );
      })}
      <label className="ds-li me-row">
        <div className="ds-m">
          <b>Гормональная контрацепция</b>
          <span>с ней цикл и пропуски считаются иначе</span>
        </div>
        <input
          type="checkbox"
          className="me-switch"
          checked={cycle.hormonal}
          onChange={(event) =>
            void call("/api/auth/health/cycle/settings", "PUT", {
              hormonal: event.target.checked,
            })
          }
        />
      </label>
      <label className="ds-li me-row">
        <div className="ds-m">
          <b>Показывать тренеру</b>
          <span>тренер увидит только день цикла и сигнал о пропуске</span>
        </div>
        <input
          type="checkbox"
          className="me-switch"
          checked={cycle.share_coach}
          onChange={(event) =>
            void call("/api/auth/health/cycle/settings", "PUT", {
              share_coach: event.target.checked,
            })
          }
        />
      </label>
    </>
  );
}
