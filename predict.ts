import axios from "axios";
import { EventData, EventRanking, PredictionResult, ConfidenceInterval, PredictionModel, DailyProjection, TimePoint, PredictionRequestInput } from "./Struct";
import { readFileSync, writeFileSync } from "fs";
import HttpsProxyAgent from 'https-proxy-agent';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

let agent = HttpsProxyAgent('http://localhost:1087');

let proxy = false;
let debug = false;
let debugTestMode = false; // Set to true to test with historical data at 50% progress
let debugTestEventId = 117; // Event ID to test with
let debugTestProgressRatio = 0.6; // Use 60% of event data for prediction

// Data source configuration
const USE_RANKING_DB = process.env.USE_RANKING_DB === 'true';
const RANKING_DB_API_URL = process.env.RANKING_DB_API_URL || 'http://localhost:4000';

let event = 9;
let days = 8;
let eventStartTime = 0;
//let lastDayEnd = 0;
let eventType = "marathon";

let debugJson = {
    ranks: {},
    testMode: debugTestMode,
    testEventId: debugTestMode ? debugTestEventId : undefined,
    testProgressRatio: debugTestMode ? debugTestProgressRatio : undefined
};

async function updateEvent() {
    if (debugTestMode) {
        // Test mode: Fetch historical event data from API
        console.log(`\n=== DEBUG TEST MODE ===`);
        console.log(`Testing with event ${debugTestEventId} at ${debugTestProgressRatio * 100}% progress`);

        event = debugTestEventId;

        try {
            // Fetch event info from API
            const response = await axios.get(
                `https://strapi.sekai.best/sekai-event/${debugTestEventId}`, {
                httpsAgent: proxy ? agent : null,
            }
            );

            if (response.data && response.data.eventType) {
                eventType = response.data.eventType;
                eventStartTime = response.data.startAt;
                days = Math.floor(
                    (response.data.aggregateAt - response.data.startAt) /
                    1000 /
                    3600 /
                    24
                );

                console.log(`Event type: ${eventType}`);
                console.log(`Total days: ${days}`);
                console.log(`Start: ${new Date(eventStartTime).toISOString()}`);
                console.log(`End: ${new Date(response.data.aggregateAt).toISOString()}`);
            } else {
                throw new Error('Invalid event data from API');
            }
        } catch (error) {
            console.log(`Warning: Could not fetch event from API: ${error.message}`);
            console.log('Trying to load from events.json...');

            // Fallback to events.json for event metadata
            try {
                const { existsSync } = require('fs');
                if (existsSync('events.json')) {
                    const eventsData = JSON.parse(readFileSync('events.json', 'utf-8'));
                    const eventInfo = eventsData.find((e: any) => e.id === debugTestEventId);
                    if (eventInfo) {
                        eventType = eventInfo.eventType || (debugTestEventId === 18 ? 'cheerful_carnival' : 'marathon');

                        // Get event start time and duration from events.json
                        if (eventInfo.startAt && eventInfo.aggregateAt) {
                            eventStartTime = eventInfo.startAt;
                            days = Math.floor(
                                (eventInfo.aggregateAt - eventInfo.startAt) /
                                1000 / 3600 / 24
                            );

                            console.log(`Event type: ${eventType} (from events.json)`);
                            console.log(`Total days: ${days}`);
                            console.log(`Start: ${new Date(eventStartTime).toISOString()}`);
                            console.log(`End: ${new Date(eventInfo.aggregateAt).toISOString()}`);
                        } else {
                            console.log(`ERROR: Event ${debugTestEventId} found in events.json but missing startAt/aggregateAt`);
                            process.exit(1);
                        }
                    } else {
                        console.log(`ERROR: Event ${debugTestEventId} not found in events.json`);
                        process.exit(1);
                    }
                } else {
                    console.log(`ERROR: events.json not found and API failed`);
                    process.exit(1);
                }
            } catch (localError) {
                console.log(`ERROR loading events.json: ${localError.message}`);
                process.exit(1);
            }
        }

        debugJson["eventType"] = eventType;
        debugJson["days"] = days;
        debugJson["eventDayNow"] = Math.floor(days * debugTestProgressRatio);
        debugJson["eventStartTime"] = eventStartTime;
        debugJson["predictTime"] = Date.now();

        console.log(`Will simulate prediction at day ${debugJson["eventDayNow"]} of ${days}`);
        console.log(`=======================\n`);

    } else {
        // Normal mode: Get current event from API
        const response = await axios.get(
            `https://strapi.sekai.best/sekai-current-event`, {
            httpsAgent: proxy ? agent : null,
        }
        );
        //console.log(response)
        //console.log(response.data);
        event = response.data.eventId;
        eventType = response.data.eventJson.eventType;
        eventStartTime = response.data.eventJson.startAt;
        days = Math.floor(
            (response.data.eventJson.aggregateAt - response.data.eventJson.startAt) /
            1000 /
            3600 /
            24
        );
        let eventDayNow = Math.floor(
            (Date.now() - (response.data.eventJson.startAt - 15 * 3600 * 1000)) /
            1000 /
            3600 /
            24
        );
        if (eventDayNow > days) eventDayNow = days;
        console.log(`Current event ${event}(${eventType}), ${eventDayNow}/${days} days`);

        debugJson["eventType"] = eventType;
        debugJson["days"] = days;
        debugJson["eventDayNow"] = eventDayNow;
        debugJson["eventStartTime"] = eventStartTime;
        debugJson["predictTime"] = Date.now();
    }
}

