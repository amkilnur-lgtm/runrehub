import { CHART_HEIGHT, CHART_WIDTH } from "../chart/chart-utils";
import { ChartModel } from "../types/workout";

export function StreamChart({
  title,
  model,
  color,
  formatter
}: {
  title: string;
  model: ChartModel | null;
  color: string;
  formatter: (value: number) => string;
}) {
  if (!model) {
    return (
      <div className="chart-card">
        <div className="chart-title-row">
          <strong>{title}</strong>
        </div>
        <div className="chart-empty muted">Нет данных Strava для этого графика.</div>
      </div>
    );
  }

  return (
    <div className="chart-card">
      <div className="chart-title-row">
        <strong className="chart-title">{title}</strong>
        <span className="muted chart-axis-caption">{model.axisCaption}</span>
      </div>
      <div className="chart-metrics">
        <div className="chart-metric">
          <div className="chart-metric-value">{model.summaryLeft}</div>
          <div className="chart-metric-label">{model.summaryLeftLabel}</div>
        </div>
        <div className="chart-metric">
          <div className="chart-metric-value">{model.summaryRight}</div>
          <div className="chart-metric-label">{model.summaryRightLabel}</div>
        </div>
      </div>
      <div className="chart-frame">
        <div className="chart-grid-wrap">
          <div className="chart-y-axis">
            {model.yTicks.map((tick, index) => (
              <span key={`${tick}-${index}`} style={{ top: model.yTickPositions[index] }}>
                {formatter(tick)}
              </span>
            ))}
          </div>
          <div className="chart-grid">
            {model.yTicks.map((tick, index) => (
              <div
                key={`${tick}-${index}`}
                className="chart-grid-line"
                style={{ top: model.yTickPositions[index] }}
              />
            ))}
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="chart-svg" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`${title}-gradient`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.48" />
                  <stop offset="42%" stopColor={color} stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0.03" />
                </linearGradient>
              </defs>
              <path d={model.areaPath} fill={`url(#${title}-gradient)`} />
              <path
                d={model.linePath}
                fill="none"
                stroke="rgba(255, 255, 255, 0.86)"
                strokeWidth="2.3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <path
                d={model.linePath}
                fill="none"
                stroke={color}
                strokeOpacity="0.96"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
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
                index === 0 ? "chart-x-tick chart-x-tick-start" : index === model.xTicks.length - 1 ? "chart-x-tick chart-x-tick-end" : "chart-x-tick"
              }
              style={{ left: model.xTickPositions[index] }}
            >
              {model.xTickLabels[index]}
            </span>
          ))}
        </div>
        <div className="chart-side-gutter" aria-hidden="true" />
      </div>
      <div className="chart-x-wrap">
        <div />
        <div className="chart-x-label muted">{model.xLabel}</div>
        <div className="chart-side-gutter" aria-hidden="true" />
      </div>
    </div>
  );
}
