
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { predict, prepareScores, PredictConfig } from './predict-core';
import { PredictionRequestInput, Data } from './Struct';
import marathonModel from './predict_models_marathon.json';

// Define Bindings for Rate Limiting API
type Bindings = {
    RATE_LIMITER: {
        limit: (options: { key: string }) => Promise<{ success: boolean }>
    }
}

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// Rate Limiting Middleware
app.use('/predict/v1', async (c, next) => {
    try {
        const limiter = c.env.RATE_LIMITER;
        if (!limiter) {
            // Limiter not configured in environment (e.g. local dev without bindings)
            // Proceed without limit or log warning
            return await next();
        }

        const ip = c.req.header('CF-Connecting-IP') || 'unknown';

        // Native Rate Limiting API call
        const { success } = await limiter.limit({ key: ip });

        if (!success) {
            return c.json({ error: 'Too Many Requests' }, 429);
        }

    } catch (e) {
        console.error("Rate limit error", e);
        // Fail open
    }

    await next();
});

app.get('/health', (c) => c.json({ status: 'ok', platform: 'Cloudflare Workers' }));

app.post('/predict/v1', async (c) => {
    try {
        const body = await c.req.json() as any;

        // Validation similar to api-server.ts
        if (!body.rank || !body.eventType || !body.eventStartTime || (!body.totalDays && !body.eventEndTime) || !body.data) {
            return c.json({
                error: 'Missing required fields',
                required: ['rank', 'eventType', 'eventStartTime', 'totalDays OR eventEndTime', 'data']
            }, 400);
        }

        let calculatedTotalDays = body.totalDays ? parseInt(body.totalDays) : 0;
        if (!calculatedTotalDays && body.eventEndTime) {
            const start = parseInt(body.eventStartTime);
            const end = parseInt(body.eventEndTime);
            calculatedTotalDays = Math.ceil((end - start) / (24 * 3600 * 1000));
        }

        // Prepare configuration for predict-core
        const config: PredictConfig = {
            eventType: body.eventType,
            eventStartTime: parseInt(body.eventStartTime),
            eventEndTime: body.eventEndTime ? parseInt(body.eventEndTime) : undefined,
            totalDays: calculatedTotalDays,
            currentTime: body.currentTime ? parseInt(body.currentTime) : undefined
        };

        const rank = parseInt(body.rank);

        // Prepare scores
        // The input body.data is expected to be { timestamp: number, score: number }[]
        // prepareScores handles conversion to EventRanking[] and filtering
        const scores = prepareScores(body.data, rank);

        // Select Model
        // Currently only bundling marathon model. 
        // In future can use KV or multiple imports mapped by eventType.
        const model: any = marathonModel;

        const result = predict(rank, scores, model, config);

        if (!result) {
            return c.json({ error: 'Could not generate prediction' }, 404);
        }

        return c.json(result, 200, {
            'Cache-Control': 'public, max-age=600'
        });

    } catch (e: any) {
        console.error('Worker Error:', e);
        return c.json({ error: 'Internal server error', details: e.message }, 500);
    }
});

export default app;
