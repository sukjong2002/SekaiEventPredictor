import {readFileSync, writeFileSync, readdirSync, existsSync} from 'fs';
import {EventData, EventRanking, SimpleRanking} from "./Struct";
import dateFormat from "dateFormat";

let dataFile = "data.json";
let csvFile = "out.csv";
let jsonFile = "out.json";

// Single file mode or batch mode
let batchMode = process.argv.includes('--all');

//Choose event
if (process.argv.length > 3 && !batchMode) {
    const event = parseInt(process.argv[2]);
    const rank = parseInt(process.argv[3]);
    dataFile = `data/data_${event}_${rank}.json`;
    csvFile = `out/out_${event}_${rank}.csv`;
    jsonFile = `out/out_${event}_${rank}.json`;
}

//Time to string
let firstDay = 0;

function dateToString(date: Date): string {
    return "D" + (Math.floor((date.getTime() / 1000 / 3600 + 9) / 24) - firstDay) + dateFormat(date, " HH:MM");
}

// Convert single file function
function convertFile(inputFile: string, outputCsvFile: string, outputJsonFile: string) {
    try {
        //Get raw data
        let eventData = JSON.parse(readFileSync(inputFile, 'utf8')) as EventData;
        let scores = eventData.data.eventRankings;

        // Validate data
        if (!scores || scores.length === 0) {
            console.log(`SKIP ${inputFile}: No data`);
            return false;
        }

        //Process time and sort
        scores.forEach(it => it.timestamp = new Date(it.timestamp.valueOf()));
        scores = scores.sort((a, b) => a.timestamp.valueOf() - b.timestamp.valueOf());

        //Add begin data
        let begin = {} as EventRanking;
        begin.timestamp = new Date(scores[0].timestamp.valueOf());
        begin.timestamp.setHours(14, 0, 0, 0);
        begin.score = 0;
        scores.push(begin);
        firstDay = Math.floor(begin.timestamp.getTime() / 3600 / 1000 / 24);

        scores = scores.sort((a, b) => a.timestamp.valueOf() - b.timestamp.valueOf());

        //Correct end data time
        let dt = scores[scores.length - 1].timestamp.getTime() - scores[scores.length - 2].timestamp.getTime()
        if (dt > 32 * 60 * 1000) {
            scores[scores.length - 1].timestamp = new Date(scores[scores.length - 2].timestamp.getTime());
            scores[scores.length - 1].timestamp.setHours(20, 0, 0, 0);
        }

        //Remove illegal data
        scores = scores.filter(it => it.timestamp.getMinutes() == 0 || it.timestamp.getMinutes() == 30)

        //Fix miss data
        let retObj: SimpleRanking[] = [];
        scores.forEach((it, i) => {
            if (i > 0) {
                let pre = scores[i - 1];
                let delta = Math.round((it.timestamp.valueOf() - pre.timestamp.valueOf()) / 1000 / 1800);
                if (delta !== 1) {
                    // console.log("MISS " + (delta - 1) + " between " + dateToString(pre.timestamp) + " and " + dateToString(it.timestamp));

                    let deltaPT = Math.round((it.score - pre.score) / delta);
                    for (let d = 1; d < delta; ++d) {
                        let midTime = new Date(pre.timestamp.getTime() + d * 30 * 60 * 1000);
                        retObj.push({
                            time: midTime,
                            pt: delta > 3 ? 0 : pre.score + d * deltaPT
                        });
                    }
                }
            }

            retObj.push({
                time: it.timestamp,
                pt: it.score
            });
        });

        //Save CSV
        let outCSV = "T,PT\r\n";
        retObj.forEach(it => {
            outCSV += dateToString(it.time) + "," + it.pt + "\r\n"
        })
        //writeFileSync(outputCsvFile, outCSV);

        //Gen day PT
        let dayPT: number[] = [];
        let PT: number[] = [];
        retObj.forEach(it => {
            if (it.time.getHours() === 23 && it.time.getMinutes() === 0) dayPT.push(it.pt);
            PT.push(it.pt);
        })
        let outJson = {
            beginTime: retObj[0].time,
            lastTime: retObj[retObj.length - 1].time,
            lastScore: retObj[retObj.length - 1].pt,
            dayScores: dayPT,
            halfHourScores: PT
        }
        writeFileSync(outputJsonFile, JSON.stringify(outJson, null, 4));
        return true;
    } catch (error) {
        console.log(`ERROR processing ${inputFile}: ${error.message}`);
        return false;
    }
}

// Batch convert all files in data folder
function convertAllFiles() {
    if (!existsSync('data')) {
        console.log('ERROR: data folder does not exist');
        return;
    }

    if (!existsSync('out')) {
        console.log('Creating out folder...');
        const {mkdirSync} = require('fs');
        mkdirSync('out');
    }

    const files = readdirSync('data');
    const dataFiles = files.filter(f => f.startsWith('data_') && f.endsWith('.json'));

    if (dataFiles.length === 0) {
        console.log('No data files found in data folder');
        return;
    }

    console.log(`Found ${dataFiles.length} data files to convert`);
    let converted = 0;
    let skipped = 0;

    dataFiles.forEach(file => {
        const match = file.match(/data_(\d+)_(\d+)\.json/);
        if (match) {
            const eventId = match[1];
            const rankId = match[2];
            const inputFile = `data/${file}`;
            const outputCsvFile = `out/out_${eventId}_${rankId}.csv`;
            const outputJsonFile = `out/out_${eventId}_${rankId}.json`;

            // Skip if output already exists
            if (existsSync(outputJsonFile)) {
                skipped++;
                return;
            }

            console.log(`Converting ${file}...`);
            if (convertFile(inputFile, outputCsvFile, outputJsonFile)) {
                converted++;
                console.log(`✓ Converted ${eventId}_${rankId}`);
            }
        }
    });

    console.log(`\nConversion complete: ${converted} converted, ${skipped} skipped`);
}

// Main execution
if (batchMode) {
    convertAllFiles();
} else if (dataFile !== "data.json") {
    // Single file mode
    console.log(`Converting ${dataFile}...`);
    if (convertFile(dataFile, csvFile, jsonFile)) {
        console.log(`✓ Conversion successful`);
    }
} else {
    console.log('Usage:');
    console.log('  ts-node convert2csv.ts --all              # Convert all files in data folder');
    console.log('  ts-node convert2csv.ts <eventId> <rankId> # Convert single file');
}
