import axios from "axios";
import { EventData, EventRanking, PredictionResult, ConfidenceInterval, PredictionModel, DailyProjection, TimePoint, PredictionRequestInput } from "./Struct";
import { readFileSync, writeFileSync } from "fs";
import HttpsProxyAgent from 'https-proxy-agent';
import * as dotenv from 'dotenv';
import {
    predict as predictCore,
    PredictConfig,
    prepareScores,
    getHalfTimeFromBegin,
    getHalfTime
} from "./predict-core";

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

let debugJson: any = {
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


async function getScores(rank: number, requestInput?: PredictionRequestInput, currentEventId?: number, currentEventStartTime?: number, currentDays?: number) {
    let scores: EventRanking[];

    if (requestInput) {
        // Use provided data
        scores = prepareScores(requestInput.data, rank);
    } else {
        // Get data from API (both normal and test mode)
        let response = await axios.get(
            `https://api.sekai.best/event/${currentEventId}/rankings/graph?region=kr&rank=${rank}`, {
            httpsAgent: proxy ? agent : null,
        }
        );
        let data = response.data as EventData;
        scores = data.data.eventRankings;
        // Also prepare/clean API scores
        scores = prepareScores(scores.map(it => ({ ...it, timestamp: it.timestamp })), rank);
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

    // Additional filtering for debug mode
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

    // The filtering for 30 min intervals and sorting is now done in prepareScores, 
    // but prepareScores was called at the start. 
    // If requestInput was used, it's clean.
    // If API was used, we called convert which cleaned it. 
    // However, prepareScores sorts by timestamp.

    return scores;
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

    //Debug Info (retained partial compatibility for debugJson)
    let debugInfo: any = {
        scores: [],
        result: 0,
    };
    for (let i = 0; i < currentDays * 48 + 12; ++i) {
        debugInfo.scores.push(0);
    }


    //Model Loading
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

    // Call Core Logic
    const config: PredictConfig = {
        eventType: currentEventType,
        eventStartTime: currentEventStartTime,
        eventEndTime: currentEventEndTime,
        totalDays: currentDays,
        currentTime: requestInput?.currentTime
    };

    const result = predictCore(rank, scores, model, config);

    // Update Debug Info if result exists
    if (result) {
        debugInfo.result = result.prediction;
        debugJson.ranks[rank] = debugInfo;
    }

    return result;
}

export async function predictAll(begin: number = 0) {
    await updateEvent();
    let outJson: any = {};
    let outJsonDetailed: any = {};
    let testResults: any = {};
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
