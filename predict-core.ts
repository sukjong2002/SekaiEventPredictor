
import { EventRanking, PredictionResult, ConfidenceInterval, PredictionModel, DailyProjection, TimePoint } from "./Struct";

export function getHalfTime(time: Date) {
    let half =
        (time.getUTCHours() + 9) * 2 + (time.getUTCMinutes() === 0 ? 0 : 1);
    return half >= 48 ? half - 48 : half;
}

export function getHalfTimeFromBegin(time: Date, eventStartTime: number) {
    return Math.round((time.getTime() - eventStartTime) / (30 * 60 * 1000));
}

export function processDayScores(obj: EventRanking[], model: PredictionModel, rank: number, eventStartTime: number) {
    let dayPT: { score: number, timestamp: number }[] = [];
    let lastPoints: EventRanking[] = new Array(16 + 1).fill(null);

    for (let i = 0; i <= 16; ++i) {
        dayPT.push({ score: 0, timestamp: 0 });
    }

    obj.forEach((it, i) => {
        let day = Math.floor(
            (it.timestamp.getTime() - 1 - (eventStartTime - 15 * 3600 * 1000)) /
            1000 /
            3600 /
            24
        );

        if (day >= 0 && day < lastPoints.length) {
            lastPoints[day] = it;
        }

        if (it.timestamp.getUTCHours() === 15 && it.timestamp.getUTCMinutes() === 0) {
            if (day >= 0 && day < dayPT.length) {
                dayPT[day].score = it.score;
                dayPT[day].timestamp = it.timestamp.getTime();
            }
        }

        if (i >= 1 && day >= 0 && day < dayPT.length && dayPT[day].score === 0) {
            let pre = obj[i - 1];
            let lastDayEndTime = new Date(eventStartTime - 15 * 3600 * 1000 + (day + 1) * 24 * 3600 * 1000);

            if (lastDayEndTime.getTime() >= pre.timestamp.getTime() && lastDayEndTime.getTime() <= it.timestamp.getTime()) {
                let percentPre = model.dayPeriod[rank][getHalfTime(pre.timestamp)];
                let percentNow = model.dayPeriod[rank][getHalfTime(it.timestamp)];

                let scorePerDay = (it.score - pre.score) / (percentNow + 1 - percentPre);
                let averageScore = scorePerDay * (1 - percentPre);

                dayPT[day].score = averageScore + pre.score;
                dayPT[day].timestamp = lastDayEndTime.getTime();
            }
        }
    });

    for (let i = 0; i < dayPT.length; i++) {
        let d = i;
        if (dayPT[i].score === 0 && d < lastPoints.length && lastPoints[d]) {
            dayPT[i].score = lastPoints[d].score;
            dayPT[i].timestamp = lastPoints[d].timestamp.getTime();
        }
    }

    return dayPT;
}

export function processToday(obj: EventRanking[]): number[] {
    let start = 0;
    obj.forEach((it, i) => {
        if (
            it.timestamp.getUTCHours() === 15 &&
            it.timestamp.getUTCMinutes() === 0
        ) {
            start = i;
        }
    });
    let today = [];
    for (let i = 0; i <= 48; ++i) today.push(0);

    let lastTime = 0;
    for (let i = start; i < obj.length; ++i) {
        let it = obj[i];
        let halfTime = getHalfTime(it.timestamp);
        if (
            i > 0 &&
            it.timestamp.getTime() - obj[i - 1].timestamp.getTime() > 24 * 3600 * 1000
        )
            return [];
        if (halfTime < lastTime) return [];
        today[halfTime] = it.score - obj[start].score;
        lastTime = halfTime;
    }
    return today;
}

export function processLast(today: number[], last: number): number[] {
    let count = 0;
    let lastToday = today.slice();
    for (let i = 47; i >= 0; --i) {
        if (count >= last) lastToday[i] = 0;
        if (lastToday[i] !== 0) count++;
    }
    return lastToday;
}

export function getLSE(today: number[], target: number[], predict: number) {
    let sum = 0;

    today.forEach((it, i) => {
        if (it === 0 || it === undefined || target.length <= i) return;
        let precent = it / predict - target[i];
        sum += precent * precent;
    });

    return sum;
}

export function processLSE(today: number[], target: number[]) {
    let l = 1,
        r = 33333333,
        mid = Math.floor((l + r) / 2);
    while (l < r) {
        let midL = getLSE(today, target, mid - 1);
        let midR = getLSE(today, target, mid);
        if (midL === midR) return mid;
        else if (midL < midR) r = mid - 1;
        else l = mid + 1;
        mid = Math.round((l + r) / 2);
    }
    return mid;
}

