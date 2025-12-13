import axios from 'axios';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { EventData } from "./Struct";
import HttpsProxyAgent from "https-proxy-agent";

let agent = HttpsProxyAgent('http://localhost:1090');

let proxy = false;
// let event = [131, 132, 134, 135, 136, 138, 139, 141, 142, 148, 149, 150]
// let event = [121, 125, 127, 128, 129];
let event = [116, 117, 120]
let events = 8;
const ranks = [1, 2, 3, 4, 5, 10, 50, 100, 200, 300, 400, 500, 1000, 5000];

if (!existsSync("data")) mkdirSync("data");
if (!existsSync("out")) mkdirSync("out");

async function updateEventId() {
    const response = await axios.get(`https://strapi.sekai.best/sekai-current-event`, {
        httpsAgent: proxy ? agent : null,
    });
    let currentEvent = response.data.eventId;
    if (response.data.eventJson.rankingAnnounceAt > Date.now()) {
        console.log(`Event ${currentEvent} is running.`)
        currentEvent--;
    }

    console.log(`Last ended event: ${currentEvent}`);
    writeFileSync(`lastEndedEventId`, currentEvent.toString(), 'utf-8');
    events = currentEvent;
}

async function downloadData(eventId: number, rankId: number) {
    const response = await axios.get(`https://api.sekai.best/event/${eventId}/rankings/graph?region=kr&rank=${rankId}`, {
        httpsAgent: proxy ? agent : null,
    });
    let data = response.data as EventData;
    let scores = data.data.eventRankings;

    //Process illegal data (Multi array)
    if (scores.length > 0 && Array.isArray(scores[0])) {
        console.log(`ERROR while downloading ${eventId} ${rankId}`)
        return;
    }

    //Process illegal data (Incorrect event)
    if (scores.length > 0 && (scores[0].eventId !== eventId || scores[0].rank !== rankId)) {
        console.log(`ERROR while downloading ${eventId} ${rankId}`)
        return;
    }

    writeFileSync(`data/data_${eventId}_${rankId}.json`, JSON.stringify(response.data), 'utf-8');
    console.log(`Downloaded ${eventId} ${rankId}`)
}

async function downloadAllData() {
    // await updateEventId();
    for (const i of event) {
        for (const it of ranks) {
            if (!existsSync(`data/data_${i}_${it}.json`)) {
                await downloadData(i, it).catch(e => console.log(`Failed to download: ${i} ${it}`))
            }
        }
    }
    processAllData()
}

function processAllData() {
    console.log('Converting all data files...');
    execSync('ts-node convert2csv.ts --all', { stdio: 'inherit' });
}

if (process.argv.length > 3) {
    const event = parseInt(process.argv[2]);
    const rank = parseInt(process.argv[3]);
    downloadData(event, rank).then(it => execSync(`ts-node convert2csv.ts ${event} ${rank}`))
} else {
    downloadAllData()
}

// const event = [149];
// (async () => {
//     for (const i of event) {
//         for (const rank of ranks) {
//             await downloadData(i, rank);
//             execSync(`ts-node convert2csv.ts ${i} ${rank}`)
//         }
//     }
// })()