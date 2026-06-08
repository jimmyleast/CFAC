export type FieldClassification = 'aggregate' | 'staff_pii' | 'client_phi' | 'client_adjacent' | 'operational_sensitive'
export type ProfileMode = 'aggregate_rows' | 'aggregate_from_sensitive_rows' | 'design_only'

export type SourceProfileField = {
  canonical: string
  aliases: string[]
  type: 'text' | 'number' | 'date' | 'currency' | 'boolean'
  required?: boolean
  classification: FieldClassification
}

export type SourceProfile = {
  key: string
  name: string
  mode: ProfileMode
  sourceSlugs: string[]
  description: string
  fields: SourceProfileField[]
}

export const SOURCE_PROFILES: SourceProfile[] = [
  {
    key: 'impact_history',
    name: 'Impact Through the Years',
    mode: 'aggregate_rows',
    sourceSlugs: ['impact-history'],
    description: 'Annual aggregate impact workbook. Safe to import as metric rows.',
    fields: [
      { canonical: 'year', aliases: ['Year'], type: 'number', required: true, classification: 'aggregate' },
      { canonical: 'reach', aliases: ['Reach'], type: 'number', classification: 'aggregate' },
      { canonical: 'clients_served', aliases: ['Children Served', 'Clients Served'], type: 'number', classification: 'aggregate' },
      { canonical: 'forensic_interviews', aliases: ['Forensic Interviews'], type: 'number', classification: 'aggregate' },
      { canonical: 'medical', aliases: ['Medical'], type: 'number', classification: 'aggregate' },
      { canonical: 'mental_health', aliases: ['Mental Health'], type: 'number', classification: 'aggregate' },
      { canonical: 'education', aliases: ['Education'], type: 'number', classification: 'aggregate' },
      { canonical: 'tours', aliases: ['Tours'], type: 'number', classification: 'aggregate' },
      { canonical: 'community_events', aliases: ['Community Events'], type: 'number', classification: 'aggregate' },
      { canonical: 'volunteers', aliases: ['Volunteers'], type: 'number', classification: 'aggregate' },
      { canonical: 'residential_women', aliases: ['Res Women'], type: 'number', classification: 'aggregate' },
      { canonical: 'residential_children', aliases: ['Res Children'], type: 'number', classification: 'aggregate' },
    ],
  },
  {
    key: 'maintenance_request_2026',
    name: 'Maintenance Request Form 2026',
    mode: 'aggregate_from_sensitive_rows',
    sourceSlugs: ['maintenance-form'],
    description: 'Microsoft Forms maintenance log. Staff names, emails, and descriptions are not stored; only aggregate metrics are kept.',
    fields: [
      { canonical: 'date', aliases: ['Date', 'Start time'], type: 'date', required: true, classification: 'aggregate' },
      { canonical: 'email', aliases: ['Email'], type: 'text', classification: 'staff_pii' },
      { canonical: 'name', aliases: ['Name', 'Staff Name'], type: 'text', classification: 'staff_pii' },
      { canonical: 'location', aliases: ['Building/Location', 'Room/Location'], type: 'text', classification: 'operational_sensitive' },
      { canonical: 'description', aliases: ['Description of Maintenance Request with Detail', 'Notes'], type: 'text', classification: 'operational_sensitive' },
      { canonical: 'request_type', aliases: ['Request Type'], type: 'text', classification: 'aggregate' },
      { canonical: 'priority', aliases: ['Priority'], type: 'text', classification: 'aggregate' },
      { canonical: 'status', aliases: ['Status'], type: 'text', classification: 'aggregate' },
      { canonical: 'on_time', aliases: ['On Time?'], type: 'boolean', classification: 'aggregate' },
      { canonical: 'actual_cost', aliases: ['Actual Cost'], type: 'currency', classification: 'aggregate' },
    ],
  },
  {
    key: 'fleet_management_2026',
    name: 'Fleet Management 2026',
    mode: 'aggregate_from_sensitive_rows',
    sourceSlugs: ['fleet-form'],
    description: 'Vehicle-use log. Driver names, emails, locations, and narrative purpose are not stored; only aggregate metrics are kept.',
    fields: [
      { canonical: 'date', aliases: ['Date of Vehicle Use', 'Start time'], type: 'date', required: true, classification: 'aggregate' },
      { canonical: 'email', aliases: ['Email'], type: 'text', classification: 'staff_pii' },
      { canonical: 'driver', aliases: ['Name of Driver', 'Name'], type: 'text', classification: 'staff_pii' },
      { canonical: 'vehicle_type', aliases: ['Vehicle Type'], type: 'text', classification: 'aggregate' },
      { canonical: 'purpose', aliases: ['Purpose of Travel'], type: 'text', classification: 'client_adjacent' },
      { canonical: 'location', aliases: ['Location'], type: 'text', classification: 'operational_sensitive' },
      { canonical: 'miles_driven', aliases: ['Miles Driven'], type: 'number', classification: 'aggregate' },
      { canonical: 'half_tank', aliases: ['1/2 Tank of Fuel?'], type: 'boolean', classification: 'aggregate' },
      { canonical: 'maintenance_issues', aliases: ['List and describe any maintenance issues'], type: 'text', classification: 'operational_sensitive' },
    ],
  },
  {
    key: 'education_training_aggregate',
    name: 'Education Training Aggregate',
    mode: 'aggregate_from_sensitive_rows',
    sourceSlugs: ['education-sheet'],
    description: 'Training rows roll up to counts and attendee totals by month/audience/type. Speaker names are not stored.',
    fields: [
      { canonical: 'date', aliases: ['Date', 'Training Date', 'Start time'], type: 'date', required: true, classification: 'aggregate' },
      { canonical: 'speaker', aliases: ['Speaker', 'Presenter'], type: 'text', classification: 'staff_pii' },
      { canonical: 'training_type', aliases: ['Training Type', 'Type', 'Topic'], type: 'text', classification: 'aggregate' },
      { canonical: 'audience', aliases: ['Audience', 'Audience Type'], type: 'text', classification: 'aggregate' },
      { canonical: 'attendees', aliases: ['Attendees', 'Attendance', 'People Trained', 'Reach'], type: 'number', classification: 'aggregate' },
    ],
  },
  {
    key: 'community_engagement_aggregate',
    name: 'Community Engagement Aggregate',
    mode: 'aggregate_from_sensitive_rows',
    sourceSlugs: ['community-engagement'],
    description: 'Events/tours roll up to counts, attendance, leads, and conversions by month/type.',
    fields: [
      { canonical: 'date', aliases: ['Date', 'Event Date', 'Tour Date', 'Start time'], type: 'date', required: true, classification: 'aggregate' },
      { canonical: 'event_type', aliases: ['Event Type', 'Type', 'Activity Type'], type: 'text', classification: 'aggregate' },
      { canonical: 'attendance', aliases: ['Attendance', 'Attendees', 'Reach'], type: 'number', classification: 'aggregate' },
      { canonical: 'leads', aliases: ['Leads', 'New Leads'], type: 'number', classification: 'aggregate' },
      { canonical: 'conversions', aliases: ['Conversions', 'Converted'], type: 'number', classification: 'aggregate' },
    ],
  },
  {
    key: 'volunteers_aggregate',
    name: 'Volunteers Aggregate',
    mode: 'aggregate_from_sensitive_rows',
    sourceSlugs: ['volunteers-sheet'],
    description: 'Volunteer rows roll up to volunteer counts and hours. Individual names/contact details are not stored.',
    fields: [
      { canonical: 'date', aliases: ['Date', 'Volunteer Date', 'Start time'], type: 'date', required: true, classification: 'aggregate' },
      { canonical: 'volunteer_name', aliases: ['Volunteer Name', 'Name', 'Email'], type: 'text', classification: 'staff_pii' },
      { canonical: 'volunteer_type', aliases: ['Volunteer Type', 'Type', 'Group/Individual'], type: 'text', classification: 'aggregate' },
      { canonical: 'volunteer_count', aliases: ['Volunteers', 'Volunteer Count', 'Count'], type: 'number', classification: 'aggregate' },
      { canonical: 'hours', aliases: ['Hours', 'Volunteer Hours'], type: 'number', classification: 'aggregate' },
    ],
  },
  {
    key: 'development_aggregate',
    name: 'Development Aggregate',
    mode: 'aggregate_from_sensitive_rows',
    sourceSlugs: ['development-bloomerang'],
    description: 'Development aggregate rows roll up gifts, revenue, grants, and in-kind totals. Donor identities are not stored.',
    fields: [
      { canonical: 'date', aliases: ['Date', 'Gift Date', 'Period'], type: 'date', required: true, classification: 'aggregate' },
      { canonical: 'donor', aliases: ['Donor', 'Constituent', 'Name', 'Email'], type: 'text', classification: 'staff_pii' },
      { canonical: 'campaign', aliases: ['Campaign', 'Fund', 'Appeal'], type: 'text', classification: 'aggregate' },
      { canonical: 'gift_count', aliases: ['Gifts', 'Gift Count', 'Donations'], type: 'number', classification: 'aggregate' },
      { canonical: 'amount', aliases: ['Amount', 'Donation Amount', 'Revenue'], type: 'currency', classification: 'aggregate' },
      { canonical: 'in_kind_value', aliases: ['In-Kind Value', 'In Kind Value'], type: 'currency', classification: 'aggregate' },
    ],
  },
  {
    key: 'finance_aggregate',
    name: 'Finance Aggregate',
    mode: 'aggregate_rows',
    sourceSlugs: ['finance-quickbooks'],
    description: 'Finance aggregate rows for income, expenses, payroll, and cash balance. No vendor/client memo lines.',
    fields: [
      { canonical: 'period', aliases: ['Period', 'Month', 'Date'], type: 'date', required: true, classification: 'aggregate' },
      { canonical: 'income', aliases: ['Income', 'Revenue'], type: 'currency', classification: 'aggregate' },
      { canonical: 'expenses', aliases: ['Expenses', 'Expense'], type: 'currency', classification: 'aggregate' },
      { canonical: 'payroll', aliases: ['Payroll'], type: 'currency', classification: 'aggregate' },
      { canonical: 'cash_balance', aliases: ['Cash Balance', 'Cash'], type: 'currency', classification: 'aggregate' },
    ],
  },
  {
    key: 'hr_aggregate',
    name: 'HR Aggregate',
    mode: 'aggregate_rows',
    sourceSlugs: ['hr-isolved'],
    description: 'HR aggregate rows for applicants, screenings, open positions, turnover, and retention. No employee records.',
    fields: [
      { canonical: 'period', aliases: ['Period', 'Month', 'Date'], type: 'date', required: true, classification: 'aggregate' },
      { canonical: 'applicants', aliases: ['Applicants', 'Applications'], type: 'number', classification: 'aggregate' },
      { canonical: 'phone_screenings', aliases: ['Phone Screenings', 'Screenings'], type: 'number', classification: 'aggregate' },
      { canonical: 'open_positions', aliases: ['Open Positions', 'Open Roles'], type: 'number', classification: 'aggregate' },
      { canonical: 'turnover', aliases: ['Turnover', 'Separations'], type: 'number', classification: 'aggregate' },
      { canonical: 'retention_rate', aliases: ['Retention Rate', 'Retention %'], type: 'number', classification: 'aggregate' },
    ],
  },
]

export function listSourceProfiles(): SourceProfile[] {
  return SOURCE_PROFILES
}

export function getSourceProfile(key: string | null | undefined): SourceProfile | null {
  if (!key) return null
  return SOURCE_PROFILES.find((p) => p.key === key) || null
}

export function profileForSourceSlug(slug: string | null | undefined): SourceProfile | null {
  if (!slug) return null
  return SOURCE_PROFILES.find((p) => p.sourceSlugs.includes(slug)) || null
}
