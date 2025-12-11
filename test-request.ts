
import axios from 'axios';

async function testPredict() {
    console.log('Testing Prediction API...');

    // Test data based on user request but with more points to ensure it works
    const startTime = 1742198400000;
    const data = [];

    for (let i = 0; i < 20; i++) {
        data.push({
            timestamp: startTime + (i * 30 * 60 * 1000),
            score: 1000 + i * 5000
        });
    }

    const payload = {
        eventType: "marathon",
        eventStartTime: startTime,
        totalDays: 8,
        rank: 100,
        currentTime: startTime + (20 * 30 * 60 * 1000), // Simulate that "now" is right after the last data point
        data: data
    };

    try {
        const response = await axios.post('http://localhost:4005/predict/v1', payload);
        console.log('Status:', response.status);
        console.log('Result:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        if (error.response) {
            console.log('Error Status:', error.response.status);
            console.log('Error Data:', error.response.data);
        } else {
            console.log('Error:', error.message);
        }
    }
}

testPredict();
