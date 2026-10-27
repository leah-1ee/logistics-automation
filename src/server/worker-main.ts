import { connectDb } from './db.js';
import { startJobs } from '../jobs/jobs.js';
const db=await connectDb();const jobs=startJobs(db);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await jobs.close();await db.close(true);});
