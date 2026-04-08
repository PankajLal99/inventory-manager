import logging
from datetime import datetime
from zoneinfo import ZoneInfo


class ISTFormatter(logging.Formatter):
    """Logging formatter that renders asctime in Asia/Kolkata."""

    ist_tz = ZoneInfo("Asia/Kolkata")

    def formatTime(self, record, datefmt=None):
        dt = datetime.fromtimestamp(record.created, tz=self.ist_tz)
        if datefmt:
            return dt.strftime(datefmt)
        return dt.isoformat(sep=" ", timespec="milliseconds")
