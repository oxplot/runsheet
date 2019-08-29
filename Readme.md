Welcome to Runsheet V2 (RsV2). This guide will help you understand how
to setup this software and how it works under the hood.

## What is RsV2?

RsV2 is a second iteration, re-written from scratch, of an original
runsheet script which given a set of tasks and their dependencies,
scheduled them in the most time optimized arrangement and provided a UI
to help tracking the progress of those tasks. You can think of it as a
simpler, collaborative and more focused Gantt chart with live task
status updates.

![GitHub Logo](example.gif)

## What can I use it for?

RsV2 can be used to track a weekend roll out for instance. You have a
bunch of tasks that must be done in a certain order, such as putting up
a maintenance notice, taking systems down, upgrading and testing. RsV2’s
real advantage comes into play when multiple people are involved and
prompt starting and finishing of tasks is of importance.

## Features

* RDBMS backed storage for tasks and runsheets
* Multiple runsheets per server
* Lax requirements on how the tasks and runsheets are stored
* Completely reactive UI with live collaborative features.
* Automatic time divisions based on total run time
* Support for variety of database backends
* Start time and “Behind Schedule” notifications
* Single Go binary for ease of deployment (not static yet!)
* Multi-platform support

## Build & Install

```
go generate
go install -tags prod
```

## Quick Demo

Run `runsheet -config example-config.json` and open your browser at
http://localhost:8080

## Setup

### Config

RsV2 is configured using a file named `config.yaml` which must be placed
in either: same directory as the executable; `/etc/runsheet`;
`$HOME/.runsheet` or their equivalent locations on other platforms.

`config.yaml` has the following format:

```yaml
# Optional
Listen: :8080

# A comment starting with hash character
ConnectionUrl: dbdriver://…
RunsheetsSql: select * from …
```

`Listen` specifies which interface and port number to listen for
connections to serve the UI. `:8080` is the default and means: serve on
port `8080` on all interfaces. To limit to localhost for instance, you
can use `127.0.0.1:8080`.

`ConnectionUrl` specifies which DB driver to use and what parameters to
pass, such as username, password, host and others. Following are
examples of `ConnectionUrl`s for various supported databases:

```yaml
-# Oracle - Oracle Instant Client Basic is required
-ConnectionUrl: goracle://username/password@(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=tcp)(HOST=host.name.com)(PORT=1530)))(CONNECT_DATA=(SERVICE_NAME=MY_SERVICE_NAME)))

# Microsoft SQL
ConnectionUrl: sqlserver://username:password@host.name.com?database=my_db

# SQLite
ConnectionUrl: sqlite3://./relative/path/to/test.db
```

`RunsheetsSql` is a query or otherwise any valid SQL for the given
database that retrieves the list of runsheets.

### Runsheet

A **runsheet** is simply a list of tasks and their dependencies.
`RunsheetsSql` must return the following columns (some optional):

* `id` (string): ID of the runsheet
* `name` (string)(optional): name or title of the runsheet — supports
  markdown
* `description` (string)(optional): runsheet description — supports
  markdown
* `connection_url` (string): Same format as `ConnectionUrl` above but
  for this runsheet
* `tasks_sql` (string): SQL to get the list of tasks
* `update_sql` (string): SQL to update status of a task
* `start_time` (string)(optional): start time and date of the first task

All column names are case sensitive and `RunsheetsSql` must not retrieve
any column that is not specified above.

`tasks_sql` is a query or otherwise any valid SQL for the given database
that retrieves the list of tasks for the corresponding runsheet.

### Task

A **task** is an undertaking assigned to a specific resource (person)
and has defined duration in minutes. It may also have dependencies on
other tasks. `tasks_sql` must return the following columns (some
optional):

* `id` (string): Task ID
* `name` (string)(optional): Task name — supports markdown
* `description` (string)(optional): Task description — supports markdown
* `assignee` (string): Name of assignee
* `duration` (number): Task duration in minutes
* `status` (string): Task status which must be one of `idle`, `ongoing`
  or `done`
* `dependees` (string): List of task IDs this task depends on, each
  separated by `|`

All column names are case sensitive and `tasks_sql` must not retrieve
any column that is not specified above.

As an example of `dependees`: say we have three tasks with IDs of `A`,
`B` and `C`. If `C` depends on `A` and `B`, then `C`’s record will have
`A|B` in the `dependees` column.

`update_sql` is a valid SQL for the given database which updates status
for a given task. All occurrences of `{{task}}` inside `update_sql` will
be replaced with ID of the task whose status is being updated. All
occurences of `{{status}}` inside `update_sql` will be replaced with the
new status of the task. Below is an example:

```
update tasks set "status" = '{{status}}' where "id" = '{{task}}'
```

Note that no DB aware substitutions are done. Thus you’re required to
quote literal string values in your SQL.

`start_time` is a string representation of the start time and date the
earliest task in the runsheet is to be stamped with. Regular interval
timestamps are shown on the left side of a runsheet UI. You may use any
format supported by Javascript. Following is recommended: `2018-10-25
18:10:00 EST` where `EST` defines the time zone, in this case Australian
Eastern Standard Time. You may use an offset instead, such as `+11:00`
or [other abbreviations](https://www.timeanddate.com/time/zones/).