export function calculateConfidenceInterval(
    prediction: number,
    modelStdDev: number,
    confidenceLevel: number
): ConfidenceInterval {
    // 95% -> 1.96, 90% -> 1.645, 80% -> 1.28, 70% -> 1.04
    const zScore = confidenceLevel === 95 ? 1.96 : (confidenceLevel === 80 ? 1.28 : 1.04);

    const predictionStdDev = prediction * modelStdDev;
    const margin = zScore * predictionStdDev;

    const rawLower = prediction - margin;
    const rawUpper = prediction + margin;

    if (rawLower < 0) {
        return {
            lower: 0,
            upper: Math.round(rawUpper + Math.abs(rawLower))
        };
    }

    return {
        lower: Math.round(rawLower),
        upper: Math.round(rawUpper)
    };
}

export function getModelStdDev(model: PredictionModel, rank: number, halfTime: number, isLastDay: boolean): number {
    if (isLastDay && model.lastDayPeriodStdDev && model.lastDayPeriodStdDev[rank]) {
        return model.lastDayPeriodStdDev[rank][halfTime] || 0;
    } else if (!isLastDay && model.dayPeriodStdDev && model.dayPeriodStdDev[rank]) {
        return model.dayPeriodStdDev[rank][halfTime] || 0;
    }
    return 0;
}

export function calculateDailyProjection(
    dayScores: { score: number, timestamp: number }[],
    lastDayEnd: number,
    totalDays: number,
    finalPrediction: number,
    scorePerNormalDay: number,
    model: PredictionModel,
    rank: number,
    eventStartTime: number,
    eventEndTime?: number
): DailyProjection[] {
    let projection: DailyProjection[] = [];

    // Day 0
    projection.push({
        timestamp: eventStartTime,
        endScore: dayScores[0]?.score || 0,
        isActual: true
    });

    // Actual Data
    for (let d = 1; d < lastDayEnd; d++) {
        let ts = dayScores[d]?.timestamp || (eventStartTime - 15 * 3600 * 1000 + d * 24 * 3600 * 1000);

        if (dayScores[d]?.score > 0) {
            projection.push({
                timestamp: ts,
                endScore: Math.round(dayScores[d].score),
                isActual: true
            });
        }
    }

    // Predicted
    for (let d = lastDayEnd; d <= totalDays; d++) {
        let predictedScore: number;
        let ts: number;

        if (d < totalDays) {
            predictedScore = dayScores[0].score + scorePerNormalDay * d;
            ts = eventStartTime - 15 * 3600 * 1000 + d * 24 * 3600 * 1000;
        } else {
            predictedScore = finalPrediction;
            if (eventEndTime) {
                ts = eventEndTime;
            } else {
                ts = eventStartTime - 15 * 3600 * 1000 + d * 24 * 3600 * 1000;
            }
        }

        let daysAhead = d - lastDayEnd + 1;
        let baseStdDev = model.dayPeriodStdDev?.[rank]?.[24] || 0.05;
        let scaledStdDev = baseStdDev * Math.sqrt(daysAhead);

        projection.push({
            timestamp: ts,
            endScore: Math.round(predictedScore),
            isActual: false,
            confidence70: calculateConfidenceInterval(predictedScore, scaledStdDev, 70),
            confidence80: calculateConfidenceInterval(predictedScore, scaledStdDev, 80)
        });
    }

    return projection;
}

