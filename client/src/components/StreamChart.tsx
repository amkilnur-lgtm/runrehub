import { useEffect, useLayoutEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { CHART_HEIGHT, CHART_WIDTH, projectX, projectY, unprojectX } from "../chart/chart-utils";
import { ChartModel, IntervalBand, IntervalBandLabel } from "../types/workout";

const LABEL_MIN_GAP_PX = 8;

export function StreamChart({
  title,
  model,
  color,
  formatter,
  bands = [],
  bandLabels = [],
  summary,
  footer,
  zones = [],
  refValue,
  unit = "",
  cursor = null,
  onCursor
}: {
  title: string;
  model: ChartModel | null;
  color: string;
  formatter: (value: number) => string;
  bands?: IntervalBand[];
  bandLabels?: IntervalBandLabel[];
  // вывод словами над графиком (client/DESIGN.md → «Графики»)
  summary?: string | null;
  footer?: React.ReactNode;
  // светлые полосы зон под линией (пульс): границы в единицах оси Y
  zones?: { from: number; to: number; color: string }[];
  // пунктир (средний темп)
  refValue?: number | null;
  unit?: string;
  // общий курсор для всех графиков тренировки — дистанция в метрах
  cursor?: number | null;
  onCursor?: (meters: number | null) => void;
}) {
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cursorHandlerRef = useRef<{ onCursor?: (meters: number | null) => void; xMax: number }>({ xMax: 0 });

  // Подписи серий стоят по центру своей группы полос и не обрезаются по её
  // ширине, поэтому на узком экране соседние могут наехать друг на друга.
  // Замеряем после отрисовки: крайние подтягиваем внутрь графика, наехавшие прячем.
  useLayoutEffect(() => {
    const row = labelsRef.current;
    if (!row) {
      return undefined;
    }

    const layout = () => {
      const items = Array.from(row.querySelectorAll<HTMLElement>(".chart-band-label"));
      for (const item of items) {
        item.style.transform = "translateX(-50%)";
        item.style.visibility = "";
      }

      const rowBox = row.getBoundingClientRect();
      for (const item of items) {
        const box = item.getBoundingClientRect();
        const overflowLeft = rowBox.left - box.left;
        const overflowRight = box.right - rowBox.right;
        const shift = overflowLeft > 0 ? overflowLeft : overflowRight > 0 ? -overflowRight : 0;
        if (shift) {
          item.style.transform = `translateX(calc(-50% + ${Math.round(shift)}px))`;
        }
      }

      let lastRight = Number.NEGATIVE_INFINITY;
      for (const item of items) {
        const box = item.getBoundingClientRect();
        if (box.left < lastRight + LABEL_MIN_GAP_PX) {
          item.style.visibility = "hidden";
          continue;
        }

        lastRight = box.right;
      }
    };

    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(row);

    return () => observer.disconnect();
  }, [bandLabels]);

  // Палец: первые 8 px решают направление. Вбок — ведём курсор до отпускания пальца,
  // даже если он уходит вниз (прокрутку отменяем). Вверх-вниз — обычная прокрутка.
  useEffect(() => {
    const node = gridRef.current;
    if (!node) return undefined;
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let mode: "undecided" | "scrub" | "scroll" = "undecided";
    const moveTo = (clientX: number) => {
      const { onCursor: handler, xMax: max } = cursorHandlerRef.current;
      if (!handler || max <= 0) return;
      const rect = node.getBoundingClientRect();
      handler(unprojectX((clientX - rect.left) / rect.width, max));
    };
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      lastY = touch.clientY;
      mode = "undecided";
      moveTo(touch.clientX);
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      // жест целиком наш (touch-action: none): браузер не перехватит его посередине
      event.preventDefault();
      if (mode === "undecided") {
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);
        if (dx < 8 && dy < 8) return;
        mode = dx >= dy ? "scrub" : "scroll";
      }
      if (mode === "scrub") {
        moveTo(touch.clientX);
      } else {
        // вертикальный жест над графиком — прокручиваем страницу сами
        window.scrollBy(0, lastY - touch.clientY);
      }
      lastY = touch.clientY;
    };
    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
    };
  }, [model === null]);

  if (!model) {
    return (
      <div className="chart-card">
        <div className="chart-title-row">
          <span className="muted trainer-dashboard-eyebrow">{title}</span>
        </div>
        <div className="chart-empty muted">Нет данных для этого графика.</div>
      </div>
    );
  }

  const scale =
    model.yMin !== undefined && model.yMax !== undefined
      ? { min: model.yMin, max: model.yMax, invert: Boolean(model.invertY) }
      : null;
  const xMax = model.xMax ?? 0;
  cursorHandlerRef.current = { onCursor, xMax };
  // у пульса ось подписана границами зон (130 · 150 · 162), а не равными шагами
  const zoneTicks =
    scale && zones.length
      ? zones
          .map((zone) => zone.from)
          .filter((value) => value > scale.min && value < scale.max)
          .map((value) => ({ value, top: `${projectY(value, scale.min, scale.max, scale.invert) * 100}%` }))
      : null;
  const yTicks = zoneTicks ?? model.yTicks.map((value, index) => ({ value, top: model.yTickPositions[index]! }));
  const series = model.series ?? [];

  // ближайшая точка ряда к курсору (ряд отсортирован по дистанции)
  let hover: { left: number; top: number; meters: number; value: number } | null = null;
  if (cursor !== null && scale && series.length && xMax > 0) {
    let lo = 0;
    let hi = series.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid]!.x < cursor) lo = mid + 1;
      else hi = mid;
    }
    const point = series[lo]!;
    hover = {
      left: projectX(point.x, xMax),
      top: projectY(point.y, scale.min, scale.max, scale.invert),
      meters: point.x,
      value: point.y
    };
  }

  // мышь и перо; касания пальцем обрабатывает touch-обработчик выше
  function handlePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || !onCursor || xMax <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onCursor(unprojectX((event.clientX - rect.left) / rect.width, xMax));
  }

  return (
    <div className="chart-card ds-chart">
      <div className="ds-chart-head">
        <b>{title}</b>
        <span>
          {model.summaryLeftLabel === "Средний" ? "ср." : model.summaryLeftLabel} {model.summaryLeft.replace(" уд/мин", "")}
          {model.axisCaption === "УД/МИН" ? ` · макс. ${model.summaryRight.replace(" уд/мин", "")}` : " /км"}
        </span>
      </div>
      {summary ? <p className="ds-chart-msg">{summary}</p> : null}
      {bandLabels.length ? (
        <div className="chart-x-wrap chart-band-label-row">
          <div />
          <div className="chart-band-labels" ref={labelsRef}>
            {bandLabels.map((item) => (
              <span
                key={`${item.label}-${item.center}`}
                className="chart-band-label"
                style={{ left: item.center }}
              >
                {item.label}
              </span>
            ))}
          </div>
          <div className="chart-side-gutter" aria-hidden="true" />
        </div>
      ) : null}
      <div className="chart-frame">
        <div className="chart-grid-wrap">
          <div className="chart-y-axis">
            {yTicks.map((tick, index) => (
              <span key={`${tick.value}-${index}`} style={{ top: tick.top }}>
                {formatter(tick.value)}
              </span>
            ))}
          </div>
          <div
            ref={gridRef}
            className="chart-grid"
            onPointerMove={handlePointer}
            onPointerDown={handlePointer}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") onCursor?.(null);
            }}
          >
            {scale
              ? zones.map((zone) => {
                  const y1 = projectY(Math.min(zone.to, scale.max), scale.min, scale.max, scale.invert);
                  const y2 = projectY(Math.max(zone.from, scale.min), scale.min, scale.max, scale.invert);
                  const top = Math.min(y1, y2);
                  const height = Math.abs(y2 - y1);
                  if (zone.from >= scale.max || zone.to <= scale.min || height <= 0) return null;
                  return (
                    <div
                      key={`zone-${zone.from}`}
                      className="chart-zone-band"
                      style={{ top: `${top * 100}%`, height: `${height * 100}%`, background: zone.color }}
                      aria-hidden="true"
                    />
                  );
                })
              : null}
            {/* Рабочие отрезки интервальной тренировки — подложка под линией */}
            {bands.map((band, index) => (
              <div
                key={`band-${index}`}
                className="chart-work-band"
                style={{ left: band.left, width: band.width }}
                aria-hidden="true"
              />
            ))}
            {yTicks.map((tick, index) => (
              <div key={`${tick.value}-${index}`} className="chart-grid-line" style={{ top: tick.top }} />
            ))}
            {scale && refValue ? (
              <div
                className="chart-ref-line"
                style={{ top: `${projectY(refValue, scale.min, scale.max, scale.invert) * 100}%`, borderColor: color }}
                aria-hidden="true"
              />
            ) : null}
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="chart-svg" preserveAspectRatio="none">
              {/* тонкая линия без заливки (client/DESIGN.md → «Графики») */}
              <path
                d={model.linePath}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {hover ? (
              <>
                <div className="chart-cursor" style={{ left: `${hover.left * 100}%` }} aria-hidden="true" />
                <div
                  className="chart-dot"
                  style={{ left: `${hover.left * 100}%`, top: `${hover.top * 100}%`, background: color }}
                  aria-hidden="true"
                />
                <div
                  className={hover.left > 0.6 ? "chart-tip is-left" : "chart-tip"}
                  style={{ left: `${hover.left * 100}%` }}
                  role="status"
                >
                  {(hover.meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} км ·{" "}
                  {formatter(hover.value)}
                  {unit}
                </div>
              </>
            ) : null}
          </div>
          <div className="chart-side-gutter" aria-hidden="true" />
        </div>
      </div>
      <div className="chart-x-wrap">
        <div />
        <div className="chart-x-axis">
          {model.xTicks.map((tick, index) => (
            <span
              key={`${tick}-${index}`}
              className={
                index === 0 ? "chart-x-tick chart-x-tick-start" : "chart-x-tick"
              }
              style={{ left: model.xTickPositions[index] }}
            >
              {model.xTickLabels[index]}
              {index === model.xTicks.length - 1 ? " км" : ""}
            </span>
          ))}
        </div>
        <div className="chart-side-gutter" aria-hidden="true" />
      </div>
      {footer}
    </div>
  );
}
