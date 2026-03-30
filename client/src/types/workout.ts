export type StreamSeries = {
  distance: number[];
  time: number[];
  heartrate: number[];
  cadence: number[];
  velocity_smooth: number[];
  latlng: [number, number][];
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
    coach_comment?: string | null;
    athlete_name?: string;
    athlete_id?: number;
    gps_fix?: {
      is_corrected: boolean;
      kind: "gps_autofix" | "manual_distance";
      removed_segments: Array<{
        startIndex: number;
        endIndex: number;
        removedDistanceMeters: number;
        removedTimeSeconds: number;
        peakSpeedMetersPerSecond: number;
      }> | {
        target_distance_meters: number;
        source_distance_meters: number;
        scale_factor: number;
      };
      created_by_user_id: number;
      created_at: string;
      updated_at: string;
    } | null;
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
