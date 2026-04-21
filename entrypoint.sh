#!/bin/bash
set -e

echo "Applying database migrations..."

# Use --fake-initial so pre-existing initial tables are marked as applied.
python manage.py migrate --noinput --fake-initial || {
    echo "Migration failed! Fix migrations manually."
    exit 1
}


echo "Starting Gunicorn..."
exec gunicorn backend.config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 1 \
    --threads 2 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
