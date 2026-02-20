export interface RecoveryRecord {
  cycle_id: number;
  sleep_id?: string;
  created_at?: string;
  updated_at?: string;
  score?: {
    recovery_score?: number;
    resting_heart_rate?: number;
    hrv_rmssd_milli?: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface SleepRecord {
  id: string;
  cycle_id?: number;
  start?: string;
  end?: string;
  score?: {
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
    respiratory_rate?: number;
    stage_summary?: {
      total_in_bed_time_milli?: number;
      total_awake_time_milli?: number;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface CycleRecord {
  id: number;
  start?: string;
  end?: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
    kilojoule?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface WorkoutRecord {
  id: string;
  sport_name?: string;
  sport_id?: number;
  start?: string;
  end?: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
    kilojoule?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
