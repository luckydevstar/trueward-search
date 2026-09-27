// Run scrapers once from the terminal:  npm run scrape [-- linkedin jobgether ...]
import 'dotenv/config';
import { runAll } from './scraper.js';

const results = await runAll(process.argv.slice(2));
console.table(results.map(({ source, fetched, accepted, inserted, error }) => ({ source, fetched, accepted, inserted, error })));
process.exit(0);
