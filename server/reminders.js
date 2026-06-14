import { differenceInCalendarDays, parseISO } from 'date-fns';

export function getReminderStage(dueDate, today = new Date()) {
  const diff = differenceInCalendarDays(parseISO(dueDate), today);
  if ([7, 3, 1, 0].includes(diff)) return `截止日前 ${diff} 天`;
  if (diff < 0) return '逾期后每日提醒';
  return null;
}
