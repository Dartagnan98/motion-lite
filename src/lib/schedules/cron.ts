import { CronExpressionParser } from 'cron-parser'

/**
 * Parse a 5-field cron expression in the given IANA timezone and return the
 * next fire time as a unix-seconds epoch. Returns null if the expression is
 * invalid so callers can surface a validation error without try/catch noise.
 */
export function computeNextRun(cronExpr: string, timezone: string, fromDate?: Date): number | null {
  try {
    const iter = CronExpressionParser.parse(cronExpr, {
      tz: timezone,
      currentDate: fromDate ?? new Date(),
    })
    const next = iter.next().toDate()
    return Math.floor(next.getTime() / 1000)
  } catch {
    return null
  }
}

export function isValidCron(cronExpr: string, timezone = 'UTC'): boolean {
  try {
    CronExpressionParser.parse(cronExpr, { tz: timezone })
    return true
  } catch {
    return false
  }
}
