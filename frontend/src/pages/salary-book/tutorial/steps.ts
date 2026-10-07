export type TutorialPlacement = 'auto' | 'top' | 'bottom' | 'center';

export interface TutorialStep {
  id: string;
  /** Route to visit before highlighting. Empty keeps current route. */
  route?: string;
  /** `data-tutorial` attribute value. Omit for centered intro/outro cards. */
  target?: string;
  /** Open the mobile More sheet before measuring the target. */
  openMore?: boolean;
  /** Skip this step on desktop (lg+) when the target only exists on mobile. */
  mobileOnly?: boolean;
  title: string;
  body: string;
  notes?: string[];
  placement?: TutorialPlacement;
}

export const SALARY_BOOK_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    route: '/salary-book',
    title: 'Welcome to Salary Book',
    body: 'This short tour shows where to click and what each area does — attendance, advances, salary deductions, and more.',
    notes: [
      'You can skip anytime and replay later from Settings.',
      'Nothing is changed while you take the tour.',
    ],
    placement: 'center',
  },
  {
    id: 'dash-live',
    route: '/salary-book',
    target: 'dash-live',
    title: 'Live timetable',
    body: 'See who is present, late, on leave, or still unmarked today. Filter by status with the chips above the list.',
    notes: ['Updates automatically every few seconds.', 'Tap Refresh if you need the latest punches right away.'],
    placement: 'bottom',
  },
  {
    id: 'dash-actions',
    route: '/salary-book',
    target: 'dash-actions',
    title: 'Quick actions',
    body: 'Shortcuts from Home: mark attendance, open the calendar, add an employee, record an advance, or open the salary book.',
    notes: ['These jump to the same screens as the bottom / side navigation.'],
    placement: 'top',
  },
  {
    id: 'nav-attendance',
    route: '/salary-book',
    target: 'nav-attendance',
    title: 'Attendance',
    body: 'Tap Attendance to mark present, half day, absent, holiday, or leave for an employee.',
    notes: [
      'In Geo mode you must be inside the office geofence (and may need a selfie).',
      'In Hardware mode device punches create records automatically.',
      'In Manual mode admins can mark without GPS.',
    ],
    placement: 'top',
  },
  {
    id: 'att-page',
    route: '/salary-book/attendance',
    target: 'att-page',
    title: 'How to mark attendance',
    body: 'Pick the date (if allowed), choose an employee, select a status, then save. Check-out is available after someone is marked present.',
    notes: [
      'Leave statuses here create same-day leave attendance.',
      'GPS accuracy and geofence settings live under Settings.',
    ],
    placement: 'bottom',
  },
  {
    id: 'nav-calendar',
    route: '/salary-book/attendance',
    target: 'nav-calendar',
    title: 'Calendar',
    body: 'Open Calendar for a month view of every employee’s attendance.',
    notes: ['Great for spotting unmarked days and patterns at a glance.'],
    placement: 'top',
  },
  {
    id: 'cal-page',
    route: '/salary-book/calendar',
    target: 'cal-page',
    title: 'Attendance calendar',
    body: 'Tap an unmarked day to add check-in / check-out times. Filter by employee or view everyone together.',
    notes: [
      'Coloured cells show present, leave, holiday, and more.',
      'Manual edits here still feed salary calculations.',
    ],
    placement: 'bottom',
  },
  {
    id: 'nav-employees',
    route: '/salary-book/calendar',
    target: 'nav-employees',
    title: 'Employees',
    body: 'Manage staff profiles, salary, and expected in/out times from Employees.',
    placement: 'top',
  },
  {
    id: 'emp-add',
    route: '/salary-book/employees',
    target: 'emp-add',
    title: 'Add an employee',
    body: 'Tap + to create a new employee. Open any person for attendance history, leaves, advances, and salary records.',
    notes: ['Inactive employees stay in history but drop out of live payroll views.'],
    placement: 'bottom',
  },
  {
    id: 'nav-more',
    route: '/salary-book/employees',
    target: 'nav-more',
    mobileOnly: true,
    title: 'More menu',
    body: 'Tap More for Leaves, Advances, Salary Book, Reports, Devices, Settings, and Profile.',
    notes: ['We’ll open More next so you can see those items.'],
    placement: 'top',
  },
  {
    id: 'nav-advances',
    route: '/salary-book/employees',
    target: 'nav-advances',
    openMore: true,
    title: 'Advances',
    body: 'Open Advances to pay a salary advance. Advances reduce net payable until they are marked paid (full or partial).',
    notes: [
      'MT Shop purchases can also appear as advances.',
      'Tap an employee name to open their advance ledger.',
    ],
    placement: 'top',
  },
  {
    id: 'adv-add',
    route: '/salary-book/advances',
    target: 'adv-add',
    title: 'How to pay an advance',
    body: 'Tap Add Advance, choose the employee, amount, and reason, then save. You can void a mistaken advance later.',
    notes: ['Use Mark paid on the ledger when the employee settles part or all of the advance.'],
    placement: 'bottom',
  },
  {
    id: 'nav-salaries',
    route: '/salary-book/advances',
    target: 'nav-salaries',
    openMore: true,
    title: 'Salary Book',
    body: 'This is where monthly salary is calculated — present days, leave deductions, advances, and net payable.',
    placement: 'top',
  },
  {
    id: 'sal-list',
    route: '/salary-book/salaries',
    target: 'sal-list',
    title: 'How salary deductions work',
    body: 'Pick a month to see each employee’s gross, leave deduction, advances, and net. Tap View Details to finalize and record payment.',
    notes: [
      'Leave deduction comes from unpaid leave / absences based on your calculation method.',
      'Advances shown here are still outstanding against this month.',
      'Tap the employee name or advance amount to open the advance ledger.',
      'On the detail screen: Finalize locks the month, then Record Payment to pay salary.',
    ],
    placement: 'bottom',
  },
  {
    id: 'nav-leaves',
    route: '/salary-book/salaries',
    target: 'nav-leaves',
    openMore: true,
    title: 'Leaves',
    body: 'Record paid or unpaid leave ranges here. They show on the calendar and affect salary where unpaid.',
    notes: ['You can void a leave if it was entered by mistake.'],
    placement: 'top',
  },
  {
    id: 'leave-add',
    route: '/salary-book/leaves',
    target: 'leave-add',
    title: 'Adding leave',
    body: 'Tap Add Leave, choose employee, type (paid / unpaid), dates, and save.',
    placement: 'bottom',
  },
  {
    id: 'nav-reports',
    route: '/salary-book/leaves',
    target: 'nav-reports',
    openMore: true,
    title: 'Reports',
    body: 'Export attendance, leave, advance, and monthly salary reports as CSV for accounting or audits.',
    placement: 'top',
  },
  {
    id: 'reports-page',
    route: '/salary-book/reports',
    target: 'reports-page',
    title: 'Running a report',
    body: 'Choose the report type, month, and optional employee, then preview or download CSV.',
    placement: 'bottom',
  },
  {
    id: 'nav-settings',
    route: '/salary-book/reports',
    target: 'nav-settings',
    openMore: true,
    title: 'Settings',
    body: 'Configure salary calculation method, default times, geofence, capture mode (Hardware / Geo / Manual), and devices.',
    notes: ['Replay this tutorial anytime from the bottom of Settings.'],
    placement: 'top',
  },
  {
    id: 'settings-tutorial',
    route: '/salary-book/settings',
    target: 'settings-tutorial',
    title: 'You’re set',
    body: 'That’s the Salary Book tour. Use Replay tutorial here whenever you want a refresher.',
    notes: ['Tip: start from Home each day — live timetable plus quick actions cover most daily work.'],
    placement: 'top',
  },
];
