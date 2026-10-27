import { connectDb } from '../src/server/db.js';
import { collect } from '../src/ingestion/ingest.js';
const db=await connectDb();try{console.log(await collect(db,process.env.DATASET_RUN_ID!,process.env.SOURCE_URL!));}finally{await db.close(true);}
