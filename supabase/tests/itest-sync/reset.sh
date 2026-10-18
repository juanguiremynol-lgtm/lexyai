#!/bin/sh
cd /tmp/itest
./lpsql -d postgres -c "drop database if exists sync_run with (force)" -c "create database sync_run template sync_itest" >/dev/null