export function calculateHourlyProjectionToday(
    todayScores: number[],
    todayBeginScore: number,
    predictedTodayEndScore: number,
    currentHalfTime: number,
    model: PredictionModel,
    rank: number,
    isLastDay: boolean,
    eventStartTime: number,
    dayIndex: number,
    currentTime?: number,
    eventEndTime?: number
): TimePoint[] {
    let projection: TimePoint[] = [];

    let periodModel = isLastDay ? model.lastDayPeriod[rank] : model.dayPeriod[rank];
    let periodStdDev = isLastDay ? model.lastDayPeriodStdDev?.[rank] : model.dayPeriodStdDev?.[rank];

    let todayIncrement = predictedTodayEndScore - todayBeginScore;

    for (let h = 0; h <= 47; h++) {
        let dayOffset = (dayIndex - 1) * 24 * 3600 * 1000;
        let timestampValue = eventStartTime - 15 * 3600 * 1000 + dayOffset + h * 30 * 60 * 1000;

        if (eventEndTime && timestampValue > eventEndTime) {
            continue;
        }

        let timestamp = new Date(timestampValue);
        let isActual = h <= currentHalfTime && todayScores[h] > 0;
        let score: number;

        if (isActual) {
            score = todayBeginScore + todayScores[h];
        } else {
            if (!periodModel || !periodModel[h]) continue;

            let relativeProgress = periodModel[h];
            score = todayBeginScore + todayIncrement * relativeProgress;

            let stdDev = periodStdDev?.[h] || 0.05;
            projection.push({
                timestamp: timestamp,
                score: Math.round(score),
                isActual: false,
                confidence70: calculateConfidenceInterval(score, stdDev, 70),
                confidence80: calculateConfidenceInterval(score, stdDev, 80)
            });
            continue;
        }

        projection.push({
            timestamp: timestamp,
            score: Math.round(score),
            isActual: isActual
        });
    }

    return projection;
}


export interface PredictConfig {
    eventType: string;
    eventStartTime: number;
    eventEndTime?: number;
    totalDays: number;
    currentTime?: number;
}

export function prepareScores(rawData: { timestamp: number | string | Date, score: number }[], rank: number): EventRanking[] {
    let scores = rawData.map((item, index) => ({
        id: index,
        eventId: 0,
        timestamp: new Date(item.timestamp),
        rank: rank,
        score: item.score,
        userId: null,
        userName: "API User"
    }));

    //Remove illegal data (30-minute intervals only) and sort
    scores = scores.filter(
        (it) =>
            it.timestamp.getUTCMinutes() === 0 || it.timestamp.getUTCMinutes() === 30
    );
    scores = scores.sort((a, b) => a.timestamp.valueOf() - b.timestamp.valueOf());

    return scores;
}

