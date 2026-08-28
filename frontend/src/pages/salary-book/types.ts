export interface Employee {
  id: number;
  employee_id: string;
  name: string;
  mobile: string;
  alternate_contact: string;
  address: string;
  blood_group: string;
  date_of_joining: string;
  designation: string;
  department: string;
  monthly_salary: string;
  salary_calculation_method: string;
  fixed_working_days: number | null;
  expected_check_in: string | null;
  expected_check_out: string | null;
  effective_check_in: string | null;
  effective_check_out: string | null;
  scheduled_hours: string;
  daily_rate_preview: string;
  hourly_rate_preview: string;
  profile_photo_url: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  notes: string;
}

export interface Attendance {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  date: string;
  status: string;
  check_in_time: string | null;
  check_out_time: string | null;
  photo_url: string | null;
  check_out_photo_url: string | null;
  latitude: string;
  longitude: string;
  location_accuracy: string;
  location_captured_at: string;
  remarks: string;
  minutes_late: number;
  is_late: boolean;
  worked_minutes: number;
  payable_minutes: number;
  worked_hours: string;
  payable_hours: string;
  rule_penalty_applied: boolean;
  rule_remarks: string;
  expected_check_in: string | null;
  expected_check_out: string | null;
}

export interface AttendanceRule {
  id: number;
  employee: number;
  rule_type: 'CONSECUTIVE_LATE';
  is_active: boolean;
  late_threshold_minutes: number;
  consecutive_late_days: number;
}

export interface LeaveRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  leave_type: 'PAID' | 'UNPAID';
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  remarks: string;
  status: string;
}

export interface SalaryAdvance {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  date: string;
  amount: string;
  reason: string;
  remarks: string;
  status: string;
}

export interface SalaryRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  year: number;
  month: number;
  gross_salary: string;
  present_days: string;
  absent_days: string;
  paid_leave_days: string;
  unpaid_leave_days: string;
  half_days: string;
  holiday_days: string;
  unmarked_days: string;
  leave_deduction: string;
  other_deductions: string;
  allowances: string;
  total_advances: string;
  net_salary: string;
  calculation_method: string;
  divisor_days: number;
  daily_salary: string;
  hourly_rate?: string;
  earned_salary?: string;
  scheduled_hours?: string;
  status: 'DRAFT' | 'FINALIZED';
  payment_status: string;
  breakdown: Record<string, unknown>;
  total_paid: string;
  remaining: string;
  finalized_at: string | null;
  payments?: SalaryPayment[];
}

export interface SalaryPayment {
  id: number;
  employee: number;
  salary_record: number;
  employee_name: string;
  payment_date: string;
  amount: string;
  payment_mode: string;
  reference_number: string;
  remarks: string;
  status: string;
}

export interface SalaryBookSettings {
  salary_calculation_method: 'CALENDAR_DAYS' | 'FIXED_WORKING_DAYS';
  fixed_working_days: number;
  max_gps_accuracy_meters: number;
  office_latitude: string | number;
  office_longitude: string | number;
  geofence_radius_meters: number;
  require_gps: boolean;
  require_photo: boolean;
  require_checkout_gps_photo: boolean;
  default_check_in: string;
  default_check_out: string;
}

export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}

export interface Paginated<T> {
  count: number;
  page: number;
  page_size: number;
  results: T[];
  total_active?: string;
}

export interface CalendarDayCell {
  id?: number;
  status: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  minutes_late?: number;
  is_late?: boolean;
  rule_penalty_applied?: boolean;
}

export interface CalendarEmployee {
  id: number;
  name: string;
  employee_id: string;
  days: Record<string, CalendarDayCell>;
  counts: {
    PRESENT: number;
    ABSENT: number;
    HALF_DAY: number;
    PAID_LEAVE: number;
    UNPAID_LEAVE: number;
    HOLIDAY: number;
    unmarked: number;
  };
}

export interface CalendarKpis {
  employees: number;
  present: number;
  absent: number;
  half_day: number;
  paid_leave: number;
  unpaid_leave: number;
  holiday: number;
  unmarked: number;
  attendance_rate: string;
}

export interface CalendarResponse {
  year: number;
  month: number;
  days_in_month: number;
  today: string;
  view: 'admin' | 'employee';
  kpis: CalendarKpis;
  employees: CalendarEmployee[];
}

export interface DashboardLiveUnmarked {
  id: number;
  name: string;
  employee_id: string;
}

export interface DashboardResponse {
  greeting: string;
  today: string;
  today_attendance: {
    present: number;
    absent: number;
    paid_leave: number;
    unpaid_leave: number;
    half_day: number;
    holiday: number;
    unmarked: number;
  };
  live: {
    updated_at: string;
    marked: Attendance[];
    unmarked: DashboardLiveUnmarked[];
  };
  month: {
    year: number;
    month: number;
    total_employees: number;
    monthly_payroll: string;
    advances: string;
    salary_pending: string;
  };
}
