import { useEffect, useState } from 'react';
import api from '../../lib/api';

/** Load a salary-book image with the salary-book token. <img> cannot send that header. */
export function useSalaryBookImage(path: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let objectUrl = '';
    api
      .get(path, { responseType: 'blob', authScope: 'salary_book' } as never)
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data);
        if (!cancelled) setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return src;
}
