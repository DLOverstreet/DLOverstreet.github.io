#!/bin/sh
# Downstream steps after student.py: assemble, analyses, dashboard tables.
set -e
python3 -I assemble.py ../data
python3 -I analysis.py ../data ../labels ../analysis
python3 -I trump2.py ../data ../analysis
python3 -I dashboard_data.py ../data ../labels ../analysis
python3 -I interval_series.py ../data ../analysis/dashboard
