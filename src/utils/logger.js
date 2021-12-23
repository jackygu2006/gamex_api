import pino from "pino";
// import { APP_ID, LOG_LEVEL } from "./Config";

export const logger = pino({
  name: 'gamex',
  level: 'debug'
});