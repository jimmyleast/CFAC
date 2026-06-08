-- Non-PHI/aggregate profile expansion for manual upload + connected workbook sync.
-- Metadata only; no workbook rows, no staff/client identifiers.

insert into source_profiles (key, name, mode, description) values
  ('education_training_aggregate', 'Education Training Aggregate', 'aggregate_from_sensitive_rows', 'Training rows roll up to counts and attendee totals by month/audience/type. Speaker names are not stored.'),
  ('community_engagement_aggregate', 'Community Engagement Aggregate', 'aggregate_from_sensitive_rows', 'Events/tours roll up to counts, attendance, leads, and conversions by month/type.'),
  ('volunteers_aggregate', 'Volunteers Aggregate', 'aggregate_from_sensitive_rows', 'Volunteer rows roll up to volunteer counts and hours. Individual names/contact details are not stored.'),
  ('development_aggregate', 'Development Aggregate', 'aggregate_from_sensitive_rows', 'Development rows roll up gifts, revenue, grants, and in-kind totals. Donor identities are not stored.'),
  ('finance_aggregate', 'Finance Aggregate', 'aggregate_rows', 'Finance aggregate rows for income, expenses, payroll, and cash balance. No vendor/client memo lines.'),
  ('hr_aggregate', 'HR Aggregate', 'aggregate_rows', 'HR aggregate rows for applicants, screenings, open positions, turnover, and retention. No employee records.')
on conflict (key) do update set
  name = excluded.name,
  mode = excluded.mode,
  description = excluded.description,
  updated_at = now();

insert into source_profile_fields (profile_key, canonical, aliases, value_type, required, classification) values
  ('education_training_aggregate', 'date', array['Date','Training Date','Start time'], 'date', true, 'aggregate'),
  ('education_training_aggregate', 'speaker', array['Speaker','Presenter'], 'text', false, 'staff_pii'),
  ('education_training_aggregate', 'training_type', array['Training Type','Type','Topic'], 'text', false, 'aggregate'),
  ('education_training_aggregate', 'audience', array['Audience','Audience Type'], 'text', false, 'aggregate'),
  ('education_training_aggregate', 'attendees', array['Attendees','Attendance','People Trained','Reach'], 'number', false, 'aggregate'),
  ('community_engagement_aggregate', 'date', array['Date','Event Date','Tour Date','Start time'], 'date', true, 'aggregate'),
  ('community_engagement_aggregate', 'event_type', array['Event Type','Type','Activity Type'], 'text', false, 'aggregate'),
  ('community_engagement_aggregate', 'attendance', array['Attendance','Attendees','Reach'], 'number', false, 'aggregate'),
  ('community_engagement_aggregate', 'leads', array['Leads','New Leads'], 'number', false, 'aggregate'),
  ('community_engagement_aggregate', 'conversions', array['Conversions','Converted'], 'number', false, 'aggregate'),
  ('volunteers_aggregate', 'date', array['Date','Volunteer Date','Start time'], 'date', true, 'aggregate'),
  ('volunteers_aggregate', 'volunteer_name', array['Volunteer Name','Name','Email'], 'text', false, 'staff_pii'),
  ('volunteers_aggregate', 'volunteer_type', array['Volunteer Type','Type','Group/Individual'], 'text', false, 'aggregate'),
  ('volunteers_aggregate', 'volunteer_count', array['Volunteers','Volunteer Count','Count'], 'number', false, 'aggregate'),
  ('volunteers_aggregate', 'hours', array['Hours','Volunteer Hours'], 'number', false, 'aggregate'),
  ('development_aggregate', 'date', array['Date','Gift Date','Period'], 'date', true, 'aggregate'),
  ('development_aggregate', 'donor', array['Donor','Constituent','Name','Email'], 'text', false, 'staff_pii'),
  ('development_aggregate', 'campaign', array['Campaign','Fund','Appeal'], 'text', false, 'aggregate'),
  ('development_aggregate', 'gift_count', array['Gifts','Gift Count','Donations'], 'number', false, 'aggregate'),
  ('development_aggregate', 'amount', array['Amount','Donation Amount','Revenue'], 'currency', false, 'aggregate'),
  ('development_aggregate', 'in_kind_value', array['In-Kind Value','In Kind Value'], 'currency', false, 'aggregate'),
  ('finance_aggregate', 'period', array['Period','Month','Date'], 'date', true, 'aggregate'),
  ('finance_aggregate', 'income', array['Income','Revenue'], 'currency', false, 'aggregate'),
  ('finance_aggregate', 'expenses', array['Expenses','Expense'], 'currency', false, 'aggregate'),
  ('finance_aggregate', 'payroll', array['Payroll'], 'currency', false, 'aggregate'),
  ('finance_aggregate', 'cash_balance', array['Cash Balance','Cash'], 'currency', false, 'aggregate'),
  ('hr_aggregate', 'period', array['Period','Month','Date'], 'date', true, 'aggregate'),
  ('hr_aggregate', 'applicants', array['Applicants','Applications'], 'number', false, 'aggregate'),
  ('hr_aggregate', 'phone_screenings', array['Phone Screenings','Screenings'], 'number', false, 'aggregate'),
  ('hr_aggregate', 'open_positions', array['Open Positions','Open Roles'], 'number', false, 'aggregate'),
  ('hr_aggregate', 'turnover', array['Turnover','Separations'], 'number', false, 'aggregate'),
  ('hr_aggregate', 'retention_rate', array['Retention Rate','Retention %'], 'number', false, 'aggregate')
on conflict (profile_key, canonical) do update set
  aliases = excluded.aliases,
  value_type = excluded.value_type,
  required = excluded.required,
  classification = excluded.classification;

update data_sources set source_profile_key = 'education_training_aggregate' where slug = 'education-sheet';
update data_sources set source_profile_key = 'community_engagement_aggregate' where slug = 'community-engagement';
update data_sources set source_profile_key = 'volunteers_aggregate' where slug = 'volunteers-sheet';
update data_sources set source_profile_key = 'development_aggregate' where slug = 'development-bloomerang';
update data_sources set source_profile_key = 'finance_aggregate' where slug = 'finance-quickbooks';
update data_sources set source_profile_key = 'hr_aggregate' where slug = 'hr-isolved';