// const ranks = [1, 2, 3, 4, 5, 10, 50, 100, 200, 300, 400, 500, 1000, 5000];
const ranks = [1, 2, 10, 100, 1000]
//const ranks = [100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000, 100000];
//const ranks = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
//const ranks = [1000, 5000, 10000];

function getHalfTime(time: Date) {
    let half =
        (time.getUTCHours() + 9) * 2 + (time.getUTCMinutes() === 0 ? 0 : 1);
    return half >= 48 ? half - 48 : half;
}

function getHalfTimeFromBegin(time: Date, eventStartTime: number) {
    return Math.round((time.getTime() - eventStartTime) / (30 * 60 * 1000));
}

async function getScores(rank: number, requestInput?: PredictionRequestInput, currentEventId?: number, currentEventStartTime?: number, currentDays?: number) {
    let scores: EventRanking[];

    if (requestInput) {
        // Use provided data
        scores = requestInput.data.map((item, index) => ({
            id: index,
            eventId: requestInput.rank, // Dummy
            timestamp: new Date(item.timestamp),
            rank: requestInput.rank,
            score: item.score,
            userId: null,
            userName: "API User"
        }));
    } else {
        // Get data from API (both normal and test mode)
        let response = await axios.get(
            `https://api.sekai.best/event/${currentEventId}/rankings/graph?region=kr&rank=${rank}`, {
            httpsAgent: proxy ? agent : null,
        }
        );
        let data = response.data as EventData;
        scores = data.data.eventRankings;
    }

    //Process illegal data (Multi array)
    if (scores.length > 0 && Array.isArray(scores[0])) {
        return [];
    }

    //Process illegal data (Incorrect event)
    if (!requestInput &&
        scores.length > 0 &&
        (scores[0].eventId !== currentEventId || scores[0].rank !== rank)
    ) {
        return [];
    }

    //Process time and sort
    scores.forEach((it) => {
        if (it.timestamp === undefined) console.log(it);
    });
    scores.forEach((it) => (it.timestamp = new Date(it.timestamp.valueOf())));

    // Test mode: Filter data to cutoff point (Only when NOT using requestInput)
    if (!requestInput && debugTestMode) {
        // Calculate cutoff point based on progress ratio
        const cutoffTime = currentEventStartTime + (currentDays * 24 * 3600 * 1000 * debugTestProgressRatio);

        // Filter to only include data up to cutoff point
        const originalLength = scores.length;
        scores = scores.filter(it => it.timestamp.getTime() <= cutoffTime);

        if (scores.length === 0) {
            console.log(`No data available at ${debugTestProgressRatio * 100}% progress for rank ${rank}`);
            return [];
        }

        console.log(`Loaded ${scores.length}/${originalLength} data points for rank ${rank} (up to ${debugTestProgressRatio * 100}% progress)`);
    }

    //Remove illegal data (30-minute intervals only)
    scores = scores.filter(
        (it) =>
            it.timestamp.getUTCMinutes() === 0 || it.timestamp.getUTCMinutes() === 30
    );
    scores = scores.sort((a, b) => a.timestamp.valueOf() - b.timestamp.valueOf());

    //console.log(`Got Data: ${rank}`)

    return scores;
}