export function predict(
    rank: number,
    scores: EventRanking[],
    model: PredictionModel,
    config: PredictConfig
): PredictionResult | null {

    const { eventStartTime, eventEndTime, totalDays, currentTime } = config;

    if (scores.length === 0) {
        // console.log(`T${rank} Cannot predict: No data`);
        return null;
    }

    // Process data
    let day = processDayScores(scores, model, rank, eventStartTime);
    let firstUsefulDay = 0;
    let lastDayEnd = 0;

    day.forEach((it, i) => {
        if (firstUsefulDay === 0 && it.score > 0) {
            firstUsefulDay = i + 1;
        }
        if (it.score > 0) {
            lastDayEnd = i + 1;
        }
    });

    if (firstUsefulDay <= 0) {
        // console.log(`T${rank} Cannot predict: Event just started in a day`);
        return null;
    }

    let todayBeginScore = day[lastDayEnd - 1].score;
    let todayScores = processToday(scores);

    let halfTime =
        todayScores.length === 0
            ? 0
            : getHalfTime(scores[scores.length - 1].timestamp);


    let isLastDay = lastDayEnd === totalDays;
    let result: number;
    let stdDev: number;
    let modelStdDev: number;

    if (!isLastDay) {
        let day0 = day[firstUsefulDay - 1].score;
        let todayProcess = model.dayPeriod[rank][halfTime];
        let todayScore = halfTime === 0 ? 0 : processLSE(todayScores, model.dayPeriod[rank]);

        let scorePerNormalDay =
            (todayBeginScore - day0 + todayScore * todayProcess) /
            (lastDayEnd - firstUsefulDay + todayProcess);

        // This variable was unused in original logic but calculation was there
        // let scoreNormalDays = scorePerNormalDay * (totalDays - 1);

        let scoreNormalDays = scorePerNormalDay * (totalDays - 1);
        let lastDayScore =
            (scoreNormalDays / (1 - model.lastDay[rank][totalDays])) *
            model.lastDay[rank][totalDays];

        result = Math.round(
            day[0].score + scoreNormalDays / (1 - model.lastDay[rank][totalDays])
        );

        if (eventEndTime) {
            let lastDayStartIdx = (totalDays - 1);
            let lastDayStartTimestamp = eventStartTime - 15 * 3600 * 1000 + lastDayStartIdx * 24 * 3600 * 1000;
            let msDiff = eventEndTime - lastDayStartTimestamp;
            let index = Math.floor(msDiff / (30 * 60 * 1000));

            if (index < 0) index = 0;
            if (index > 47) index = 47;

            let progress = model.lastDayPeriod[rank][index];
            if (progress === undefined) progress = 1.0;

            result = Math.round((result - lastDayScore) + lastDayScore * progress);
        }

        modelStdDev = getModelStdDev(model, rank, halfTime, false);
        stdDev = result * modelStdDev;

        let dailyProjection = calculateDailyProjection(
            day,
            lastDayEnd,
            totalDays,
            result,
            scorePerNormalDay,
            model,
            rank,
            eventStartTime,
            eventEndTime
        );

        let predictedTodayEndScore = lastDayEnd < totalDays
            ? (day[0].score + scorePerNormalDay * lastDayEnd)
            : result;

        let hourlyProjectionToday = calculateHourlyProjectionToday(
            todayScores,
            todayBeginScore,
            predictedTodayEndScore,
            halfTime,
            model,
            rank,
            false,
            eventStartTime,
            lastDayEnd,
            currentTime,
            eventEndTime
        );

        let currentScore = scores.length > 0 ? scores[scores.length - 1].score : 0;

        return {
            rank: rank,
            prediction: result,
            currentScore: currentScore,
            currentDay: lastDayEnd,
            currentTime: currentTime ? new Date(currentTime) : new Date(),
            confidence70: calculateConfidenceInterval(result, modelStdDev, 70),
            confidence80: calculateConfidenceInterval(result, modelStdDev, 80),
            stdDev: stdDev,
            dailyProjection: dailyProjection,
            hourlyProjectionToday: hourlyProjectionToday
        };

    } else {
        // Last Day Logic
        let todayProcess = model.lastDayPeriod[rank][halfTime];

        let todayScoreNowPredict =
            halfTime === 0
                ? 0
                : processLSE(todayScores, model.lastDayPeriod[rank]);

        let todayScoreLastPredict =
            halfTime <= 2
                ? todayScoreNowPredict
                : processLSE(processLast(todayScores, 2), model.lastDayPeriod[rank]);

        // Unused intermediate vars?
        // let todayScoreTodayPredict = ...

        let todayScorePastPredict =
            ((todayBeginScore - day[0].score) / (1 - model.lastDay[rank][totalDays])) *
            model.lastDay[rank][totalDays];

        let todayScore =
            (todayScoreLastPredict * todayProcess + todayScoreNowPredict * (1 - todayProcess)) * Math.min(1, todayProcess * 2) +
            todayScorePastPredict * Math.max(0, 1 - todayProcess * 2);

        result = Math.round(todayBeginScore + todayScore);

        if (eventEndTime) {
            let lastDayStartIdx = (totalDays - 1);
            let lastDayStartTimestamp = eventStartTime - 15 * 3600 * 1000 + lastDayStartIdx * 24 * 3600 * 1000;
            let msDiff = eventEndTime - lastDayStartTimestamp;
            let index = Math.floor(msDiff / (30 * 60 * 1000));
            if (index < 0) index = 0;
            if (index > 47) index = 47;

            let progress = model.lastDayPeriod[rank][index];
            if (progress === undefined) progress = 1.0;

            result = Math.round(todayBeginScore + todayScore * progress);
        }

        modelStdDev = getModelStdDev(model, rank, halfTime, true);
        stdDev = result * modelStdDev;

        let scorePerNormalDay = (todayBeginScore - day[0].score) / (totalDays - 1);

        let dailyProjection = calculateDailyProjection(
            day,
            lastDayEnd,
            totalDays,
            result,
            scorePerNormalDay,
            model,
            rank,
            eventStartTime,
            eventEndTime
        );

        let hourlyProjectionToday = calculateHourlyProjectionToday(
            todayScores,
            todayBeginScore,
            result,
            halfTime,
            model,
            rank,
            true,
            eventStartTime,
            lastDayEnd,
            currentTime,
            eventEndTime
        );

        let currentScore = scores.length > 0 ? scores[scores.length - 1].score : 0;

        return {
            rank: rank,
            prediction: result,
            currentScore: currentScore,
            currentDay: lastDayEnd,
            currentTime: currentTime ? new Date(currentTime) : new Date(),
            confidence70: calculateConfidenceInterval(result, modelStdDev, 70),
            confidence80: calculateConfidenceInterval(result, modelStdDev, 80),
            stdDev: stdDev,
            dailyProjection: dailyProjection,
            hourlyProjectionToday: hourlyProjectionToday
        };
    }
}
