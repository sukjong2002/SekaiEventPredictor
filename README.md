# SekaiEventPredictor
Event predictor for game Project SEKAI.

## Usage 

### Init or Update
```sh
ts-node downloadData.ts
ts-node genModel.ts
```

### Predict
```sh
ts-node predict.ts
```

### Debug Test Mode

Test prediction accuracy using historical event data. This mode simulates prediction at a specific progress point (default: 50%) and compares the result with actual final scores.

**How to enable:**
1. Open `predict.ts`
2. Set `debugTestMode = true`
3. Configure test parameters:
   - `debugTestEventId`: Event ID to test with (e.g., 131)
   - `debugTestProgressRatio`: Progress ratio to simulate (e.g., 0.5 for 50%)

**Example:**
```typescript
let debugTestMode = true;
let debugTestEventId = 131;
let debugTestProgressRatio = 0.5; // Predict at 50% progress
```

**Run test:**
```sh
ts-node predict.ts
```

**Output:**
- Predicted vs Actual scores for each rank
- Error percentage
- Whether actual score falls within confidence intervals
- Summary statistics (average error, CI coverage)

**Example output:**
```
=== DEBUG TEST MODE ===
Testing with event 131 at 50% progress
...
T100 145230 (95% CI: 138000-152000)
     Actual: 147850
     Error: -2620 (-1.77%)
     Within 95% CI: ✓ YES

=== TEST RESULTS SUMMARY ===
Total ranks tested: 14
Average absolute error: 3542
Average absolute error %: 2.31%
Within 95% CI: 13/14 (92.9%)
Within 80% CI: 11/14 (78.6%)
```

### Visualization

Interactive visualization of prediction results with daily and hourly projections for all ranks.

**How to use:**
1. Run prediction (normal or debug mode):
   ```sh
   ts-node predict.ts
   ```
2. Start the visualization server:
   ```sh
   node serve-visualization.js
   ```
3. Open http://localhost:8000 in your browser

**Features:**
- **Daily Projection Chart**: Shows predicted scores for each day of the event
- **Hourly Projection Chart**: Shows predicted scores for the current day (30-minute intervals)
- **Confidence Intervals**: Displays 95% and 80% confidence intervals as shaded areas
- **Multiple Ranks**: Select/deselect ranks to compare predictions across different rank tiers
- **Test Mode Support**: When using debug test mode, actual final scores are displayed as star markers
- **Interactive**: Hover over data points to see detailed values

**Chart Legend:**
- Solid line: Actual data (already occurred)
- Dashed line: Predicted data (future)
- Shaded area: 95% confidence interval
- Star marker: Actual final score (debug mode only)

## Usage for Sekai Viewer

### Prepare
Notice: Minio example end point and key comes from [minio offical document](https://docs.min.io/docs/javascript-client-quickstart-guide.html).  
Environment variables:
- `REDIS_URL` Redis url for saving predict. Format:`redis://[user:password@]host[:port][/database][?option=value]`.
- `MINIO_END_POINT` Minio endPoint, which will be used to save predict model. Example:`play.min.io`.
- `MINIO_BUCKET` Minio bucket. Example:`europetrip`.
- `MINIO_ACCESS_KEY` Minio access key. Example:`Q3AM3UQ867SPQQA43P2F`.
- `MINIO_SECRET_KEY` Minio secret key. Example:`zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG`.

### Init or Update
```sh
ts-node updateForSekaiViewer.ts
```

### Predict
#### Normal
```sh
ts-node predictForSekaiViewer.ts
```