function processDayScores(obj: EventRanking[], model: any, rank: number, eventStartTime: number) {
    let dayPT: { score: number, timestamp: number }[] = [];
    let lastPoints: EventRanking[] = new Array(16 + 1).fill(null);

    for (let i = 0; i <= 16; ++i) { // Increased to cover potential Day 3+
        dayPT.push({ score: 0, timestamp: 0 });
    }

    obj.forEach((it, i) => {
        let day = Math.floor(
            (it.timestamp.getTime() - 1 - (eventStartTime - 15 * 3600 * 1000)) /
            1000 /
            3600 /
            24
        );

        // Track last point for fallback
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

            //Ensure pre is in past day
            // Only interpolate if we cross the boundary
            if (lastDayEndTime.getTime() >= pre.timestamp.getTime() && lastDayEndTime.getTime() <= it.timestamp.getTime()) {
                let percentPre = model["dayPeriod"][rank][getHalfTime(pre.timestamp)];
                let percentNow = model["dayPeriod"][rank][getHalfTime(it.timestamp)];

                let scorePerDay = (it.score - pre.score) / (percentNow + 1 - percentPre);
                let averageScore = scorePerDay * (1 - percentPre);

                dayPT[day].score = averageScore + pre.score;
                dayPT[day].timestamp = lastDayEndTime.getTime();
            }
        }
    });

    // Fallback: If dayPT score is 0 but we have lastPoints, use lastPoints
    for (let i = 0; i < dayPT.length; i++) {
        // day index in lastPoints is SAME as i (0-based now)
        let d = i;
        if (dayPT[i].score === 0 && d < lastPoints.length && lastPoints[d]) {
            dayPT[i].score = lastPoints[d].score;
            dayPT[i].timestamp = lastPoints[d].timestamp.getTime();
        }
    }

    return dayPT;
}

function processToday(obj: EventRanking[]): number[] {
    let start = 0;
    //console.log(new Date(eventStartTime));
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
            return []; //Illeaga data(cross day data)
        if (halfTime < lastTime) return []; //Illeaga data(cross day data)
        today[halfTime] = it.score - obj[start].score;
        //console.log(`today ${getHalfTime(it.timestamp)} ${it.score}`)
        lastTime = halfTime;
    }
    return today;
}

function processLast(today: number[], last: number): number[] {
    let count = 0;
    let lastToday = today.slice();
    for (let i = 47; i >= 0; --i) {
        if (count >= last) lastToday[i] = 0;
        if (lastToday[i] !== 0) count++;
    }
    return lastToday;
}

function getLSE(today: number[], target: number[], predict: number) {
    let sum = 0;

    today.forEach((it, i) => {
        if (it === 0 || it === undefined || target.length <= i) return;
        let precent = it / predict - target[i];
        sum += precent * precent;
    });

    return sum;
}

function processLSE(today: number[], target: number[]) {
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
        //console.log(`${l} ${mid} ${r}`);
    }
    return mid;
}

function calculateConfidenceInterval(
    prediction: number,
    modelStdDev: number,
    confidenceLevel: number
): ConfidenceInterval {
    // Z-scores for common confidence levels
    // 95% -> 1.96, 90% -> 1.645, 80% -> 1.28, 70% -> 1.04
    const zScore = confidenceLevel === 95 ? 1.96 : (confidenceLevel === 80 ? 1.28 : 1.04);

    // The prediction uncertainty is proportional to model standard deviation
    const predictionStdDev = prediction * modelStdDev;
    const margin = zScore * predictionStdDev;

    // Calculate raw bounds
    const rawLower = prediction - margin;
    const rawUpper = prediction + margin;

    // If lower bound would be negative, clamp to 0 but keep the margin
    // This maintains the property that 95% CI always contains 80% CI
    if (rawLower < 0) {
        return {
            lower: 0,
            upper: Math.round(rawUpper + Math.abs(rawLower)) // Add the clamped amount to upper
        };
    }

    return {
        lower: Math.round(rawLower),
        upper: Math.round(rawUpper)
    };
}

