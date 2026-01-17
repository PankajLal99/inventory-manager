#!/usr/bin/env python
"""
Test runner script for comprehensive test execution and coverage
Usage: python manage.py run_tests or python backend/run_tests.py
"""
import os
import sys
import django
from django.conf import settings
from django.test.utils import get_runner

if __name__ == "__main__":
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
    django.setup()
    TestRunner = get_runner(settings)
    test_runner = TestRunner()
    failures = test_runner.run_tests([
        'backend.core',
        'backend.catalog',
        'backend.pos',
        'backend.purchasing',
        'backend.inventory',
        'backend.parties',
        'backend.locations',
        'backend.pricing',
        'backend.reports',
    ])
    sys.exit(bool(failures))

