import {readFileSync, writeFileSync, existsSync, readdirSync} from 'fs';
import {OutRanking} from "./Struct";

const TARGET_EVENT_TYPE = process.argv.length > 2 ? process.argv[2] : "marathon";
const ranks = [1, 2, 3, 4, 5, 10, 50, 100, 200, 300, 400, 500, 1000, 5000];

// Load events.json if exists for event type information
let eventData: Array<any> = [];
if (existsSync(`events.json`)) {
    eventData = JSON.parse(readFileSync(`events.json`, 'utf-8')) as Array<any>;
    console.log(`Loaded ${eventData.length} events from events.json`);
}

// Scan out folder to find available data files
function getAvailableEvents(): Map<number, Set<number>> {
    const availableEvents = new Map<number, Set<number>>(); // eventId -> Set of rankIds

    if (!existsSync('out')) {
        console.log('ERROR: out folder does not exist. Run convert2csv.ts first.');
        return availableEvents;
    }

    const files = readdirSync('out');
    files.forEach(file => {
        const match = file.match(/out_(\d+)_(\d+)\.json/);
        if (match) {
            const eventId = parseInt(match[1]);
            const rankId = parseInt(match[2]);

            if (!availableEvents.has(eventId)) {
                availableEvents.set(eventId, new Set());
            }
            availableEvents.get(eventId)!.add(rankId);
        }
    });

    return availableEvents;
}

// Get event type from events.json or default to marathon
function getEventType(eventId: number): string {
    if (eventData.length > 0) {
        const event = eventData.find(it => it.id === eventId);
        if (event && event.eventType) {
            return event.eventType;
        }
    }
    // Default: event 18 is first cheerful_carnival, others are marathon
    return eventId === 18 ? 'cheerful_carnival' : 'marathon';
}

const availableEvents = getAvailableEvents();
if (availableEvents.size === 0) {
    console.log('No converted data files found in out folder.');
    process.exit(1);
}

console.log(`Found data for ${availableEvents.size} events`);
console.log(`Generating model for event type: ${TARGET_EVENT_TYPE}`)

let dayModel = {};
let lastModel = {};
let lastDayModel = {};
let dayStdDevModel = {};
let lastStdDevModel = {};
let lastDayStdDevModel = {};