function getModelStdDev(model: PredictionModel, rank: number, halfTime: number, isLastDay: boolean): number {
    // Get standard deviation from the model at the current time point
    if (isLastDay && model.lastDayPeriodStdDev && model.lastDayPeriodStdDev[rank]) {
        return model.lastDayPeriodStdDev[rank][halfTime] || 0;
    } else if (!isLastDay && model.dayPeriodStdDev && model.dayPeriodStdDev[rank]) {
        return model.dayPeriodStdDev[rank][halfTime] || 0;
    }
    return 0;
}

function calculateDailyProjection(
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

    // Day 0 (Start Time)
    projection.push({
        timestamp: eventStartTime,
        endScore: dayScores[0]?.score || 0,
        isActual: true
    });

    // Days 1 to lastDayEnd (actual data)
    for (let d = 1; d < lastDayEnd; d++) {
        // Use actual timestamp if available (fallback logic handled in processDayScores)
        let ts = dayScores[d]?.timestamp || (eventStartTime - 15 * 3600 * 1000 + d * 24 * 3600 * 1000);

        if (dayScores[d]?.score > 0) {
            projection.push({
                timestamp: ts,
                endScore: Math.round(dayScores[d].score),
                isActual: true
            });
        }
    }

    // Current/future days (predicted)
    for (let d = lastDayEnd; d <= totalDays; d++) {
        let predictedScore: number;
        let ts: number;

        if (d < totalDays) {
            // Normal days: use average score per day
            predictedScore = dayScores[0].score + scorePerNormalDay * d;
            // Standard End
            ts = eventStartTime - 15 * 3600 * 1000 + d * 24 * 3600 * 1000;
        } else {
            // Last day: use final prediction
            predictedScore = finalPrediction;
            // Use eventEndTime if provided, otherwise standard
            if (eventEndTime) {
                ts = eventEndTime;
            } else {
                ts = eventStartTime - 15 * 3600 * 1000 + d * 24 * 3600 * 1000;
            }
        }

        // Calculate confidence intervals for predicted days
        // Use a simple scaling based on days ahead
        let daysAhead = d - lastDayEnd + 1;
        let baseStdDev = model.dayPeriodStdDev?.[rank]?.[24] || 0.05; // Mid-day std dev
        let scaledStdDev = baseStdDev * Math.sqrt(daysAhead); // Uncertainty grows with time

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



function calculateHourlyProjectionToday(
    todayScores: number[],
    todayBeginScore: number,
    predictedTodayEndScore: number,
    currentHalfTime: number,
    model: PredictionModel,
    rank: number,
    isLastDay: boolean,
    eventStartTime: number,
    dayIndex: number, // 1-based day index
    currentTime?: number,
    eventEndTime?: number
): TimePoint[] {
    let projection: TimePoint[] = [];
    let now = currentTime ? new Date(currentTime) : new Date();

    // Get the day period model to use
    let periodModel = isLastDay ? model.lastDayPeriod[rank] : model.dayPeriod[rank];
    let periodStdDev = isLastDay ? model.lastDayPeriodStdDev?.[rank] : model.dayPeriodStdDev?.[rank];

    // Calculate today's predicted increment
    let todayIncrement = predictedTodayEndScore - todayBeginScore;

    // Generate time points from current to end of day (48 half-hours)
    for (let h = 0; h <= 47; h++) {
        // Calculate timestamp (15:00 UTC previous day + h * 30 minutes)
        // Adjust for current day: (dayIndex - 1) * 24 hours
        let dayOffset = (dayIndex - 1) * 24 * 3600 * 1000;
        let timestampValue = eventStartTime - 15 * 3600 * 1000 + dayOffset + h * 30 * 60 * 1000;

        // Check eventEndTime overflow
        if (eventEndTime && timestampValue > eventEndTime) {
            continue;
        }

        let timestamp = new Date(timestampValue);

        // Check if this is actual or predicted
        let isActual = h <= currentHalfTime && todayScores[h] > 0;
        let score: number;

        if (isActual) {
            // Use actual data
            score = todayBeginScore + todayScores[h];
        } else {
            // Predict based on model
            if (!periodModel || !periodModel[h]) continue;

            let relativeProgress = periodModel[h];
            score = todayBeginScore + todayIncrement * relativeProgress;

            // Calculate confidence intervals
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

export async function predict(rank: number, requestInput?: PredictionRequestInput): Promise<PredictionResult | null> {

    // Determine context (Global vs Input)
    let currentEventType = eventType;
    let currentEventStartTime = eventStartTime;
    // Extract eventEndTime if available
    let currentEventEndTime = requestInput?.eventEndTime;
    let currentDays = days;
    let currentEventId = event;

    if (requestInput) {
        currentEventType = requestInput.eventType;
        currentEventStartTime = requestInput.eventStartTime;
        currentDays = requestInput.totalDays;
        currentEventId = 0; // Not needed for input
    }

    console.log()
    //Debug Info
    let debugInfo = {
        scores: [],
        firstUsefulDay: 0,
        lastDayEnd: 0,
        dayScores: [],
        scorePerNormalDay: 0,
        todayScore: 0,
        lastDayScore: 0,
        result: 0,
    };
    for (let i = 0; i < currentDays * 48 + 12; ++i) {
        debugInfo.scores.push(0);
    }

    //Model
    const model = JSON.parse(
        readFileSync(
            process.env.IS_SERVERLESS
                ? `/tmp/predict_models_${currentEventType}.json`
                : `predict_models_${currentEventType}.json`,
            "utf-8"
        )
    ) as PredictionModel;
    //Get scores
    let scores = await getScores(rank, requestInput, currentEventId, currentEventStartTime, currentDays);
    if (scores.length === 0) {
        console.log(`T${rank} Cannot predict: No data`);
        return null;
    }
    scores.forEach(it => {
        debugInfo.scores[getHalfTimeFromBegin(it.timestamp, currentEventStartTime)] = it.score;
    })

    //Get day score
    let day = processDayScores(scores, model, rank, currentEventStartTime);
    let firstUsefulDay = 0;
    let lastDayEnd = 0;
    day.forEach((it, i) => {
        if (firstUsefulDay === 0 && it.score > 0) {
            firstUsefulDay = i + 1;
        }
        if (it.score > 0) {
            lastDayEnd = i + 1;
        }
    })
    if (firstUsefulDay <= 0) {
        console.log(`T${rank} Cannot predict: Event just started in a day`);
        return null;
    }
    debugInfo.firstUsefulDay = firstUsefulDay;
    //if (debug) console.log(`firstUsefulDay:${firstUsefulDay}`);
    debugInfo.dayScores = day;
    //if (debug) console.log(`day:${day}`);

    //Get today score
    //if (debug) console.log(`lastDayEnd:${lastDayEnd}`);
    let todayBeginScore = day[lastDayEnd - 1].score;
    //if (debug) console.log(`todayBeginScore:${todayBeginScore}`);
    let todayScores = processToday(scores);
    //if (debug) console.log(`todayScores:${todayScores}`);
    let halfTime =
        todayScores.length === 0
            ? 0
            : getHalfTime(scores[scores.length - 1].timestamp);

    /*if(rank===50000) {
          model["lastDayPeriod"][rank].forEach(it=>console.log(it))
      }*/

    //Get predict
    let isLastDay = lastDayEnd === currentDays;
    //if (debug) console.log(`lastEndDay:${lastDayEnd}`);
    debugInfo.lastDayEnd = lastDayEnd;
    if (!isLastDay) {
        //Not last day
        let day0 = day[firstUsefulDay - 1].score;
        //if (debug) console.log(`day0:${day0}`);
        let todayProcess = model["dayPeriod"][rank][halfTime];
        //if (debug) console.log(`todayProcess:${todayProcess}`);

        //Predict by today data
        let todayScore =
            halfTime === 0 ? 0 : processLSE(todayScores, model["dayPeriod"][rank]);
        //if (debug) console.log(`todayScore:${todayScore}`);
        debugInfo.todayScore = todayScore;

        //Weighted mean
        let scorePerNormalDay =
            (todayBeginScore - day0 + todayScore * todayProcess) /
            (lastDayEnd - firstUsefulDay + todayProcess);
        //if (debug) console.log(`scorePerNormalDay:${scorePerNormalDay}`);
        debugInfo.scorePerNormalDay = scorePerNormalDay;
        let scoreNormalDays = scorePerNormalDay * (currentDays - 1);
        //if (debug) console.log(`scoreNormalDays:${scoreNormalDays}`);

        //Calculate last day
        //if (debug) console.log(`lastDayRate:${model["lastDay"][rank][currentDays]}`);
        let lastDayScore =
            (scoreNormalDays / (1 - model["lastDay"][rank][currentDays])) *
            model["lastDay"][rank][currentDays];
        //if (debug) console.log(`lastDayScore:${lastDayScore}`);
        debugInfo.lastDayScore = lastDayScore;



        //Calculate predict result
        let result = Math.round(
            day[0].score + scoreNormalDays / (1 - model["lastDay"][rank][currentDays])
        );

        // Adjust result if eventEndTime is provided (Exact End Time Prediction)
        if (currentEventEndTime) {
            let lastDayStartIdx = (currentDays - 1);
            let lastDayStartTimestamp = currentEventStartTime - 15 * 3600 * 1000 + lastDayStartIdx * 24 * 3600 * 1000;
            let msDiff = currentEventEndTime - lastDayStartTimestamp;
            let index = Math.floor(msDiff / (30 * 60 * 1000));
            // if (debug) console.log(`[Interpolation] Diff: ${msDiff}, Index: ${index}`);

            if (index < 0) index = 0;
            if (index > 47) index = 47;

            let progress = model.lastDayPeriod[rank][index];
            if (progress === undefined) progress = 1.0;
            // if (debug) console.log(`[Interpolation] Progress at index ${index}: ${progress}`);

            // result is EndScore. LastDayStart = result - lastDayScore.
            // exact = Start + increment * progress
            // let oldResult = result;
            result = Math.round((result - lastDayScore) + lastDayScore * progress);
            // if (debug) console.log(`[Interpolation] Result adjusted: ${oldResult} -> ${result}`);
        }
        debugInfo.result = result;
        debugJson.ranks[rank] = debugInfo;

        // Calculate confidence intervals
        let modelStdDev = getModelStdDev(model, rank, halfTime, false);
        let stdDev = result * modelStdDev;

        // Calculate daily projection
        let dailyProjection = calculateDailyProjection(
            day,
            lastDayEnd,
            currentDays,
            result,
            scorePerNormalDay,
            model,
            rank,
            currentEventStartTime,
            currentEventEndTime
        );

        // Calculate predicted today end score
        let predictedTodayEndScore = lastDayEnd < currentDays
            ? (day[0].score + scorePerNormalDay * lastDayEnd)
            : result;

        // Calculate hourly projection for today
        let hourlyProjectionToday = calculateHourlyProjectionToday(
            todayScores,
            todayBeginScore,
            predictedTodayEndScore,
            halfTime,
            model,
            rank,
            false,
            currentEventStartTime,
            lastDayEnd, // Current Day Index
            requestInput?.currentTime,
            currentEventEndTime
        );

        // Get current score (last actual score)
        let currentScore = scores.length > 0 ? scores[scores.length - 1].score : 0;

        return {
            rank: rank,
            prediction: result,
            currentScore: currentScore,
            currentDay: lastDayEnd,
            currentTime: requestInput?.currentTime ? new Date(requestInput.currentTime) : new Date(),
            confidence70: calculateConfidenceInterval(result, modelStdDev, 70),
            confidence80: calculateConfidenceInterval(result, modelStdDev, 80),
            stdDev: stdDev,
            dailyProjection: dailyProjection,
            hourlyProjectionToday: hourlyProjectionToday
        };
    } else {
        if (debug) console.log(todayBeginScore);
        //Last day
        let todayProcess = model["lastDayPeriod"][rank][halfTime];

        //Predict by today data
        let todayScoreNowPredict =
            halfTime === 0
                ? 0
                : processLSE(todayScores, model["lastDayPeriod"][rank]);
        if (debug) console.log("Now Predict:" + todayScoreNowPredict);

        //Predict by last hours data
        let todayScoreLastPredict =
            halfTime <= 2
                ? todayScoreNowPredict
                : processLSE(processLast(todayScores, 2), model["lastDayPeriod"][rank]);
        if (debug) console.log("Last Predict:" + todayScoreLastPredict);

        //Weighted mean for today's predict
        let todayScoreTodayPredict =
            todayScoreLastPredict * todayProcess +
            todayScoreNowPredict * (1 - todayProcess);

        //Predict by past days
        // Need to use day[0].score
        let todayScorePastPredict =
            ((todayBeginScore - day[0].score) / (1 - model["lastDay"][rank][currentDays])) *
            model["lastDay"][rank][currentDays];
        if (debug) console.log("Past Predict:" + todayScorePastPredict);

        //Weighted mean for last day predict
        let todayScore =
            todayScoreTodayPredict * Math.min(1, todayProcess * 2) +
            todayScorePastPredict * Math.max(0, 1 - todayProcess * 2);

        let result = Math.round(todayBeginScore + todayScore);

        // Adjust result if eventEndTime is provided (Exact End Time Prediction)
        if (currentEventEndTime) {
            let lastDayStartIdx = (currentDays - 1);
            let lastDayStartTimestamp = currentEventStartTime - 15 * 3600 * 1000 + lastDayStartIdx * 24 * 3600 * 1000;
            let msDiff = currentEventEndTime - lastDayStartTimestamp;
            let index = Math.floor(msDiff / (30 * 60 * 1000));
            if (index < 0) index = 0;
            if (index > 47) index = 47;

            let progress = model.lastDayPeriod[rank][index];
            if (progress === undefined) progress = 1.0;
            // todayBeginScore IS LastDayStartScore in this branch
            // todayScore IS the full day increment
            result = Math.round(todayBeginScore + todayScore * progress);
        }

        debugInfo.result = result;
        debugJson.ranks[rank] = debugInfo;

        // Calculate confidence intervals
        let modelStdDev = getModelStdDev(model, rank, halfTime, true);
        let stdDev = result * modelStdDev;

        // Calculate scorePerNormalDay for daily projection
        let scorePerNormalDay = (todayBeginScore - day[0].score) / (currentDays - 1);

        // Calculate daily projection
        let dailyProjection = calculateDailyProjection(
            day,
            lastDayEnd,
            currentDays,
            result,
            scorePerNormalDay,
            model,
            rank,
            currentEventStartTime,
            currentEventEndTime
        );

        // Calculate predicted today end score (which is the final result on last day)
        let predictedTodayEndScore = result;

        // Calculate hourly projection for today
        let hourlyProjectionToday = calculateHourlyProjectionToday(
            todayScores,
            todayBeginScore,
            predictedTodayEndScore,
            halfTime,
            model,
            rank,
            true,
            currentEventStartTime,
            lastDayEnd, // Current Day Index
            requestInput?.currentTime,
            currentEventEndTime
        );

        // Get current score (last actual score)
        let currentScore = scores.length > 0 ? scores[scores.length - 1].score : 0;

        return {
            rank: rank,
            prediction: result,
            currentScore: currentScore,
            currentDay: lastDayEnd,
            currentTime: requestInput?.currentTime ? new Date(requestInput.currentTime) : new Date(),
            confidence70: calculateConfidenceInterval(result, modelStdDev, 70),
            confidence80: calculateConfidenceInterval(result, modelStdDev, 80),
            stdDev: stdDev,
            dailyProjection: dailyProjection,
            hourlyProjectionToday: hourlyProjectionToday
        };
    }
}

export async function predictAll(begin: number = 0) {
    await updateEvent();
    let outJson = {};
    let outJsonDetailed = {};
    let testResults = {};
    let count = 0;

    // Load actual final scores if in test mode
    let actualScores: { [rank: number]: number } = {};
    if (debugTestMode) {
        console.log('\n=== Loading Actual Final Scores from API ===');
        for (const r of ranks) {
            try {
                // Get full event data from API (without cutoff)
                let response = await axios.get(
                    `https://api.sekai.best/event/${event}/rankings/graph?region=kr&rank=${r}`, {
                    httpsAgent: proxy ? agent : null,
                }
                );
                let data = response.data as EventData;
                let scores = data.data.eventRankings;

                // Validate data
                if (!scores || scores.length === 0) {
                    console.log(`No data for rank ${r}`);
                    continue;
                }

                if (Array.isArray(scores[0])) {
                    console.log(`Invalid data format for rank ${r}`);
                    continue;
                }

                // Get the last score as actual final score
                scores.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                const lastScore = scores[scores.length - 1].score;
                actualScores[r] = lastScore;

                console.log(`Rank ${r}: Actual final score = ${lastScore}`);
            } catch (error) {
                console.log(`Could not load actual score for rank ${r}: ${error.message}`);
            }
        }
        console.log('===================================\n');
    }

    for (const r of ranks) {
        if (r < begin) continue;
        let predictionResult = await predict(r);
        if (predictionResult !== null) {
            const predicted = predictionResult.prediction;
            const ci70Lower = predictionResult.confidence70?.lower || 0;
            const ci70Upper = predictionResult.confidence70?.upper || 0;

            console.log(`T${r} ${predicted} (70% CI: ${ci70Lower}-${ci70Upper})`);

            // Test mode: Compare with actual
            if (debugTestMode && actualScores[r]) {
                const actual = actualScores[r];
                const error = predicted - actual;
                const errorPercent = (error / actual * 100).toFixed(2);
                const isWithinCI = actual >= ci70Lower && actual <= ci70Upper;

                console.log(`     Actual: ${actual}`);
                console.log(`     Error: ${error} (${errorPercent}%)`);
                console.log(`     Within 70% CI: ${isWithinCI ? '✓ YES' : '✗ NO'}`);

                testResults[r] = {
                    predicted: predicted,
                    actual: actual,
                    error: error,
                    errorPercent: parseFloat(errorPercent),
                    confidence70: predictionResult.confidence70,
                    confidence80: predictionResult.confidence80,
                    withinCI70: isWithinCI,
                    withinCI80: actual >= (predictionResult.confidence80?.lower || 0) &&
                        actual <= (predictionResult.confidence80?.upper || 0)
                };
            }

            if (debug) console.log("");

            // Keep backward compatibility: simple output for existing consumers
            outJson[r] = predictionResult.prediction;
            // Detailed output with confidence intervals
            outJsonDetailed[r] = predictionResult;
            count++;
        }
    }

    if (count > 0) {
        // Write simple format for backward compatibility
        writeFileSync(
            process.env.IS_SERVERLESS ? "/tmp/out-predict.json" : "out-predict.json",
            JSON.stringify(outJson)
        );
        // Write detailed format with confidence intervals
        writeFileSync(
            process.env.IS_SERVERLESS ? "/tmp/out-predict-detailed.json" : "out-predict-detailed.json",
            JSON.stringify(outJsonDetailed, null, 2)
        );
    }

    if (debug) {
        debugJson["testResults"] = testResults;
        writeFileSync("predict-debug.json", JSON.stringify(debugJson, null, 2));

        const { existsSync } = require('fs');
        if (existsSync("../data-card-view/data")) {
            writeFileSync("../data-card-view/data/predict-debug.json", JSON.stringify(debugJson, null, 2));
        }
    }

    // Test mode summary
    if (debugTestMode && Object.keys(testResults).length > 0) {
        console.log('\n=== TEST RESULTS SUMMARY ===');

        let totalError = 0;
        let totalErrorPercent = 0;
        let withinCI95Count = 0;
        let withinCI80Count = 0;
        const resultCount = Object.keys(testResults).length;

        for (const r in testResults) {
            const result = testResults[r];
            totalError += Math.abs(result.error);
            totalErrorPercent += Math.abs(result.errorPercent);
            if (result.withinCI95) withinCI95Count++;
            if (result.withinCI80) withinCI80Count++;
        }

        console.log(`Total ranks tested: ${resultCount}`);
        console.log(`Average absolute error: ${(totalError / resultCount).toFixed(0)}`);
        console.log(`Average absolute error %: ${(totalErrorPercent / resultCount).toFixed(2)}%`);
        console.log(`Within 95% CI: ${withinCI95Count}/${resultCount} (${(withinCI95Count / resultCount * 100).toFixed(1)}%)`);
        console.log(`Within 80% CI: ${withinCI80Count}/${resultCount} (${(withinCI80Count / resultCount * 100).toFixed(1)}%)`);
        console.log('============================\n');
    }
}

// Entry point: Run predictAll when script is executed directly
if (require.main === module) {
    predictAll().catch(error => {
        console.error('Error during prediction:', error);
        process.exit(1);
    });
}
