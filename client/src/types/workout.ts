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
    is_owner?: boolean;
    gps_fix?: {
      is_corrected: boolean;
      kind: "gps_autofix" | "manual_distance" | "manual_time" | "trim";
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
        split_strategy: "stream" | "synthetic_even";
      } | {
        target_moving_time_seconds: number;
        source_moving_time_seconds: number;
        scale_factor: number;
        split_strategy: "stream" | "synthetic_even";
      } | {
        trim_start_meters: number;
        trim_end_meters: number;
        source_distance_meters: number;
        source_moving_time_seconds: number;
        split_strategy: "stream" | "synthetic_even";
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
    start_index?: number | null;
    end_index?: number | null;
  }>;
  streams: StreamSeries;
  // Разметка рабочих отрезков интервальной тренировки, null для обычных пробежек
  structure: WorkoutStructure | null;
};

export type WorkoutStructure = {
  work_lap_ids: number[];
  sets: Array<{
    count: number;
    distance_meters: number;
    pace_seconds_per_km: number;
    moving_time_seconds: number;
    average_heartrate: number | null;
    label: string;
  }>;
  segments: Array<{
    set_index: number;
    lap_ids: number[];
    start_index: number | null;
    end_index: number | null;
  }>;
};

export type IntervalBand = {
  left: string;
  width: string;
  setIndex: number;
  from: number;
  to: number;
};

export type IntervalBandLabel = {
  center: string;
  label: string;
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
