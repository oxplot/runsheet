package runsheet

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

func LoadTasks(conn *sqlx.DB, sql string, timeout time.Duration) ([]*Task, error) {
	type TaskWithDependees struct {
		*Task
		Dependees *string `db:"dependees"`
	}
	tasksWithDependees := []TaskWithDependees{}
	ctx, _ := context.WithTimeout(context.Background(), timeout)
	if err := conn.SelectContext(ctx, &tasksWithDependees, sql); err != nil {
		return nil, err
	}

	tasks := make(map[string]*Task)
	dependers := make(map[string][]string)
	for _, twd := range tasksWithDependees {

		if twd.Id == "" {
			return nil, fmt.Errorf("task id cannot be blank")
		}
		if twd.Assignee == "" {
			return nil, fmt.Errorf("task '%s' must have an assignee", twd.Id)
		}
		if twd.Duration == 0 {
			return nil, fmt.Errorf("duration of task '%s' must be positive integer", twd.Id)
		}
		if strings.Contains(twd.Id, "|") {
			return nil, fmt.Errorf("task id '%s' cannot contain '|'", twd.Id)
		}
		if _, ok := tasks[twd.Id]; ok {
			return nil, fmt.Errorf("task id '%s' must be unique", twd.Id)
		}
		dependeesSeen := make(map[string]bool)
		if twd.Dependees != nil && *twd.Dependees != "" {
			for _, d := range strings.Split(*twd.Dependees, "|") {
				if d == "" {
					return nil, fmt.Errorf("task '%s' cannot have blank dependees", twd.Id)
				}
				if dependeesSeen[d] {
					return nil, fmt.Errorf("task '%s' has duplicate dependee '%s'", twd.Id, d)
				}
				dependers[d] = append(dependers[d], twd.Id)
				dependeesSeen[d] = true
			}
		}
		tasks[twd.Id] = twd.Task

	}

	for depee, depers := range dependers {
		if _, ok := tasks[depee]; !ok {
			return nil, fmt.Errorf("referenced task '%s' is missing", depee)
		}
		for _, deper := range depers {
			tasks[depee].Dependers = append(tasks[depee].Dependers, tasks[deper])
		}
	}
	tasksSlice := make([]*Task, 0, len(tasks))
	for _, t := range tasks {
		tasksSlice = append(tasksSlice, t)
	}
	sort.Slice(tasksSlice, func(i, j int) bool {
		return tasksSlice[i].Id < tasksSlice[j].Id
	})
	return tasksSlice, nil
}
