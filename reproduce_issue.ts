
import axios from 'axios';

async function testReproduction() {
    console.log('Testing Reproduction of Day Calculation Issue...');

    // JST Offset = +9 hours
    // Base Start: 2025-03-16 00:00:00 JST
    // UTC: 2025-03-15 15:00:00 UTC
    // Timestamp: 1742050800000
    const startJST = new Date('2025-03-15T15:00:00Z').getTime();

    // Total days: 8
    const totalDays = 8;

    // End time: Start + 8 days
    const endJST = startJST + 8 * 24 * 3600 * 1000;

    // Current time: 12 hours before end
    const currentJST = endJST - 12 * 3600 * 1000;

    // Generate data points every 30 mins from start up to current
    const data = [];
    let t = startJST;
    let score = 10000;

    while (t <= currentJST) {
        // Skip midnight points (15:00 UTC) to simulate missing data
        const date = new Date(t);
        if (date.getUTCHours() === 15 && date.getUTCMinutes() === 0) {
            console.log(`Skipping midnight point: ${date.toISOString()}`);
        } else {
            data.push({
                timestamp: t,
                score: score
            });
        }

        // Increase score
        score += 1000 + Math.floor(Math.random() * 500);
        t += 30 * 60 * 1000; // +30 mins
    }

    const payload = {
        eventType: "marathon",
        eventStartTime: startJST,
        totalDays: totalDays,
        rank: 100,
        currentTime: currentJST,
        data: data
    };

    try {
        const response = await axios.post('http://localhost:4000/v1', payload);
        console.log('Result Current Day:', response.data.currentDay);
        console.log('Result Prediction:', response.data.prediction);
        console.log('Daily Projection:', JSON.stringify(response.data.dailyProjection, null, 2));
    } catch (error) {
        if (error.response) {
            console.log('Error Status:', error.response.status);
            console.log('Error Data:', error.response.data);
        } else {
            console.log('Error:', error);
            if (error.code) console.log('Error Code:', error.code);
            if (error.address) console.log('Error Address:', error.address);
        }
    }
}

testReproduction();