ranks.forEach(it => {
    console.log(`T${it}`);
    let daySum = [];
    let daySumSq = [];
    let dayCount = [];
    for (let t = 0; t <= 48; ++t) {
        daySum.push(0);
        daySumSq.push(0);
        dayCount.push(0);
    }

    let lastDaySum = [];
    let lastDaySumSq = [];
    let lastDayCount = [];
    for (let t = 0; t <= 42; ++t) {
        lastDaySum.push(0);
        lastDaySumSq.push(0);
        lastDayCount.push(0);
    }

    let lastSum = [];
    let lastSumSq = [];
    let lastCount = [];
    for (let t = 0; t <= 10; ++t) {
        lastSum.push(0);
        lastSumSq.push(0);
        lastCount.push(0);
    }

    //Process all event data, skip first event
    let processedCount = 0;
    availableEvents.forEach((rankSet, eventId) => {
        // Skip event 1 (first event is usually incomplete)
        if (eventId === 1) return;

        // Skip first cheerful carnival if needed
        if (eventId === 18 && TARGET_EVENT_TYPE !== 'cheerful_carnival') return;

        // Check if this rank exists for this event
        if (!rankSet.has(it)) return;

        // Get event type
        let eventType = getEventType(eventId);
        if (eventType !== TARGET_EVENT_TYPE) {
            return;
        }

        // Try to load data file
        const filePath = `out/out_${eventId}_${it}.json`;
        if (!existsSync(filePath)) return;

        let data: OutRanking;
        try {
            data = JSON.parse(readFileSync(filePath, 'utf-8')) as OutRanking;
        } catch (error) {
            console.log(`ERROR reading ${filePath}: ${error.message}`);
            return;
        }

        processedCount++;
        let percents = [0];
        let days = data.dayScores.length;
        for (let j = 1; j < days; ++j) {
            percents.push((data.dayScores[j] - data.dayScores[0]) / (data.lastScore - data.dayScores[0]))
            //percents.push(data.dayScores[j] / data.lastScore * 100)
        }
        percents.push(1);

        let delta = [];
        for (let j = 1; j < percents.length; ++j) {
            delta.push(percents[j] - percents[j - 1])
        }
        //if (days === 8) {
        console.log(eventId + " " + days + " " + JSON.stringify(delta));
        //}
        let lastDay = delta[delta.length - 1];
        if (lastDay > 0 && lastDay < 1) {
            lastSum[days] += lastDay;
            lastSumSq[days] += lastDay * lastDay;
            lastCount[days]++;
            //console.log(lastCount[days])
        }

        for (let d = 1; d <= days; ++d) {
            let halfHours = d === days ? 42 : 48;
            let t0 = d * 48 - 30;

            let dayStart = data.halfHourScores[t0];
            let dayEnd = data.halfHourScores[t0 + halfHours] - dayStart;
            if (dayStart === 0 || dayEnd === 0 ||
                dayStart === undefined || dayEnd === undefined ||
                isNaN(dayStart) || isNaN(dayEnd)) {
                console.log(`ERROR while processing DAY${d}`)
                continue
            }
            for (let t = 0; t <= halfHours; ++t) {
                let score = data.halfHourScores[t0 + t];
                if (score === 0) continue

                if (d === days) {
                    let normalizedScore = (score - dayStart) / dayEnd;
                    lastDaySum[t] += normalizedScore;
                    lastDaySumSq[t] += normalizedScore * normalizedScore;
                    if (isNaN(lastDaySum[t])) {
                        console.log(`${score} ${dayStart} ${dayEnd}`)
                    }
                    lastDayCount[t]++;
                } else {
                    let normalizedScore = (score - dayStart) / dayEnd;
                    daySum[t] += normalizedScore;
                    daySumSq[t] += normalizedScore * normalizedScore;
                    dayCount[t]++;
                }
            }
        }
    });

    console.log(`Processed ${processedCount} events for rank ${it}`);

    let dayPercents = []
    let dayStdDevs = []
    for (let t = 0; t <= 48; ++t) {
        let mean = daySum[t] / dayCount[t];
        let variance = (daySumSq[t] / dayCount[t]) - (mean * mean);
        let stdDev = variance > 0 ? Math.sqrt(variance) : 0;
        dayPercents.push(mean);
        dayStdDevs.push(stdDev);
        //console.log(daySum[t] / dayCount[t] * 100)
    }
    dayModel[it] = dayPercents;
    dayStdDevModel[it] = dayStdDevs;


    let lastDayPercents = []
    let lastDayStdDevs = []
    for (let t = 0; t <= 42; ++t) {
        let mean = lastDaySum[t] / lastDayCount[t];
        let variance = (lastDaySumSq[t] / lastDayCount[t]) - (mean * mean);
        let stdDev = variance > 0 ? Math.sqrt(variance) : 0;
        lastDayPercents.push(mean);
        lastDayStdDevs.push(stdDev);
        //console.log(lastDaySum[t] / lastDayCount[t] * 100)
    }
    lastDayModel[it] = lastDayPercents;
    lastDayStdDevModel[it] = lastDayStdDevs;

    let lastPercents = []
    let lastStdDevs = []
    for (let t = 0; t <= 10; ++t) {
        if (lastCount[t] === 0) {
            lastPercents.push(0);
            lastStdDevs.push(0);
            continue;
        }
        let mean = lastSum[t] / lastCount[t];
        let variance = (lastSumSq[t] / lastCount[t]) - (mean * mean);
        let stdDev = variance > 0 ? Math.sqrt(variance) : 0;
        lastPercents.push(mean);
        lastStdDevs.push(stdDev);
        //console.log(t+" "+lastCount[t])
    }
    lastModel[it] = lastPercents;
    lastStdDevModel[it] = lastStdDevs;
})

let outModel = {
    dayPeriod: dayModel,
    dayPeriodStdDev: dayStdDevModel,
    lastDay: lastModel,
    lastDayStdDev: lastStdDevModel,
    lastDayPeriod: lastDayModel,
    lastDayPeriodStdDev: lastDayStdDevModel,
}

writeFileSync(`predict_models_${TARGET_EVENT_TYPE}.json`, JSON.stringify(outModel, null, 2))