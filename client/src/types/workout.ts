export type StreamSeries = {
  distance: number[];
  time: number[];
  heartrate: number[];
  velocity_smooth: number[];
} | null;

export type WorkoutData = {
  workout: {
    id: number;
    name: string;
    start_date: string;
    distance_meters: number;
    moving_time_seconds: number;
    elevation_gain: number;
    average_speed: number | null;
    average_heartrate: number | null;
    max_heartrate?: number | null;
    athlete_name?: string;
    athlete_id?: number;
  };
  laps: Array<{
    id: number;
    name: string | null;
    distance_meters: number;
    elapsed_time_seconds: number;
    average_speed: number | null;
    average_heartrate: number | null;
    elevation_gain: number | null;
  }>;
  streams: StreamSeries;
};

export type ChartPoint = {
  x: number;
  y: number;
};

export type ChartModel = {
  linePath: string;
  areaPath: string;
  yTicks: number[];
  yTickPositions: string[];
  xTicks: number[];
  xTickLabels: string[];
  xTickPositions: string[];
  axisCaption: string;
  xLabel: string;
  summaryLeft: string;
  summaryLeftLabel: string;
  summaryRight: string;
  summaryRightLabel: string;
};
