import type { GpsFix, SalaryBookSettings } from './types';

export function formatINR(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  if (Number.isNaN(n)) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function toTimeInput(value: string | null | undefined) {
  if (!value) return '';
  return String(value).slice(0, 5);
}

export function scheduledHoursFromTimes(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return 0;
  const [h1, m1] = toTimeInput(checkIn).split(':').map(Number);
  const [h2, m2] = toTimeInput(checkOut).split(':').map(Number);
  const mins = h2 * 60 + m2 - (h1 * 60 + m1);
  return mins > 0 ? mins / 60 : 0;
}

export function formatDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

export function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function escapeCsv(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  const lines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function apiError(err: unknown, fallback = 'Something went wrong.') {
  const anyErr = err as { response?: { data?: { error?: string; detail?: string } } };
  return anyErr?.response?.data?.error || anyErr?.response?.data?.detail || fallback;
}

export function statusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function getCurrentGps(timeout = 20000): Promise<GpsFix> {
  if (!navigator.geolocation) {
    throw new Error('LOCATION_UNSUPPORTED');
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date().toISOString(),
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error('LOCATION_DENIED'));
        else if (err.code === err.TIMEOUT) reject(new Error('LOCATION_TIMEOUT'));
        else reject(new Error('LOCATION_UNAVAILABLE'));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}

export function gpsUserMessage(code: string) {
  if (code === 'LOCATION_DENIED') {
    return 'Location permission was denied. Please enable location permission and try again.';
  }
  if (code === 'LOCATION_TIMEOUT') {
    return 'Unable to get your location. Please enable Location Services and try again.';
  }
  if (code === 'LOCATION_UNSUPPORTED') {
    return 'This browser cannot provide location. Please use Chrome or Safari.';
  }
  return 'We need your current location to mark attendance. Please enable location and try again.';
}

export async function compressImage(file: File, maxEdge = 1280, quality = 0.7): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', quality);
  });
}

export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const radius = 6371000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dlmb = toRad(lon2 - lon1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const GPS_POLL_MS = 2000;
export const GPS_STALE_MS = 8000;

export function gpsAgeMs(gps: GpsFix | null, now = Date.now()) {
  if (!gps?.capturedAt) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - new Date(gps.capturedAt).getTime());
}

export function geofenceStatus(gps: GpsFix, settings: SalaryBookSettings) {
  const officeLat = Number(settings.office_latitude);
  const officeLng = Number(settings.office_longitude);
  const radius = Number(settings.geofence_radius_meters) || 150;
  if (Number.isNaN(officeLat) || Number.isNaN(officeLng)) {
    return { inside: false, distance: null as number | null, radius };
  }
  const distance = distanceMeters(gps.latitude, gps.longitude, officeLat, officeLng);
  return { inside: distance <= radius, distance, radius };
}

export function appendGps(form: FormData, gps: GpsFix, prefix = '') {
  form.append(`${prefix}latitude`, String(gps.latitude));
  form.append(`${prefix}longitude`, String(gps.longitude));
  if (prefix === 'check_out_') {
    form.append('check_out_accuracy', String(Math.round(gps.accuracy)));
    form.append('check_out_captured_at', gps.capturedAt);
  } else {
    form.append('location_accuracy', String(Math.round(gps.accuracy)));
    form.append('location_captured_at', gps.capturedAt);
  }
}
