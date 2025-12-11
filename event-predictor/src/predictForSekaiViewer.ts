import { readFileSync, writeFileSync } from "fs";
import * as redis from "redis";
// import { execSync } from "child_process";
import axios from "axios";
import { predictAll } from "./predict";

async function downloadModel() {
  let response = await axios.get(
    `https://${process.env.MINIO_END_POINT}/${process.env.MINIO_BUCKET}/predict_models_marathon.json`,
    {
      headers: {
        "user-agent": "Mozilla",
      },
    }
  );
  writeFileSync(
    process.env.IS_SERVERLESS ? "/tmp/predict_models_marathon.json" : "predict_models_marathon.json",
    JSON.stringify(response.data),
    "utf-8"
  );
  
  response = await axios.get(
    `https://${process.env.MINIO_END_POINT}/${process.env.MINIO_BUCKET}/predict_models_cheerful_carnival.json`,
    {
      headers: {
        "user-agent": "Mozilla",
      },
    }
  );
  writeFileSync(
    process.env.IS_SERVERLESS ? "/tmp/predict_models_cheerful_carnival.json" : "predict_models_cheerful_carnival.json",
    JSON.stringify(response.data),
    "utf-8"
  );
}

export async function main() {
  const client = redis.createClient({url: process.env.REDIS_URL});
  await client.connect();
  await client.ping();

  await downloadModel();
  await predictAll();

  // Load simple format for backward compatibility
  let outJson = JSON.parse(
    readFileSync(
      process.env.IS_SERVERLESS ? "/tmp/out-predict.json" : "out-predict.json",
      "utf-8"
    )
  );

  // Load detailed format with confidence intervals
  let outJsonDetailed = JSON.parse(
    readFileSync(
      process.env.IS_SERVERLESS ? "/tmp/out-predict-detailed.json" : "out-predict-detailed.json",
      "utf-8"
    )
  );

  for (const r in outJson) {
    let pre = outJson[r];
    // Keep simple format for backward compatibility
    client.set(`predict-${r}`, pre.toString());

    // Store detailed prediction with confidence intervals
    if (outJsonDetailed[r]) {
      client.set(`predict-detailed-${r}`, JSON.stringify(outJsonDetailed[r]));
    }
  }
  client.set(`predict-ts`, new Date().getTime());
}
