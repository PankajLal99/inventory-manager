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
