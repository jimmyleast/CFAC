-- Operational definitions for the expanded non-PHI aggregate profiles.
-- Governance metadata only.

insert into metric_definitions
  (key, display_name, definition, category, program_area, unit, calc_rule, owner, source_note, sort_order)
values
  ('education_trainings_total', 'Education Trainings', 'Count of education/prevention training rows.', 'operational', 'education', 'count', 'One count per training row, grouped by month.', 'Education', 'Education Training Aggregate profile.', 700),
  ('education_trainings_by_type', 'Education Trainings by Type', 'Training count grouped by training type/topic.', 'operational', 'education', 'count', 'COUNT(trainings) GROUP BY training_type and month.', 'Education', 'Education Training Aggregate profile.', 701),
  ('education_trainings_by_audience', 'Education Trainings by Audience', 'Training count grouped by audience.', 'operational', 'education', 'count', 'COUNT(trainings) GROUP BY audience and month.', 'Education', 'Education Training Aggregate profile.', 702),
  ('education_attendees', 'Education Attendees', 'Total training attendees / people trained.', 'operational', 'education', 'count', 'SUM(attendees) grouped by month.', 'Education', 'Education Training Aggregate profile.', 703),
  ('community_events_total', 'Community Events', 'Count of community engagement events/tours.', 'operational', 'community-relations', 'count', 'One count per event row, grouped by month.', 'Community Relations', 'Community Engagement Aggregate profile.', 710),
  ('community_events_by_type', 'Community Events by Type', 'Community engagement count grouped by event/activity type.', 'operational', 'community-relations', 'count', 'COUNT(events) GROUP BY event_type and month.', 'Community Relations', 'Community Engagement Aggregate profile.', 711),
  ('community_event_attendance', 'Community Event Attendance', 'Total event/tour attendance.', 'operational', 'community-relations', 'count', 'SUM(attendance) grouped by month.', 'Community Relations', 'Community Engagement Aggregate profile.', 712),
  ('community_leads', 'Community Leads', 'Total leads recorded from community engagement.', 'operational', 'community-relations', 'count', 'SUM(leads) grouped by month.', 'Community Relations', 'Community Engagement Aggregate profile.', 713),
  ('community_conversions', 'Community Conversions', 'Total conversions recorded from community engagement.', 'operational', 'community-relations', 'count', 'SUM(conversions) grouped by month.', 'Community Relations', 'Community Engagement Aggregate profile.', 714),
  ('volunteer_entries_total', 'Volunteer Entries', 'Count of volunteer activity rows.', 'operational', 'community-relations', 'count', 'One count per volunteer row, grouped by month.', 'Community Relations', 'Volunteers Aggregate profile.', 720),
  ('volunteers_by_type', 'Volunteers by Type', 'Volunteer activity grouped by type/group.', 'operational', 'community-relations', 'count', 'COUNT(rows) GROUP BY volunteer_type and month.', 'Community Relations', 'Volunteers Aggregate profile.', 721),
  ('volunteers_total', 'Volunteers', 'Total volunteers counted in the volunteer log.', 'operational', 'community-relations', 'count', 'SUM(volunteer_count) grouped by month.', 'Community Relations', 'Volunteers Aggregate profile.', 722),
  ('volunteer_hours', 'Volunteer Hours', 'Total volunteer hours.', 'operational', 'community-relations', 'hours', 'SUM(hours) grouped by month.', 'Community Relations', 'Volunteers Aggregate profile.', 723),
  ('development_gifts', 'Development Gifts', 'Total gift/donation count.', 'operational', 'development', 'count', 'SUM(gift_count) grouped by month.', 'Development', 'Development Aggregate profile.', 730),
  ('development_gifts_by_campaign', 'Development Gifts by Campaign', 'Gift rows/counts grouped by campaign/fund/appeal.', 'operational', 'development', 'count', 'COUNT(rows) GROUP BY campaign and month.', 'Development', 'Development Aggregate profile.', 731),
  ('development_revenue', 'Development Revenue', 'Total development revenue.', 'operational', 'development', 'usd', 'SUM(amount) grouped by month.', 'Development', 'Development Aggregate profile.', 732),
  ('development_in_kind_value', 'Development In-Kind Value', 'Total in-kind value.', 'operational', 'development', 'usd', 'SUM(in_kind_value) grouped by month.', 'Development', 'Development Aggregate profile.', 733),
  ('finance_income', 'Finance Income', 'Aggregate income/revenue.', 'operational', 'finance', 'usd', 'SUM(income) by period.', 'Finance', 'Finance Aggregate profile.', 740),
  ('finance_expenses', 'Finance Expenses', 'Aggregate expenses.', 'operational', 'finance', 'usd', 'SUM(expenses) by period.', 'Finance', 'Finance Aggregate profile.', 741),
  ('finance_payroll', 'Finance Payroll', 'Aggregate payroll.', 'operational', 'finance', 'usd', 'SUM(payroll) by period.', 'Finance', 'Finance Aggregate profile.', 742),
  ('finance_cash_balance', 'Finance Cash Balance', 'Cash balance for the reporting period.', 'operational', 'finance', 'usd', 'Latest/summed cash balance rows by period.', 'Finance', 'Finance Aggregate profile.', 743),
  ('hr_applicants', 'HR Applicants', 'Aggregate applicant count.', 'operational', 'hr', 'count', 'SUM(applicants) by period.', 'Human Resources', 'HR Aggregate profile.', 750),
  ('hr_phone_screenings', 'HR Phone Screenings', 'Aggregate phone screening count.', 'operational', 'hr', 'count', 'SUM(phone_screenings) by period.', 'Human Resources', 'HR Aggregate profile.', 751),
  ('hr_open_positions', 'HR Open Positions', 'Aggregate open position count.', 'operational', 'hr', 'count', 'SUM(open_positions) by period.', 'Human Resources', 'HR Aggregate profile.', 752),
  ('hr_turnover', 'HR Turnover', 'Aggregate turnover/separation count.', 'operational', 'hr', 'count', 'SUM(turnover) by period.', 'Human Resources', 'HR Aggregate profile.', 753),
  ('hr_retention_rate', 'HR Retention Rate', 'Aggregate retention rate.', 'operational', 'hr', 'percent', 'Latest retention rate by period; do not sum across unrelated sources.', 'Human Resources', 'HR Aggregate profile.', 754)
on conflict (key) do update set
  display_name = excluded.display_name,
  definition = excluded.definition,
  category = excluded.category,
  program_area = excluded.program_area,
  unit = excluded.unit,
  calc_rule = excluded.calc_rule,
  owner = excluded.owner,
  source_note = excluded.source_note,
  sort_order = excluded.sort_order,
  updated_at = now();
