export interface EventRanking {
    id: number;
    eventId: number;
    timestamp: Date;
    rank: number;
    score: number;
    userId: any;
    userName: string;
}

export interface Data {
    eventRankings: EventRanking[];
}

export interface EventData {
    status: string;
    data: Data;
    message?: any;
}

export interface SimpleRanking {
    time: Date,
    pt: number
}

export interface OutRanking {
    beginTime: Date;
    lastTime: Date;
    lastScore: number;
    dayScores: number[];
    halfHourScores: number[];
}

export interface ConfidenceInterval {
    lower: number;
    upper: number;
}

export interface TimePoint {
    timestamp: Date;          // 시점
    score: number;            // 점수 (실제 또는 예측)
    isActual: boolean;        // 실제 데이터 여부
    confidence95?: ConfidenceInterval;  // 예측인 경우 신뢰구간
    confidence80?: ConfidenceInterval;
}

export interface DailyProjection {
    day: number;              // 일차 (0부터 시작)
    endScore: number;         // 해당 일의 끝 시점 점수 (15:00 UTC)
    isActual: boolean;        // 실제 데이터 여부
    confidence95?: ConfidenceInterval;
    confidence80?: ConfidenceInterval;
}

export interface PredictionResult {
    rank: number;
    prediction: number;       // 최종 예측 점수
    currentScore: number;     // 현재 점수
    currentDay: number;       // 현재 일차
    currentTime: Date;        // 예측 시점

    // 신뢰구간 (최종 점수)
    confidence95?: ConfidenceInterval;
    confidence80?: ConfidenceInterval;
    stdDev?: number;

    // 일별 예측 (이벤트 전체 기간)
    dailyProjection: DailyProjection[];

    // 당일 시간별 예측 (30분 단위, 현재 ~ 당일 끝)
    hourlyProjectionToday: TimePoint[];
}

export interface PredictionModel {
    dayPeriod: { [rank: number]: number[] };
    dayPeriodStdDev?: { [rank: number]: number[] };
    lastDay: { [rank: number]: number[] };
    lastDayStdDev?: { [rank: number]: number[] };
    lastDayPeriod: { [rank: number]: number[] };
    lastDayPeriodStdDev?: { [rank: number]: number[] };
}