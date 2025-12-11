
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { predict } from './predict';
import { PredictionRequestInput } from './Struct';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/v1', async (req, res) => {
    try {
        const body = req.body;

        if (!body.rank || !body.eventType || !body.eventStartTime || !body.totalDays || !body.data) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['rank', 'eventType', 'eventStartTime', 'totalDays', 'data']
            });
        }

        const input: PredictionRequestInput = {
            rank: parseInt(body.rank),
            eventType: body.eventType,
            eventStartTime: parseInt(body.eventStartTime),
            totalDays: parseInt(body.totalDays),
            currentTime: body.currentTime ? parseInt(body.currentTime) : undefined,
            data: body.data
        };

        console.log(`Received prediction request for rank ${input.rank}, event ${input.eventType}`);

        const result = await predict(input.rank, input);

        if (!result) {
            return res.status(404).json({ error: 'Could not generate prediction' });
        }

        res.json(result);

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Use server variable to keep reference
const server = app.listen(port, () => {
    console.log(`Sekai Event Predictor API listening at http://localhost:${port}`);
});

// Handle termination signals
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});
