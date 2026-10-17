/** Shared public constants (single source for llms.txt, OpenAPI, server card, MCP, homepage). */
import { resolvePlan } from './plan.ts';
export const VERSION = '0.2.0'; // must equal wrangler [vars] VERSION, package.json and app/server.json (tests check)
export const BASIC_CAPS = resolvePlan(null); // free tier = RapidAPI BASIC caps
export const MCP_CALLS_PER_MIN = 10; // tools/call per IP (/64) per minute; matches RapidAPI BASIC 10 req/min
export const RAPIDAPI_URL = 'https://rapidapi.com/miketusa/api/meetzone-timezone-meeting-overlap-api';
export const SUPPORT_EMAIL = 'digitalpromohub.support@gmail.com';
export const PRO_PRICE = '$25/month'; // RapidAPI PRO plan
