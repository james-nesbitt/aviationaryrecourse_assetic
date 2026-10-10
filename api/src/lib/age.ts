/**
 * Completed whole years between two dates, calendar-correct: the anniversary
 * must have been reached, so a birthday later this month does not count.
 *
 * Age is derived rather than stored. It is a function of the instant you ask,
 * and this dataset is read at a fixed anchor (`dataset_anchor_v`); a stored age
 * column would be wrong the moment the anchor moved.
 */
export function completedYears(from: Date, at: Date): number {
  let years = at.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = at.getUTCMonth() - from.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && at.getUTCDate() < from.getUTCDate())) {
    years -= 1;
  }
  return years;
}